import { randomUUID } from "node:crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
	AuthorizationParams,
	OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import {
	createOAuthMetadata,
	mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
	OAuthClientInformationFull,
	OAuthMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import express, { type Request, type Response } from "express";

const clientId = "d451b808-9b87-470e-89e3-2d280555fc54";
const clientSecret = "1234567890";

export class DemoInMemoryClientsStore implements OAuthRegisteredClientsStore {
	constructor() {
		this.clients.set(clientId, {
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uris: ["http://localhost:8090/callback"],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "client_secret_post",
			scope: "mcp:tools",
		});
	}
	private clients = new Map<string, OAuthClientInformationFull>();

	async getClient(clientId: string) {
		return this.clients.get(clientId);
	}

	async registerClient(clientMetadata: OAuthClientInformationFull) {
		this.clients.set(clientMetadata.client_id, clientMetadata);
		return clientMetadata;
	}
}

/**
 * 🚨 DEMO ONLY - NOT FOR PRODUCTION
 *
 * This example demonstrates MCP OAuth flow but lacks some of the features required for production use,
 * for example:
 * - Persistent token storage
 * - Rate limiting
 */
export class DemoInMemoryAuthProvider implements OAuthServerProvider {
	clientsStore = new DemoInMemoryClientsStore();
	private codes = new Map<
		string,
		{
			params: AuthorizationParams;
			client: OAuthClientInformationFull;
		}
	>();
	private tokens = new Map<string, AuthInfo>();

	constructor(private validateResource?: (resource?: URL) => boolean) {}

	async authorize(
		client: OAuthClientInformationFull,
		params: AuthorizationParams,
		res: Response,
	): Promise<void> {
		const code = randomUUID();

		const searchParams = new URLSearchParams({
			code,
		});
		if (params.state !== undefined) {
			searchParams.set("state", params.state);
		}

		this.codes.set(code, {
			client,
			params,
		});

		if (!client.redirect_uris?.[0]) {
			throw new Error("No redirect URI provided");
		}
		const targetUrl = new URL(client.redirect_uris[0]);
		targetUrl.search = searchParams.toString();
		res.redirect(targetUrl.toString());
	}

	async challengeForAuthorizationCode(
		_client: OAuthClientInformationFull,
		authorizationCode: string,
	): Promise<string> {
		// Store the challenge with the code data
		const codeData = this.codes.get(authorizationCode);
		if (!codeData) {
			throw new Error("Invalid authorization code");
		}

		return codeData.params.codeChallenge;
	}

	async exchangeAuthorizationCode(
		client: OAuthClientInformationFull,
		authorizationCode: string,
		// Note: code verifier is checked in token.ts by default
		// it's unused here for that reason.
		_codeVerifier?: string,
	): Promise<OAuthTokens> {
		const codeData = this.codes.get(authorizationCode);
		if (!codeData) {
			throw new Error("Invalid authorization code");
		}

		if (codeData.client.client_id !== client.client_id) {
			throw new Error(
				`Authorization code was not issued to this client, ${codeData.client.client_id} != ${client.client_id}`,
			);
		}

		// if (client.client_id !== clientId) {
		//   throw new Error(`Authorization code was not issued to this client, ${client.client_id} != ${clientId}`);
		// }

		if (client.client_secret !== clientSecret) {
			throw new Error(
				`Authorization code was not issued to this client, ${client.client_secret} != ${clientSecret}`,
			);
		}

		if (this.validateResource && !this.validateResource(codeData.params.resource)) {
			throw new Error(`Invalid resource: ${codeData.params.resource}`);
		}

		this.codes.delete(authorizationCode);
		const token = randomUUID();
		const refreshToken = randomUUID();

		const tokenData = {
			token,
			clientId: client.client_id,
			scopes: codeData.params.scopes || [],
			expiresAt: Date.now() + 3600000, // 1 hour
			resource: codeData.params.resource,
			type: "access",
			extra: {
				refreshToken,
			},
		};

		this.tokens.set(token, tokenData);

		return {
			access_token: token,
			token_type: "bearer",
			expires_in: 3600,
			scope: (codeData.params.scopes || []).join(" "),
			refresh_token: refreshToken,
		};
	}

	async exchangeRefreshToken(
		client: OAuthClientInformationFull,
		refreshToken: string,
		scopes?: string[],
		resource?: URL,
	): Promise<OAuthTokens> {
		// Find the token data that matches this refresh token
		const tokenEntry = Array.from(this.tokens.entries()).find(
			([_, data]) => data.extra?.refreshToken === refreshToken,
		);

		if (!tokenEntry) {
			throw new Error("Invalid refresh token");
		}

		const [oldToken, tokenData] = tokenEntry;

		// Verify the client
		if (tokenData.clientId !== client.client_id) {
			throw new Error("Refresh token was not issued to this client");
		}

		// Delete old token
		this.tokens.delete(oldToken);

		// Generate new tokens
		const newToken = randomUUID();
		const newRefreshToken = randomUUID();

		// Create new token data
		const newTokenData = {
			token: newToken,
			clientId: client.client_id,
			scopes: scopes || tokenData.scopes,
			expiresAt: Date.now() + 3600000, // 1 hour
			resource: resource || tokenData.resource,
			type: "access",
			extra: {
				refreshToken: newRefreshToken,
			},
		};

		this.tokens.set(newToken, newTokenData);

		return {
			access_token: newToken,
			token_type: "bearer",
			expires_in: 3600,
			scope: (newTokenData.scopes || []).join(" "),
			refresh_token: newRefreshToken,
		};
	}

	async verifyAccessToken(token: string): Promise<AuthInfo> {
		const tokenData = this.tokens.get(token);
		if (!tokenData || !tokenData.expiresAt || tokenData.expiresAt < Date.now()) {
			throw new Error("Invalid or expired token");
		}

		return {
			token,
			clientId: tokenData.clientId,
			scopes: tokenData.scopes,
			expiresAt: Math.floor(tokenData.expiresAt / 1000),
			resource: tokenData.resource,
		};
	}
}

export const setupAuthServer = ({
	authServerUrl,
	mcpServerUrl,
	strictResource,
}: {
	authServerUrl: URL;
	mcpServerUrl: URL;
	strictResource: boolean;
}): OAuthMetadata => {
	// Create separate auth server app
	// NOTE: This is a separate app on a separate port to illustrate
	// how to separate an OAuth Authorization Server from a Resource
	// server in the SDK. The SDK is not intended to be provide a standalone
	// authorization server.

	const validateResource = strictResource
		? (resource?: URL) => {
				if (!resource) return false;
				const expectedResource = resourceUrlFromServerUrl(mcpServerUrl);
				return resource.toString() === expectedResource.toString();
			}
		: undefined;

	const provider = new DemoInMemoryAuthProvider(validateResource);
	const authApp = express();
	authApp.use(express.json());
	// For introspection requests
	authApp.use(express.urlencoded());

	// Add OAuth routes to the auth server
	// NOTE: this will also add a protected resource metadata route,
	// but it won't be used, so leave it.
	authApp.use(
		mcpAuthRouter({
			provider,
			issuerUrl: authServerUrl,
			scopesSupported: ["mcp:tools"],
		}),
	);

	authApp.post("/introspect", async (req: Request, res: Response) => {
		try {
			const { token } = req.body;
			if (!token) {
				res.status(400).json({ error: "Token is required" });
				return;
			}

			const tokenInfo = await provider.verifyAccessToken(token);
			res.json({
				active: true,
				client_id: tokenInfo.clientId,
				scope: tokenInfo.scopes.join(" "),
				exp: tokenInfo.expiresAt,
				aud: tokenInfo.resource,
			});
			return;
		} catch (error) {
			res.status(401).json({
				active: false,
				error: "Unauthorized",
				error_description: `Invalid token: ${error}`,
			});
		}
	});

	const auth_port = authServerUrl.port;
	// Start the auth server
	authApp.listen(auth_port, () => {
		console.log(`OAuth Authorization Server listening on port ${auth_port}`);
	});

	// Note: we could fetch this from the server, but then we end up
	// with some top level async which gets annoying.
	const oauthMetadata: OAuthMetadata = createOAuthMetadata({
		provider,
		issuerUrl: authServerUrl,
		scopesSupported: ["mcp:tools"],
	});

	oauthMetadata.introspection_endpoint = new URL("/introspect", authServerUrl).href;

	return oauthMetadata;
};
