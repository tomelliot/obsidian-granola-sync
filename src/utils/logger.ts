// Logger utility for consistent logging throughout the application.
// Uses console methods with a consistent "[Granola Sync]" prefix.
// Debug and info messages are only shown in development mode for console output.

const isDevelopment =
  !process.env.NODE_ENV || process.env.NODE_ENV === "development";

type LogLevel = "debug" | "info" | "warn" | "error";

interface FileLoggerConfig {
  /**
   * Returns true when debug logging to file should be active.
   * This should typically read the current settings at call time so it always
   * reflects the latest configuration without needing to reconfigure.
   */
  isDebugEnabled: () => boolean;

  /**
   * Append a single, already-formatted log line to the debug log file.
   * This function is responsible for any filesystem concerns, including
   * rotation and error handling. It must never throw.
   */
  appendLine: (line: string) => void | Promise<void>;
}

let fileLoggerConfig: FileLoggerConfig | null = null;

export function configureLogger(config: FileLoggerConfig | null): void {
  fileLoggerConfig = config;
}

function serializeArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }

  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  return String(arg);
}

function logToFile(level: LogLevel, args: unknown[]): void {
  if (!fileLoggerConfig || !fileLoggerConfig.isDebugEnabled()) {
    return;
  }

  const timestamp = new Date().toISOString();
  const message = args.map(serializeArg).join(" ");
  const line = `${timestamp} [${level.toUpperCase()}] ${message}\n`;

  try {
    const result = fileLoggerConfig.appendLine(line);
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => {
        // Swallow any async errors to avoid affecting plugin behavior
      });
    }
  } catch {
    // Swallow synchronous errors from appendLine as well
  }
}

export const log = {
  /**
   * Logs debug messages (only in development mode for console),
   * but always eligible for file logging when debug logging is enabled.
   */
  debug: (...args: unknown[]) => {
    if (isDevelopment || fileLoggerConfig?.isDebugEnabled()) {
      console.debug("[Granola Sync]", ...args);
    }
    logToFile("debug", args);
  },

  /**
   * Logs informational messages (only in development mode for console),
   * but always eligible for file logging when debug logging is enabled.
   */
  info: (...args: unknown[]) => {
    if (isDevelopment || fileLoggerConfig?.isDebugEnabled()) {
      console.info("[Granola Sync]", ...args);
    }
    logToFile("info", args);
  },

  /**
   * Logs warning messages.
   */
  warn: (...args: unknown[]) => {
    console.warn("[Granola Sync]", ...args);
    logToFile("warn", args);
  },

  /**
   * Logs error messages (always shown, not filtered by development mode).
   */
  error: (...args: unknown[]) => {
    console.error("[Granola Sync]", ...args);
    logToFile("error", args);
  },
};

