import fs from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import * as dotenv from "dotenv";

// Load environment variables from .env file
function loadEnv(): () => void {
	// Never load environment variables more than once
	let loaded = false;

	return (): void => {
		if (loaded) return;

		const paths = [resolve(process.cwd(), ".env.local"), resolve(process.cwd(), ".env")];
		if (process.env.AI_AGENT_ENV_PATH) paths.push(process.env.AI_AGENT_ENV_PATH); // For server
		dotenv.config({ path: paths });

		loaded = true;
	};
}

// Execute at module load
loadEnv()();

type EnvParser<T> = (value: string) => T;

function getEnv<T>(envName: string, parser: EnvParser<T>): T {
	const rawValue = process.env[envName];

	// Check for missing or empty value
	if (rawValue === undefined || rawValue === "") {
		throw new Error(`Missing required environment variable: ${envName}`);
	}

	try {
		return parser(rawValue);
	} catch (error) {
		throw new Error(`Failed to parse ${envName}: ${(error as Error).message}`);
	}
}

const stringParser: EnvParser<string> = (value) => value;

const numberParser: EnvParser<number> = (value) => {
	const parsed = Number(value);
	if (Number.isNaN(parsed)) {
		throw new Error("Invalid number format");
	}
	return parsed;
};

const booleanParser: EnvParser<boolean> = (value) => {
	if (/^(true|1)$/i.test(value)) return true;
	if (/^(false|0)$/i.test(value)) return false;
	throw new Error("Invalid boolean value");
};

const pathParser: EnvParser<string> = (value) => {
	if (!fs.existsSync(value)) {
		throw new Error(`path not found: ${value}`);
	}
	return value;
};

const ethKeyParser: EnvParser<string> = (value) => {
	if (!/^(0x)?[0-9a-f]{64}$/i.test(value)) {
		throw new Error("Invalid Ethereum private key format");
	}
	return value;
};

const contractAddressParser: EnvParser<string> = (value) => {
	if (!/^(0x)?[0-9a-f]{40}$/i.test(value)) {
		throw new Error("Invalid Ethereum contract address format");
	}
	return value;
};

export const Env = {
	string: (envName: string) => getEnv<string>(envName, stringParser),
	number: (envName: string) => getEnv<number>(envName, numberParser),
	boolean: (envName: string) => getEnv<boolean>(envName, booleanParser),
	path: (envName: string) => getEnv<string>(envName, pathParser),
	ethKey: (envName: string) => getEnv<string>(envName, ethKeyParser),
	contractAddress: (envName: string) => getEnv<string>(envName, contractAddressParser),
	json: <T>(envName: string) => getEnv<T>(envName, JSON.parse),
	array: (envName: string, separator = ",") =>
		getEnv<string[]>(envName, (value) => value.split(separator)),
};
