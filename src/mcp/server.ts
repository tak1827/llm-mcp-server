import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Example MCP server demonstrating tools, resources and prompts implemented as a class

class ExampleServer {
	readonly server: McpServer;
	readonly transport: StreamableHTTPServerTransport;
	readonly port: number;
	private httpServer;

	constructor(port = 3000) {
		this.server = new McpServer({
			name: "demo-server",
			version: process.env.npm_package_version ?? "1.0.0",
		});
		this.transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
		});
		this.port = port;
		this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
			if (req.url === "/mcp") {
				this.transport.handleRequest(req, res).catch((err) => {
					console.error("Failed to handle request", err);
				});
			} else {
				res.statusCode = 404;
				res.end();
			}
		});
		this.registerHandlers();
	}

	private registerHandlers(): void {
		// Addition tool
		this.server.registerTool(
			"add",
			{
				title: "Addition Tool",
				description: "Add two numbers",
				inputSchema: { a: z.number(), b: z.number() },
			},
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			}),
		);

		// Dynamic greeting resource
		this.server.registerResource(
			"greeting",
			new ResourceTemplate("greeting://{name}", { list: undefined }),
			{
				title: "Greeting Resource",
				description: "Dynamic greeting generator",
			},
			async (uri, { name }) => ({
				contents: [
					{
						uri: uri.href,
						text: `Hello, ${name}!`,
					},
				],
			}),
		);

		// Simple prompts
		this.server.registerPrompt(
			"review-code",
			{
				title: "Code Review",
				description: "Review code for best practices and potential issues",
				argsSchema: { code: z.string() },
			},
			({ code }) => ({
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: `Please review this code:\n\n${code}`,
						},
					},
				],
			}),
		);

		// Prompt with completions
		this.server.registerPrompt(
			"team-greeting",
			{
				title: "Team Greeting",
				description: "Generate a greeting for team members",
				argsSchema: {
					department: completable(z.string(), (value) =>
						["engineering", "sales", "marketing", "support"].filter((d) => d.startsWith(value)),
					),
					name: completable(z.string(), (value, context) => {
						const dept = context?.arguments?.department;
						if (dept === "engineering") {
							return ["Alice", "Bob", "Charlie"].filter((n) => n.startsWith(value));
						} else if (dept === "sales") {
							return ["David", "Eve", "Frank"].filter((n) => n.startsWith(value));
						} else if (dept === "marketing") {
							return ["Grace", "Henry", "Iris"].filter((n) => n.startsWith(value));
						}
						return ["Guest"].filter((n) => n.startsWith(value));
					}),
				},
			},
			({ department, name }) => ({
				messages: [
					{
						role: "assistant",
						content: {
							type: "text",
							text: `Hello ${name}, welcome to the ${department} team!`,
						},
					},
				],
			}),
		);
	}

	async start(): Promise<void> {
		await this.server.connect(this.transport);
		await new Promise<void>((resolve) => this.httpServer.listen(this.port, resolve));
		console.log(`MCP HTTP server listening on http://localhost:${this.port}/mcp`);
	}
}

export { ExampleServer };

if (import.meta.main) {
	const srv = new ExampleServer();
	srv.start().catch((err) => {
		console.error("Failed to start MCP server", err);
	});
}
