import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Example MCP server demonstrating tools, resources and prompts implemented as a class

class ExampleServer {
	readonly server: McpServer;
	readonly transport: StdioServerTransport;

	constructor() {
		this.server = new McpServer({
			name: "demo-server",
			version: "1.0.0",
		});
		this.transport = new StdioServerTransport();
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
	}
}

export { ExampleServer };

if (import.meta.main) {
	const srv = new ExampleServer();
	srv.start().catch((err) => {
		console.error("Failed to start MCP server", err);
	});
}
