import * as v from "valibot";
import { printValidationIssuePaths } from "../../src/services/granolaApi";
import {
  GranolaApiResponseSchema,
  TranscriptResponseSchema,
} from "../../src/services/validationSchemas";

describe("printValidationIssuePaths", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("should not print anything when validation succeeds", () => {
    const validData = { docs: [] };
    const result = v.safeParse(GranolaApiResponseSchema, validData);

    printValidationIssuePaths(result);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("should print validation issues with paths for GranolaApiResponseSchema", () => {
    // Create invalid data that will fail validation
    const invalidData = {
      docs: [
        {
          id: 123, // Should be string, not number
          title: null,
        },
      ],
    };
    const result = v.safeParse(GranolaApiResponseSchema, invalidData);

    expect(result.success).toBe(false);
    printValidationIssuePaths(result);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[Granola Sync]",
      "Validation issues:"
    );
    // Should have at least one issue logged (header + at least one issue)
    expect(consoleErrorSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Check that issue messages are logged
    const logCalls = consoleErrorSpy.mock.calls;
    const issueLogs = logCalls.filter((call) =>
      call[1]?.toString().startsWith("  Issue")
    );
    expect(issueLogs.length).toBeGreaterThan(0);
  });

  it("should print root path when issue has no path", () => {
    // Create invalid data at root level
    const invalidData = "not an object";
    const result = v.safeParse(GranolaApiResponseSchema, invalidData);

    expect(result.success).toBe(false);
    printValidationIssuePaths(result);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[Granola Sync]",
      "Validation issues:"
    );
    // Should log issue with root path
    const logCalls = consoleErrorSpy.mock.calls;
    const rootPathLog = logCalls.find((call) =>
      call[1]?.toString().includes("path: (root)")
    );
    expect(rootPathLog).toBeDefined();
  });

  it("should print nested paths correctly", () => {
    // Create invalid data with nested path issues
    const invalidData = {
      docs: [
        {
          id: "valid-id",
          title: "Valid Title",
          people: {
            attendees: [
              {
                name: 123, // Should be string, not number
                email: "test@example.com",
              },
            ],
          },
        },
      ],
    };
    const result = v.safeParse(GranolaApiResponseSchema, invalidData);

    expect(result.success).toBe(false);
    printValidationIssuePaths(result);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[Granola Sync]",
      "Validation issues:"
    );
    // Should have path information in the logs
    const logCalls = consoleErrorSpy.mock.calls;
    const pathLogs = logCalls.filter((call) =>
      call[1]?.toString().includes("path:")
    );
    expect(pathLogs.length).toBeGreaterThan(0);
  });

  it("should handle array index paths correctly", () => {
    // Create invalid data with array index issues
    const invalidData = {
      docs: [
        {
          id: "valid-id-1",
          title: null,
        },
        {
          id: 456, // Should be string, not number
          title: null,
        },
      ],
    };
    const result = v.safeParse(GranolaApiResponseSchema, invalidData);

    expect(result.success).toBe(false);
    printValidationIssuePaths(result);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[Granola Sync]",
      "Validation issues:"
    );
    // Check that paths are formatted correctly
    const logCalls = consoleErrorSpy.mock.calls;
    const allLogs = logCalls
      .map((call) => call[1]?.toString() || "")
      .join("\n");
    // Should contain array index notation like [1] or [0]
    expect(allLogs).toMatch(/\[[0-9]+\]/);
  });

  it("should handle TranscriptResponseSchema validation failures", () => {
    // Create invalid transcript data
    const invalidData = [
      {
        document_id: "doc-123",
        start_timestamp: "invalid", // Should be valid timestamp
        text: "Some text",
        source: "source",
        id: "transcript-1",
        is_final: "not a boolean", // Should be boolean
        end_timestamp: "invalid",
      },
    ];
    const result = v.safeParse(TranscriptResponseSchema, invalidData);

    expect(result.success).toBe(false);
    printValidationIssuePaths(result);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[Granola Sync]",
      "Validation issues:"
    );
    // Should have logged issues
    const logCalls = consoleErrorSpy.mock.calls;
    const issueLogs = logCalls.filter((call) =>
      call[1]?.toString().startsWith("  Issue")
    );
    expect(issueLogs.length).toBeGreaterThan(0);
  });

  it("should format string paths with dot notation", () => {
    // Create invalid data with string key paths
    const invalidData = {
      docs: [
        {
          id: "valid-id",
          title: null,
          people: {
            attendees: [
              {
                name: "Valid Name",
                email: 123, // Should be string, not number
              },
            ],
          },
        },
      ],
    };
    const result = v.safeParse(GranolaApiResponseSchema, invalidData);

    expect(result.success).toBe(false);
    printValidationIssuePaths(result);

    const logCalls = consoleErrorSpy.mock.calls;
    const allLogs = logCalls
      .map((call) => call[1]?.toString() || "")
      .join("\n");
    // Should contain dot notation like .email or .people
    expect(allLogs).toMatch(/\.[a-zA-Z_][a-zA-Z0-9_]*/);
  });

  it("should handle multiple issues correctly", () => {
    // Create invalid data with multiple issues
    const invalidData = {
      docs: [
        {
          id: 123, // Invalid type
          title: null,
          created_at: 456, // Invalid type
        },
      ],
    };
    const result = v.safeParse(GranolaApiResponseSchema, invalidData);
    expect(result.success).toBe(false);
    printValidationIssuePaths(result);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[Granola Sync]",
      "Validation issues:"
    );
    // Should log multiple issues
    const logCalls = consoleErrorSpy.mock.calls;
    const issueLogs = logCalls.filter((call) =>
      call[1]?.toString().startsWith("  Issue")
    );
    expect(issueLogs.length).toBeGreaterThan(0);
    // Check that issue numbers are sequential
    const issueNumbers = issueLogs.map((call) => {
      const match = call[1]?.toString().match(/Issue (\d+):/);
      return match ? parseInt(match[1], 10) : null;
    });
    expect(issueNumbers[0]).toBe(1);
  });
});
