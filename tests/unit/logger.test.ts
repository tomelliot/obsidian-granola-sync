import { log } from "../../src/utils/logger";

describe("logger", () => {
  let consoleDebugSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let originalEnv: string | undefined;

  beforeEach(() => {
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation();
    consoleInfoSpy = jest.spyOn(console, "info").mockImplementation();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
    // Clear module cache to reload logger with new NODE_ENV
    jest.resetModules();
  });

  describe("development mode filtering", () => {
    it("should log debug messages in development mode", () => {
      process.env.NODE_ENV = "development";
      jest.resetModules();
      const { log: devLog } = require("../../src/utils/logger");

      devLog.debug("Debug message");

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        "[Granola Sync]",
        "Debug message"
      );
    });

    it("should not log debug messages in production mode", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog } = require("../../src/utils/logger");

      prodLog.debug("Debug message");

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it("should log debug messages when NODE_ENV is undefined", () => {
      delete process.env.NODE_ENV;
      jest.resetModules();
      const { log: defaultLog } = require("../../src/utils/logger");

      defaultLog.debug("Debug message");

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        "[Granola Sync]",
        "Debug message"
      );
    });

    it("should log info messages in development mode", () => {
      process.env.NODE_ENV = "development";
      jest.resetModules();
      const { log: devLog } = require("../../src/utils/logger");

      devLog.info("Info message");

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[Granola Sync]",
        "Info message"
      );
    });

    it("should not log info messages in production mode", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog } = require("../../src/utils/logger");

      prodLog.info("Info message");

      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });
  });

  describe("always-on logging", () => {
    it("should always log warn messages regardless of environment", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog } = require("../../src/utils/logger");

      prodLog.warn("Warning message");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[Granola Sync]",
        "Warning message"
      );
    });

    it("should always log error messages regardless of environment", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog } = require("../../src/utils/logger");

      prodLog.error("Error message");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Granola Sync]",
        "Error message"
      );
    });
  });

});
