import { strict as assert } from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readUserJsonFiles, type UserJsonSchema } from "./index.js";

describe("readUserJsonFiles", () => {
	const testDataDir = join(process.cwd(), "data", "userstest");
	const testUserFile = join(testDataDir, "user.json");

	const sampleUserData: UserJsonSchema = {
		user_id: "test-user-123",
		bearer_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sample.token",
		mcp_clients: [
			{
				client_name: "Test MCP Client",
				server_url: "http://localhost:8090",
				auth_server_url: "http://localhost:3001",
				redirect_uris: ["http://localhost:8090/callback"],
				scope: "mcp:tools",
				client_id: "d451b808-9b87-470e-89e3-2d280555fc54",
				client_secret: "1234567890",
			},
			{
				client_name: "Another Test Client",
				server_url: "http://localhost:8091",
				auth_server_url: "http://localhost:3001",
				redirect_uris: ["http://localhost:8091/callback", "http://localhost:8092/callback"],
				scope: "mcp:tools mcp:resources",
				client_id: "another-client-id-456",
				client_secret: "another-secret-789",
			},
		],
	};

	// Helper function to setup test environment
	async function setupTest() {
		await mkdir(testDataDir, { recursive: true });
		await writeFile(testUserFile, JSON.stringify(sampleUserData, null, 2));
	}

	// Helper function to cleanup test environment
	async function cleanupTest() {
		try {
			await rm(testDataDir, { recursive: true, force: true });
		} catch (_error) {
			// Ignore cleanup errors
		}
	}

	it("should successfully read and validate user.json file", async () => {
		await setupTest();

		try {
			const users = await readUserJsonFiles(testDataDir);

			assert.equal(users.length, 1);

			// biome-ignore lint/style/noNonNullAssertion: tset
			const user = users[0]!;
			assert.equal(user.user_id, "test-user-123");
			assert.equal(user.bearer_token, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sample.token");
			assert.equal(user.mcp_clients.length, 2);

			// Test first MCP client
			// biome-ignore lint/style/noNonNullAssertion: test
			const firstClient = user.mcp_clients[0]!;
			assert.equal(firstClient.client_name, "Test MCP Client");
			assert.deepEqual(firstClient.redirect_uris, ["http://localhost:8090/callback"]);
			assert.equal(firstClient.scope, "mcp:tools");
			assert.equal(firstClient.client_id, "d451b808-9b87-470e-89e3-2d280555fc54");
			assert.equal(firstClient.client_secret, "1234567890");

			// Test second MCP client
			// biome-ignore lint/style/noNonNullAssertion: test
			const secondClient = user.mcp_clients[1]!;
			assert.equal(secondClient.client_name, "Another Test Client");
			assert.deepEqual(secondClient.redirect_uris, [
				"http://localhost:8091/callback",
				"http://localhost:8092/callback",
			]);
			assert.equal(secondClient.scope, "mcp:tools mcp:resources");
			assert.equal(secondClient.client_id, "another-client-id-456");
			assert.equal(secondClient.client_secret, "another-secret-789");
		} finally {
			await cleanupTest();
		}
	});

	it("should return empty array when no JSON files exist", async () => {
		await setupTest();

		try {
			// Remove the test file temporarily
			await rm(testUserFile);

			const users = await readUserJsonFiles(testDataDir);
			assert.equal(users.length, 0);
		} finally {
			await cleanupTest();
		}
	});

	it("should throw error for invalid JSON format", async () => {
		await setupTest();

		try {
			const invalidJsonFile = join(testDataDir, "invalid.json");
			await writeFile(invalidJsonFile, "{ invalid json }");

			await assert.rejects(readUserJsonFiles(testDataDir), /Invalid JSON in file invalid.json/);
		} finally {
			await cleanupTest();
		}
	});

	it("should throw error for invalid schema", async () => {
		await setupTest();

		try {
			const invalidSchemaFile = join(testDataDir, "invalid-schema.json");
			const invalidData = {
				user_id: "test",
				// missing bearer_token
				mcp_clients: [],
			};
			await writeFile(invalidSchemaFile, JSON.stringify(invalidData));

			await assert.rejects(readUserJsonFiles(testDataDir), /Schema validation failed/);
		} finally {
			await cleanupTest();
		}
	});

	it("should throw error when directory does not exist", async () => {
		// Ensure directory doesn't exist
		await cleanupTest();

		await assert.rejects(readUserJsonFiles(testDataDir), /Users directory not found/);
	});
});
