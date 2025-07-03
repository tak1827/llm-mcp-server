import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import logger from "../utils/logger";

// Zod schemas as the single source of truth
const MCPClientSchema = z.object({
	client_name: z.string(),
	server_url: z.string(),
	auth_server_url: z.string(),
	redirect_uris: z.array(z.string()),
	scope: z.string(),
	client_id: z.string(),
	client_secret: z.string(),
});

const UserSchema = z.object({
	user_id: z.string(),
	bearer_token: z.string(),
	mcp_clients: z.array(MCPClientSchema),
});

// Derive TypeScript types from Zod schemas
export type MCPClientJsonSchema = z.infer<typeof MCPClientSchema>;
export type UserJsonSchema = z.infer<typeof UserSchema>;

/**
 * Reads all user JSON files from the ./data/users directory and validates their format
 * @returns Promise<UserJsonSchema[]> Array of validated user data
 * @throws Error if files don't exist, can't be read, or don't match the schema
 */
export async function readUserJsonFiles(usersDirPath?: string): Promise<UserJsonSchema[]> {
	// 1. Get absolute path of the data/users directory
	const usersDir = usersDirPath || resolve(process.cwd(), "data", "users");
	logger.debug(`[users] Reading user files from: ${usersDir}`);

	try {
		// 2. Identify all files ending with .json
		const files = await readdir(usersDir);
		const jsonFiles = files.filter((file) => file.endsWith(".json"));

		if (jsonFiles.length === 0) {
			logger.warn("[users] No JSON files found in users directory");
			return [];
		}

		const users: UserJsonSchema[] = [];

		// 3. Read all the content of each file
		for (const file of jsonFiles) {
			const filePath = join(usersDir, file);
			logger.trace(`[users] Reading file: ${file}`);

			try {
				const fileContent = await readFile(filePath, "utf-8");
				const userData = JSON.parse(fileContent);

				// 4. Verify the format aligns with UserJsonSchema
				const validatedUser = UserSchema.parse(userData);
				users.push(validatedUser);

				logger.trace(`[users] Successfully validated user: ${validatedUser.user_id}`);
			} catch (parseError) {
				if (parseError instanceof SyntaxError) {
					throw new Error(`Invalid JSON in file ${file}: ${parseError.message}`);
				} else if (parseError instanceof z.ZodError) {
					const errorMessages = parseError.errors
						.map((err) => `${err.path.join(".")}: ${err.message}`)
						.join(", ");
					throw new Error(`Schema validation failed for ${file}: ${errorMessages}`);
				} else {
					throw new Error(`Failed to process file ${file}: ${parseError}`);
				}
			}
		}

		logger.info(`[users] Successfully loaded ${users.length} user(s)`);
		return users;
	} catch (error) {
		if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(
				`Users directory not found: ${usersDir}. Please create the directory and add user JSON files.`,
			);
		}
		throw error;
	}
}
