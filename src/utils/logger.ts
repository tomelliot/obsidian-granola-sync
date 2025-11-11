// Simple logger utility for development mode debugging
// Uses console.debug which is typically filtered in production browser dev tools

const isDevelopment =
  !process.env.NODE_ENV || process.env.NODE_ENV === "development";

export const log = {
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.debug("[Granola Sync]", ...args);
    }
  },
};
