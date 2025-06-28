import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Example MCP client implemented as a class

class ExampleClient {
	readonly client: Client;
	readonly transport: StdioClientTransport;

	constructor() {
		this.transport = new StdioClientTransport({
			command: "bun",
			args: ["run", "src/mcp/server.ts"],
		});
		this.client = new Client({ name: "example-client", version: "1.0.0" });
	}

	async run(): Promise<void> {
		await this.client.connect(this.transport);

		const addResult = await this.client.callTool({
			name: "add",
			arguments: { a: 2, b: 3 },
		});
		console.log("add result", addResult.content?.[0]?.text);

		const greeting = await this.client.readResource({
			uri: "greeting://Alice",
		});
		console.log("greeting", greeting.contents[0]?.text);

		await this.client.close();
	}
}

export { ExampleClient };

if (import.meta.main) {
	new ExampleClient().run().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
