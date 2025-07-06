import { LlamaCppServer } from "../llm/llamacppServer";
import { Env } from "../utils/env";
import logger from "../utils/logger";

async function main() {
	const host = Env.string("SERVER_HOST");
	const port = Env.number("SERVER_PORT");
	const modelPath = Env.string("LLM_MODEL_PATH");
	const embeddingModelPath = process.env.LLM_EMBEDDING_MODEL_PATH;

	const server = await new LlamaCppServer(host, port, { modelPath, embeddingModelPath }).init();

	process.on("SIGINT", () => server.close());
	process.on("SIGTERM", () => server.close());

	await server.start();
}

main().catch((err) => logger.error(err));
