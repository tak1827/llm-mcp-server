import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformation,
	OAuthClientInformationFull,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { MCPClientJsonSchema } from "../users";
import logger from "../utils/logger";

/**
 * In-memory OAuth client provider for demonstration purposes
 * In production, you should persist tokens securely
 */
export class InMemoryOAuthClientProvider implements OAuthClientProvider {
	private readonly _clientMetadata: OAuthClientMetadata;
	private readonly _redirectUrl;
	private readonly _serverUrl: URL;
	private _clientInformation?: OAuthClientInformationFull;
	private _tokens?: OAuthTokens;
	private _codeVerifier?: string;

	constructor(clientJson: MCPClientJsonSchema) {
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
		this._serverUrl = new URL(clientJson.server_url);
	}

	private _onRedirect(url: URL): void {
		logger.info(`[mcp] OAuth redirect handler called - ${url.toString()}`);

		// call auth callback endpoint
		fetch(url.toString())
			.then(async (response) => {
				const body = (await response.json()) as { message: string };
				logger.info(
					`[mcp] OAuth redirect handler response: ${response.status} ${body.message}`,
				);
			})
			.catch((error) => {
				logger.error(`[mcp] OAuth redirect handler error: ${error}`);
			});
	}

	get redirectUrl(): string | URL {
		return this._redirectUrl;
	}

	get serverUrl(): URL {
		return this._serverUrl;
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
