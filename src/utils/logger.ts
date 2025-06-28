import pino from "pino";

/* eslint-disable no-unused-vars */
enum LogLevel {
	FATAL = "fatal",
	ERROR = "error",
	WARN = "warn",
	INFO = "info",
	DEBUG = "debug",
	TRACE = "trace",
}
/* eslint-disable no-unused-vars */

let loggerInstance: pino.Logger | null = null;

export function logger(level: LogLevel = process.env.LOG_LEVEL as LogLevel): pino.Logger {
	if (!Object.values(LogLevel).includes(level as LogLevel)) {
		throw new Error(
			`Invalid log level: ${level}. Supported levels are: ${Object.values(LogLevel).join(", ")}`,
		);
	}

	if (!loggerInstance) {
		loggerInstance = pino({
			level,
			transport: {
				target: "pino-pretty",
				options: {
					colorize: true,
					translateTime: "SYS:yyyy-mm-dd HH:MM:ss o",
				},
			},
		});
	}

	return loggerInstance;
}

// Default export for convenience
export default logger();

