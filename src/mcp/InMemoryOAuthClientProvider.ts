import {
	type OAuthClientProvider,
	refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformation,
	OAuthClientInformationFull,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { MCPClientJsonSchema } from "../users";
import logger from "../utils/logger";

export class InMemoryOAuthClientProvider implements OAuthClientProvider {
	private readonly _clientMetadata: OAuthClientMetadata;
	private readonly _redirectUrl;
	private readonly _serverUrl: string;
	private readonly _authServerUrl: string;
	private _clientInformation: OAuthClientInformationFull;
	private _tokens?: OAuthTokens;
	private _codeVerifier?: string;
	private _timer?: NodeJS.Timeout;

	constructor(clientJson: MCPClientJsonSchema, signal?: AbortSignal) {
		this._clientMetadata = {
			client_name: clientJson.client_name,
			redirect_uris: clientJson.redirect_uris,
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "client_secret_post",
			scope: clientJson.scope,
		};
		this._clientInformation = {
			client_id: clientJson.client_id,
			client_secret: clientJson.client_secret,
			...this._clientMetadata,
		};
		if (this._clientMetadata.redirect_uris.length < 1) {
			throw new Error("empty redirect_uris");
		}
		this._redirectUrl = this._clientMetadata.redirect_uris[0] || "";
		this._serverUrl = clientJson.server_url;
		this._authServerUrl = clientJson.auth_server_url;
		if (signal) signal.addEventListener("abort", () => this._clearRefreshTimer());
	}

	private _onRedirect(url: URL): void {
		logger.trace(`[mcp] OAuth redirect handler called - ${url.toString()}`);

		// call auth callback endpoint
		fetch(url.toString())
			.then(async (response) => {
				const body = (await response.json()) as { message: string };
				logger.debug(
					`[mcp] OAuth redirect handler response: ${response.status} ${body.message}`,
				);
				if (response.status !== 200) {
					logger.error(`[mcp] Unexpected OAuth redirect handler response`);
				}
			})
			.catch((error) => {
				logger.error(`[mcp] OAuth redirect handler error: ${error}`);
			});
	}

	get redirectUrl(): string | URL {
		return this._redirectUrl;
	}

	get serverUrl(): URL {
		return new URL(this._serverUrl);
	}

	get authServerUrl(): URL {
		return new URL(this._authServerUrl);
	}

	get clientMetadata(): OAuthClientMetadata {
		return this._clientMetadata;
	}

	clientInformation(): OAuthClientInformation | undefined {
		return this._clientInformation;
	}

	saveClientInformation(clientInformation: OAuthClientInformationFull): void {
		this._clientInformation = clientInformation;
	}

	tokens(): OAuthTokens | undefined {
		return this._tokens;
	}

	saveTokens(tokens: OAuthTokens): void {
		this._tokens = tokens;
		if (tokens.expires_in && tokens.refresh_token) {
			this._setTokenRefreshTimer(tokens.expires_in, tokens.refresh_token);
		}
		logger.trace(tokens, `[mcp] token saved`);
	}

	private _setTokenRefreshTimer(expireIn: number, refreshToken: string): void {
		const refreshIn = expireIn - 10;
		logger.debug(
			`[mcp] Setting token refresh timer for ${refreshIn} seconds: ${this._authServerUrl}`,
		);

		this._timer = setTimeout(async () => {
			try {
				const token = await refreshAuthorization(this._authServerUrl, {
					clientInformation: this._clientInformation,
					refreshToken,
				});
				logger.trace(`[mcp] Token refreshed: ${this._authServerUrl}`);
				this.saveTokens(token);
			} catch (error) {
				logger.error(error, `[mcp] Token refresh failed: ${this._authServerUrl}`);
			}
		}, refreshIn * 1000);
	}

	private _clearRefreshTimer(): void {
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = undefined;
			logger.debug(`[mcp] Token refresh timer cleared`);
		}
	}

	redirectToAuthorization(authorizationUrl: URL): void {
		this._onRedirect(authorizationUrl);
	}

	saveCodeVerifier(codeVerifier: string): void {
		this._codeVerifier = codeVerifier;
	}

	codeVerifier(): string {
		if (!this._codeVerifier) {
			throw new Error("No code verifier saved");
		}
		return this._codeVerifier;
	}
}
