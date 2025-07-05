import { Env } from "../utils/env";
import logger from "../utils/logger";
import { sleep } from "../utils/sleep";

export class LlamaCppClient {
	readonly baseUrl: string;
	readonly token: string;
	#closing = false;
	#abortController: AbortController = new AbortController();

	static readonly name = "llamacpp-client";

	constructor(host: string, port: number, token: string) {
		this.baseUrl = `http://${host}:${port}`;
		this.token = token;
	}

	static fromEnv(): LlamaCppClient {
		const host = Env.string("LLM_SERVER_HOST");
		const port = Env.number("LLM_SERVER_PORT");
		const token = Env.string("LLM_SERVER_TOKEN");
		return new LlamaCppClient(host, port, token);
	}

	async init(): Promise<LlamaCppClient> {
		// call the root endpoint to check if the server is running
		const res = await fetch(`${this.baseUrl}/`);
		if (!res.ok) {
			throw new Error(
				`Failed to connect to LlamaCpp server: ${res.status} ${await res.text()}, baseUrl: ${this.baseUrl}`,
			);
		}
		return this;
	}

	async close(): Promise<void> {
		this.#closing = true;
		logger.info("[llamaclient] closing ...");
		this.#abortController.abort();
		await sleep(1000); // wait for 1 second to allow any ongoing requests to finish
		this.#closing = false;
		logger.info("[llamaclient] closed");
		return;
	}

	name(): string {
		return "llamacpp-client";
	}

	async infer(
		query: string,
		opt?: { temperature?: number; stopText?: string[] },
	): Promise<string> {
		const body: Record<string, unknown> = { prompt: query };
		if (opt?.temperature !== undefined) body.temperature = opt.temperature;
		if (opt?.stopText !== undefined) body.stopText = opt.stopText;

		const res = await fetch(`${this.baseUrl}/infer`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.token}`,
			},
			signal: this.#abortController.signal,
			body: JSON.stringify(body),
		});

		if (!res.ok || !res.body) {
			throw new Error(`infer failed: ${res.status} ${await res.text()}`);
		}

		const reader = res.body?.getReader();
		if (!reader) throw new Error("Response body is not readable");

		const decoder = new TextDecoder();
		let result = "";

		try {
			while (true) {
				if (this.#closing) {
					await reader.cancel(); // Wait for cancellation to complete
					throw new Error("LlamaCppClient is closing, cannot read more data");
				}

				const { value, done } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				for (const part of chunk.split("\n\n")) {
					// Replace [BREAK] with \n to recover the original text
					const cleaned = part.replace(/\[BREAK\]/g, "\n");

					if (cleaned.startsWith("data:")) {
						const noprefix = cleaned.slice(5);
						if (noprefix === "[EOF]") {
							break;
						}
						result += noprefix;
					} else {
						result += cleaned; // Append any other text directly
					}
				}
			}

			// Flush any remaining decoder state (e.g., for multibyte characters)
			const remaining = decoder.decode(); // no value → flush internal buffer
			if (remaining) result += remaining;

			// Remove reasoning part if exists
			result = result.replace(/<think>[\s\S]*?<\/think>\n*/, "");
			logger.trace(`[llamaclient] final result: ${result}`);
			return result;
		} finally {
			// Always release the reader when done or error
			reader.releaseLock();
		}
	}

	async inferStructured<T>(
		query: string,
		encode: <T>(response: string) => T,
		opt?: { temperature?: number; stopText?: string[] },
	): Promise<T> {
		const res = await this.infer(query, opt);
		return encode(res);
	}

	async embed(text: string): Promise<readonly number[]> {
		const res = await fetch(`${this.baseUrl}/embedding`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.token}`,
			},
			body: JSON.stringify({ text }),
			signal: this.#abortController.signal,
		});

		if (!res.ok) {
			throw new Error(`embedding failed: ${res.status} ${await res.text()}`);
		}
		const data = (await res.json()) as { embedding: number[] };
		return data.embedding;
	}

	async embedContext(
		task: (_embedder: (text: string) => Promise<readonly number[]>) => Promise<void>,
	): Promise<void> {
		await task(async (text: string) => await this.embed(text));
	}
}
