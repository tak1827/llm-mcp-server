import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { LlamaCppClient } from "./llamacppClient.js";

describe("LlamaCppClient infer method", () => {
	let client: LlamaCppClient;
	const mockHost = "localhost";
	const mockPort = 3100;
	const mockToken = "xHvZ4EKJXjmK3dgr7Y0Hioxf2KIi14ahlpoxTedFPypS1OiXKS";

	beforeEach(() => {
		client = new LlamaCppClient(mockHost, mockPort, mockToken);
	});

	it("infer function call works", async () => {
		// const query = "Can you list all the available users by calling the collect-user-info tool?";
		const query = "Can you call `greet` tool by name as Tak?, then reply with the result";
		try {
			const result = await client.infer(query);
			console.log(result);
			assert.ok(true);
		} catch (err) {
			assert.fail(err as Error);
		}
	});
});
