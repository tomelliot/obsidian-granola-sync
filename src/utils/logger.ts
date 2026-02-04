// Logger utility for consistent logging throughout the application
// Uses console methods with consistent "[Granola Sync]" prefix
// Debug and info messages are only shown in development mode

export const isDevelopment =
  !process.env.NODE_ENV || process.env.NODE_ENV === "development";

export const log = {
  /**
   * Logs debug messages (only in development mode)
   */
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.debug("[Granola Sync]", ...args);
    }
  },

  /**
   * Logs informational messages (only in development mode)
   */
  info: (...args: unknown[]) => {
    if (isDevelopment) {
      console.info("[Granola Sync]", ...args);
    }
  },

  /**
   * Logs warning messages
   */
  warn: (...args: unknown[]) => {
    console.warn("[Granola Sync]", ...args);
  },

  /**
   * Logs error messages (always shown, not filtered by development mode)
   */
  error: (...args: unknown[]) => {
    console.error("[Granola Sync]", ...args);
  },
};
