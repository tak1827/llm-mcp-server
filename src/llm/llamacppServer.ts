import type { Server } from "node:http";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import express, { type NextFunction, type Request, type Response } from "express";
import {
	type ChatSessionModelFunction,
	type ChatSessionModelFunctions,
	defineChatSessionFunction,
} from "node-llama-cpp";
import { MCPClient } from "../mcp/mcpClient";
import { readUserJsonFiles, type UserJsonSchema } from "../users";
import logger from "../utils/logger";
import { LLamaCppModel } from "./llamacpp";

export type InferRequest = {
	prompt: string;
	temperature?: number;
	stopText?: string[];
};

export type EmbedRequest = {
	text: string;
};

export type UserInfo = {
	user: UserJsonSchema;
	mcpClient?: MCPClient;
	functions?: ChatSessionModelFunctions;
};

export class LlamaCppServer {
	readonly host: string;
	readonly port: number;
	readonly embedTimeout: number;
	#abortController: AbortController;
	#server?: Server;
	#inferModel: LLamaCppModel;
	#embedModel?: LLamaCppModel;
	#closing = false;
	#tokenToUserMap: Map<string, UserInfo>;

	constructor(
		host: string,
		port: number,
		opts: { embedTimeout?: number; modelPath: string; embeddingModelPath?: string },
	) {
		this.host = host;
		this.port = port;
		this.embedTimeout = opts.embedTimeout || 60000;
		const templatePath = process.env.LLM_TEMPLATE_PATH;
		this.#inferModel = new LLamaCppModel(opts.modelPath, { templatePath });
		this.#embedModel = opts.embeddingModelPath
			? new LLamaCppModel(opts.embeddingModelPath)
			: undefined;
		this.#abortController = new AbortController();
		this.#tokenToUserMap = new Map();
	}

	async init(): Promise<LlamaCppServer> {
		const users = await readUserJsonFiles();
		for (const user of users) {
			const mcpClient =
				user.mcp_clients.length > 0
					? new MCPClient(user, this.#abortController.signal)
					: undefined;
			await mcpClient?.connect();
			const tools = await mcpClient?.listTool();
			const functions =
				mcpClient && tools ? this.#mapToolsToLlamaFunctions(mcpClient, tools) : undefined;
			this.#tokenToUserMap.set(user.bearer_token, { user, mcpClient, functions });
		}
		await this.#inferModel.init();
		await this.#embedModel?.init();
		return this;
	}

	#mapToolsToLlamaFunctions(
		mcpClient: MCPClient,
		toolsResult: ListToolsResult,
	): ChatSessionModelFunctions {
		// biome-ignore lint/suspicious/noExplicitAny: inevitable
		const functions: Record<string, ChatSessionModelFunction<any>> = {};
		for (const tool of toolsResult.tools) {
			if (!tool.inputSchema || tool.inputSchema.type !== "object") {
				logger.warn(`Tool '${tool.name}' has no input schema or is not an object`);
				continue;
			}

			functions[tool.name] = defineChatSessionFunction({
				description: tool.description,
				// biome-ignore lint/suspicious/noExplicitAny: inevitable
				params: tool.inputSchema as any,
				handler: async (params?: Record<string, unknown>): Promise<unknown> => {
					logger.debug(
						`[llamaserver] calling tool: ${tool.name}, params: ${JSON.stringify(params)}`,
					);
					const result = await mcpClient.callTool(tool.name, params ?? {});
					logger.debug(`[llamaserver] tool result: ${JSON.stringify(result.content)}`);
					return result.content || `Empty result from tool ${tool.name}`;
				},
			});
		}
		return functions;
	}

	_getUserInfo(req: Request): UserInfo | undefined {
		if (!Object.hasOwn(req, "userInfo")) {
			return undefined;
		}
		// biome-ignore lint/suspicious/noExplicitAny: safe
		return (req as any).userInfo as UserInfo;
	}

	async start(): Promise<void> {
		const app = express();
		app.use(express.json());

		await this.#inferModel.init();
		await this.#embedModel?.init();

		const auth = (req: Request, res: Response, next: NextFunction) => {
			const authHeader = req.headers.authorization || "";
			const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
			if (!this.#tokenToUserMap?.has(token)) {
				res.status(401).json({ error: "Unauthorized" });
				return;
			}
			// biome-ignore lint/suspicious/noExplicitAny: safe
			(req as any).userInfo = this.#tokenToUserMap?.get(token);
			next();
		};

		app.get("/", (_req: Request, res: Response) => {
			logger.info("[llamaserver] / called");
			res.json({ status: "ok" });
		});

		app.post("/infer", auth, async (req: Request, res: Response) => {
			const userInfo = this._getUserInfo(req);
			logger.info(`[llamaserver] /infer called: user_id=${userInfo?.user.user_id}`);

			// validate request body
			const { prompt, temperature, stopText, err } = this.#validateInferRequest(req);
			if (err) {
				res.status(400).json({ error: err });
				return;
			}
			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");
			res.flushHeaders();

			logger.debug(
				`[llamaserver] infer request: temperature: ${temperature}, stopText: ${stopText}, prompt: ${prompt}`,
			);

			try {
				const result = await this.#inferModel.infer(prompt, {
					temperature,
					stopText,
					onTextChunk: (chunk: string) => {
						const safeChunk = chunk.replace(/\n/g, "[BREAK]");
						res.write(`data:${safeChunk}\n\n`);
					},
					functions: userInfo?.functions,
					signal: this.#abortController.signal,
				});
				res.write("data:[EOF]\n\n");
				logger.debug(`[llamaserver] infer result: ${result}`);
			} catch (err) {
				logger.error(err, "[llamaserver] infer error");
				res.write(`event: error\ndata:${(err as Error).message}\n\n`);
			} finally {
				res.end();
			}
		});

		app.post("/embedding", auth, async (req: Request, res: Response) => {
			const userInfo = this._getUserInfo(req);
			logger.info(`[llamaserver] /embedding called: user_id=${userInfo?.user.user_id}`);

			if (!this.#embedModel) {
				res.status(500).json({ error: "Embedding model not found" });
				return;
			}

			// validate request body
			const { text, err } = this.#validateEmbeddingRequest(req);
			if (err) {
				res.status(400).json({ error: err });
				return;
			}

			// set timeout for embedding request
			res.setTimeout(this.embedTimeout);

			// embed the text
			try {
				const emb = await this.#embedModel.embed(text);
				res.json({ embedding: emb });
			} catch (err) {
				logger.error(err, "[llamaserver] embedding error");
				res.status(500).json({ error: (err as Error).message });
			}
		});

		this.#server = app.listen(this.port, this.host, () => {
			logger.info(`[llamaserver] started on http://${this.host}:${this.port}`);
		});
	}

	async close(): Promise<void> {
		if (this.#closing) return;

		this.#closing = true;
		logger.info("[llamaserver] closing ...");
		this.#abortController.abort();

		// Close the models first
		await this.#inferModel.close();
		await this.#embedModel?.close();

		// wait for the server to close
		if (this.#server) {
			await new Promise<void>((resolve) => {
				this.#server?.close(() => resolve());
			});
		}

		this.#closing = false;
		logger.info("[llamaserver] closed");
	}

	async [Symbol.asyncDispose]() {
		await this.close();
	}

	#validateInferRequest(req: Request): InferRequest & { err?: string } {
		const { prompt, temperature, stopText } = req.body as InferRequest;
		if (!prompt) {
			return { prompt: "", err: "prompt required" };
		}
		if (temperature) {
			if (typeof temperature !== "number" || temperature < 0 || temperature > 2) {
				return { prompt, err: "temperature must be a number between 0 and 2" };
			}
		}
		if (stopText) {
			if (!Array.isArray(stopText) || stopText.length === 0) {
				return { prompt, err: "stopText must be a non-empty array" };
			}
		}
		return { prompt, temperature, stopText: stopText };
	}

	#validateEmbeddingRequest(req: Request): EmbedRequest & { err?: string } {
		const { text } = req.body as { text?: string };
		if (!text) {
			return { text: "", err: "text required" };
		}
		return { text };
	}
}
