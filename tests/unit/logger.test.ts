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

  describe("file logging integration", () => {
    it("should append a formatted line when debug logging is enabled", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog, configureLogger } = require("../../src/utils/logger");
      const appendLine = jest.fn();

      configureLogger({
        isDebugEnabled: () => true,
        appendLine,
      });

      prodLog.debug("Debug message", { foo: "bar" });

      expect(appendLine).toHaveBeenCalledTimes(1);
      const line = appendLine.mock.calls[0][0] as string;
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp prefix
      expect(line).toContain("[DEBUG]");
      expect(line).toContain("Debug message");
      expect(line).toContain('"foo":"bar"');
      expect(line.endsWith("\n")).toBe(true);

      configureLogger(null);
    });

    it("should not append when debug logging is disabled", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog, configureLogger } = require("../../src/utils/logger");
      const appendLine = jest.fn();

      configureLogger({
        isDebugEnabled: () => false,
        appendLine,
      });

      prodLog.info("Info message");

      expect(appendLine).not.toHaveBeenCalled();

      configureLogger(null);
    });

    it("should log debug to console when isDebugEnabled returns true in production", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog, configureLogger } = require("../../src/utils/logger");
      const appendLine = jest.fn();

      configureLogger({
        isDebugEnabled: () => true,
        appendLine,
      });

      prodLog.debug("Debug visible in prod");

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        "[Granola Sync]",
        "Debug visible in prod"
      );

      configureLogger(null);
    });

    it("should log info to console when isDebugEnabled returns true in production", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog, configureLogger } = require("../../src/utils/logger");
      const appendLine = jest.fn();

      configureLogger({
        isDebugEnabled: () => true,
        appendLine,
      });

      prodLog.info("Info visible in prod");

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[Granola Sync]",
        "Info visible in prod"
      );

      configureLogger(null);
    });

    it("should not log debug to console when isDebugEnabled returns false in production", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog, configureLogger } = require("../../src/utils/logger");
      const appendLine = jest.fn();

      configureLogger({
        isDebugEnabled: () => false,
        appendLine,
      });

      prodLog.debug("Should not appear");

      expect(consoleDebugSpy).not.toHaveBeenCalled();

      configureLogger(null);
    });

    it("should serialize Error instances in file logs", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { log: prodLog, configureLogger } = require("../../src/utils/logger");
      const appendLine = jest.fn();

      configureLogger({
        isDebugEnabled: () => true,
        appendLine,
      });

      const error = new Error("Something went wrong");
      prodLog.error("Error occurred", error);

      expect(appendLine).toHaveBeenCalledTimes(1);
      const line = appendLine.mock.calls[0][0] as string;
      expect(line).toContain("[ERROR]");
      expect(line).toContain("Error occurred");
      expect(line).toContain("Something went wrong");

      configureLogger(null);
    });
  });

});
