import { createLogger } from "@tomelliot/obsidian-logger";

export const log = createLogger("Granola Sync");
export const configureLogger = log.configureFileLogging;
