import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	type CallToolRequest,
	type CallToolResult,
	CallToolResultSchema,
	type ListToolsRequest,
	type ListToolsResult,
	ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { MCPClientJsonSchema, UserJsonSchema } from "../users";
import logger from "../utils/logger";
import { AuthCallbackServer } from "./authCallbackServer";
import { InMemoryOAuthClientProvider } from "./InMemoryOAuthClientProvider";

// Configuration
const CLIENT_NAME = "mcp-client";
const CLIENT_VERSION = "1.0.0";
const CALLBACK_PORT = 8090;

export class MCPClient {
	private readonly callbackPort: number;
	private clientMap: Map<
		string, // client_id
		{
			config: MCPClientJsonSchema;
			client: Client;
			transport: StreamableHTTPClientTransport | undefined;
			authProvider: InMemoryOAuthClientProvider;
		}
	> = new Map();
	private functionMap: Map<string, Client> = new Map();

	constructor(
		user: UserJsonSchema,
		private readonly signal: AbortSignal,
		callbackPort?: number,
	) {
		if (user.mcp_clients.length === 0) throw new Error("No MCP clients found");

		this.callbackPort = callbackPort || CALLBACK_PORT;

		for (const mcp_client of user.mcp_clients) {
			const client = new Client(
				{ name: CLIENT_NAME, version: CLIENT_VERSION },
				{ capabilities: {} },
			);
			mcp_client.redirect_uris.push(this._callbackURL());
			const authProvider = new InMemoryOAuthClientProvider(mcp_client, this.signal);
			this.clientMap.set(mcp_client.client_id, {
				config: mcp_client,
				client,
				transport: undefined,
				authProvider,
			});
		}

		this.signal.addEventListener("abort", () => this.close());
	}

	close(): void {
		logger.info(`[mcp] closing client...`);
		Promise.all(this.clientMap.values().map((client) => client.transport?.close()));
		this.clientMap.clear();
	}

	async connect(): Promise<void> {
		for (const client of this.clientMap.values()) {
			await this._connect(client);
		}
	}

	async _connect(client: {
		config: MCPClientJsonSchema;
		client: Client;
		transport: StreamableHTTPClientTransport | undefined;
		authProvider: InMemoryOAuthClientProvider;
	}): Promise<void> {
		const callbackSvr = AuthCallbackServer.createAndStart(this.callbackPort);

		const closeCallbackSvr = () => callbackSvr.close();
		this.signal.addEventListener("abort", closeCallbackSvr);
		client.transport = await this.establishConnection(
			client.client,
			client.authProvider,
			callbackSvr,
		);
		this.signal.removeEventListener("abort", closeCallbackSvr);
		closeCallbackSvr();

		logger.info(`[mcp] connected to ${client.authProvider.serverUrl.toString()}`);
	}

	private async establishConnection(
		client: Client,
		authProvider: InMemoryOAuthClientProvider,
		callbackSvr: AuthCallbackServer,
	): Promise<StreamableHTTPClientTransport> {
		logger.trace(`[mcp] establishing connection to ${authProvider.serverUrl.toString()}`);
		const transport = new StreamableHTTPClientTransport(authProvider.serverUrl, {
			authProvider,
		});
		try {
			await client.connect(transport);
			logger.trace(`[mcp] successfuly connected`);
			return transport;
		} catch (error) {
			if (error instanceof UnauthorizedError) {
				logger.trace(`[mcp] OAuth required - waiting for authorization...`);
				const authCode = await callbackSvr.waitForAuthorizationCode();
				await transport.finishAuth(authCode);
				logger.trace(`[mcp] Authorization code received: ${authCode}`);
				logger.trace(`[mcp] Reconnecting with authenticated transport...`);
				return await this.establishConnection(client, authProvider, callbackSvr);
			} else {
				logger.warn(error, `[mcp] Connection failed with non-auth error: ${error}`);
				throw error;
			}
		}
	}

	public async listTool(clientId: string): Promise<ListToolsResult> {
		const client = this.clientMap.get(clientId);
		if (!client) throw new Error(`Client ${clientId} not found`);
		try {
			const request: ListToolsRequest = {
				method: "tools/list",
				params: {},
			};
			return (await client.client.request(request, ListToolsResultSchema)) as ListToolsResult;
		} catch (err) {
			logger.warn(err, "Failed to fetch tools");
			throw err;
		}
	}

	public async listAllTools(): Promise<ListToolsResult> {
		const result: ListToolsResult = { tools: [] };
		for (const client of this.clientMap.values()) {
			const tools = await this.listTool(client.config.client_id);
			result.tools.push(...tools.tools);
			for (const tool of tools.tools) {
				if (!this.functionMap.has(tool.name)) {
					this.functionMap.set(tool.name, client.client);
				}
			}
		}
		return result;
	}

	public async callTool(
		toolName: string,
		toolArgs: Record<string, unknown>,
	): Promise<CallToolResult> {
		const client = this.functionMap.get(toolName);
		if (!client) throw new Error(`Tool ${toolName} not found`);

		try {
			const request: CallToolRequest = {
				method: "tools/call",
				params: {
					name: toolName,
					arguments: toolArgs,
				},
			};
			return (await client.request(request, CallToolResultSchema)) as CallToolResult;
		} catch (err) {
			logger.warn(err, `Failed to call tool '${toolName}', args: ${JSON.stringify(toolArgs)}`);
			throw err;
		}
	}

	private _callbackURL(): string {
		return `http://localhost:${this.callbackPort}/callback`;
	}
}
