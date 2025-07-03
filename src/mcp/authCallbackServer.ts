import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import { URL } from "node:url";
import logger from "../utils/logger";

export class AuthCallbackServer {
	private _server: Server;
	private _code: string | null = null;
	private _callbackError: string | null = null;
	private _notifyCallbackCalled: ((code: string | null, error: string | null) => void) | null =
		null;

	constructor(private readonly callbackPort: number = 8090) {
		this.callbackPort = callbackPort;
		this._server = createServer((req: IncomingMessage, res: ServerResponse) => {
			const url = new URL(req.url || "", `http://localhost:${this.callbackPort}`);

			// Handle root path with hello message
			if (url.pathname === "/") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ message: "OAuth Callback Server is running" }));
				return;
			}

			// Handle OAuth callback
			if (url.pathname === "/callback") {
				let error = url.searchParams.get("error") || null;
				const code = url.searchParams.get("code") || null;

				if (error) {
					const msg = `Authorization failed: ${error}`;
					logger.error(`[oauth] ${msg}`);
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: msg }));
				} else if (code) {
					logger.info(`[oauth] Authorization code received: ${code.substring(0, 10)}...`);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ message: "Authorization successful" }));
				} else {
					const msg = "No authorization code provided";
					logger.error(`[oauth] ${msg}`);
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: msg }));
					error = msg;
				}

				this._code = code;
				this._callbackError = error;
				if (this._notifyCallbackCalled) this._notifyCallbackCalled(code, error);

				return;
			}

			// Handle other paths
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		});
	}

	start() {
		this._server.listen(this.callbackPort, () => {
			logger.info(`[oauth] Callback server started on http://localhost:${this.callbackPort}`);
		});
	}

	static createAndStart(callbackPort: number = 8090): AuthCallbackServer {
		const server = new AuthCallbackServer(callbackPort);
		server.start();
		return server;
	}

	async waitForAuthorizationCode(): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			if (this._code) resolve(this._code);
			else if (this._callbackError) reject(this._callbackError);

			this._notifyCallbackCalled = (code, error) => {
				if (code) resolve(code);
				else if (error) reject(error);
				else reject(new Error("No authorization code nor error received"));
			};
		});
	}

	close(): void {
		this._server.close(() => {
			logger.info(`[oauth] Callback server closed on http://localhost:${this.callbackPort}`);
		});
	}

	getCallbackUrl(): string {
		return `http://localhost:${this.callbackPort}/callback`;
	}

	getCallbackPort(): number {
		return this.callbackPort;
	}
}
