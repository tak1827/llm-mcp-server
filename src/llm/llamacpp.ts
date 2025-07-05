import fs from "node:fs";
import { basename } from "node:path";
import {
	type ChatSessionModelFunctions,
	type ChatWrapper,
	getLlama,
	JinjaTemplateChatWrapper,
	type LLamaChatPromptOptions,
	LlamaChatSession,
	type LlamaContext,
	LlamaLogLevel,
	type LlamaModel,
} from "node-llama-cpp";
import logger from "../utils/logger";

export class LLamaCppModel {
	public readonly modelPath: string;
	#abortController: AbortController = new AbortController();
	#model?: LlamaModel;
	#context?: LlamaContext;
	#defaultPromptOptions: Partial<LLamaChatPromptOptions> = {
		signal: this.#abortController.signal,
		trimWhitespaceSuffix: true,
		stopOnAbortSignal: true,
	};
	#chatWrapper: ChatWrapper | undefined;
	readonly #modelName: string;
	#closing = false;
	readonly #closingError: Error = new Error("closing! no more inference allowed");

	constructor(
		modelPath: string,
		opts: { templatePath?: string | undefined; signal?: AbortSignal } = {},
	) {
		this.modelPath = this._validateModelPath(modelPath);
		this.#modelName = basename(modelPath);
		if (opts.templatePath)
			this.#chatWrapper = new JinjaTemplateChatWrapper({
				template: fs.readFileSync(opts.templatePath, "utf-8"),
			});
		if (opts.signal) {
			opts.signal.addEventListener("abort", () => {
				this.close();
			});
		}
	}

	public async init(): Promise<LLamaCppModel> {
		const llama = await getLlama();
		this.#model = await llama.loadModel({ modelPath: this.modelPath });
		this.#model.llama.logLevel = LlamaLogLevel.warn;
		this.#context = await this.#model.createContext();
		return this;
	}

	public async close() {
		this.#closing = true;
		this.#abortController.abort();
		if (this.#context) await this.#context.dispose();
		if (this.#model) await this.#model.dispose();
		logger.info(`closed model: ${this.#modelName}`);
		this.#closing = false;
	}

	public name(): string {
		return this.#modelName;
	}

	public getSession(systemPrompt: string): LlamaChatSession {
		if (!this.#context) throw new Error("Not yet initialized");
		return new LlamaChatSession({
			contextSequence: this.#context.getSequence(),
			systemPrompt,
			autoDisposeSequence: true,
			chatWrapper: this.#chatWrapper || "auto",
		});
	}

	public async infer(
		query: string,
		opt?: {
			temperature?: number;
			stopText?: string[];
			session?: LlamaChatSession;
			onTextChunk?: (text: string) => void;
			functions?: ChatSessionModelFunctions;
		},
	): Promise<string> {
		if (this.#closing) throw this.#closingError;
		const session = opt?.session ? opt.session : this.getSession("");
		const result = await session.prompt(query, {
			...this.#defaultPromptOptions,
			temperature: opt?.temperature,
			customStopTriggers: opt?.stopText,
			onTextChunk: (text: string) => {
				logger.trace(`prompt chunk: ${text}`);
				if (opt?.onTextChunk) opt.onTextChunk(text);
			},
			// biome-ignore lint/suspicious/noExplicitAny: inevitable
			functions: opt?.functions as any,
		});
		if (!opt || !opt.session) session.dispose();
		return result;
	}

	public async embed(text: string): Promise<readonly number[]> {
		if (this.#closing) throw this.#closingError;
		let result: readonly number[] | undefined;
		await this.embedContext(async (embedder) => {
			result = await embedder(text);
		});
		return result || [];
	}

	public async embedContext(
		task: (_embedder: (text: string) => Promise<readonly number[]>) => Promise<void>,
	) {
		if (this.#closing) throw this.#closingError;
		if (!this.#model) throw new Error("Model not initialized");
		const context = await this.#model.createEmbeddingContext();
		const embedder = async (text: string) => (await context.getEmbeddingFor(text)).vector;
		await task(embedder);
		context.dispose();
	}

	private _validateModelPath(modelPath: string): string {
		if (!fs.existsSync(modelPath)) {
			throw new Error(`path not found: ${modelPath}`);
		}
		if (!modelPath.endsWith(".gguf")) {
			// Ensure that the file extension is `.gguf`
			throw new Error("Unsupported model. Expected a `.gguf` file");
		}
		return modelPath;
	}
}
