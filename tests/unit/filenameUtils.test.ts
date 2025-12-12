import {
  sanitizeFilename,
  getTitleOrDefault,
} from "../../src/utils/filenameUtils";
import { GranolaDoc } from "../../src/services/granolaApi";

describe("sanitizeFilename", () => {
  it("should replace invalid characters with underscores", () => {
    const filename = 'test<file>name:with"invalid/chars\\and|more?*chars';
    const result = sanitizeFilename(filename);
    expect(result).toBe("test_file_name_with_invalid_chars_and_more__chars");
  });

  it("should preserve spaces in filenames", () => {
    const filename = "test file name with spaces";
    const result = sanitizeFilename(filename);
    expect(result).toBe("test file name with spaces");
  });

  it("should truncate long filenames to 200 characters", () => {
    const longFilename = "a".repeat(250);
    const result = sanitizeFilename(longFilename);
    expect(result.length).toBe(200);
    expect(result).toBe("a".repeat(200));
  });

  it("should handle empty strings", () => {
    const filename = "";
    const result = sanitizeFilename(filename);
    expect(result).toBe("");
  });

  it("should handle strings with only invalid characters", () => {
    const filename = '<>:"/\\|?*';
    const result = sanitizeFilename(filename);
    expect(result).toBe("_________");
  });

  it("should handle strings with only spaces", () => {
    const filename = "   ";
    const result = sanitizeFilename(filename);
    expect(result).toBe("");
  });

  it("should handle normal filenames without changes", () => {
    const filename = "normal file name";
    const result = sanitizeFilename(filename);
    expect(result).toBe("normal file name");
  });

  it("should handle filenames with special characters that are valid", () => {
    const filename = "file-name_with.special!chars@#$%^&()[]{}";
    const result = sanitizeFilename(filename);
    expect(result).toBe("file-name_with.special!chars@#$%^&()[]{}");
  });

  it("should handle mixed invalid characters and spaces", () => {
    const filename = "test: file / name * with ? invalid | chars";
    const result = sanitizeFilename(filename);
    expect(result).toBe("test_ file _ name _ with _ invalid _ chars");
  });

  it("should handle filenames at exactly 200 characters", () => {
    const filename = "b".repeat(200);
    const result = sanitizeFilename(filename);
    expect(result.length).toBe(200);
    expect(result).toBe("b".repeat(200));
  });
});

describe("getTitleOrDefault", () => {
  it("should return the document title when it exists", () => {
    const doc: GranolaDoc = {
      id: "doc-123",
      title: "My Meeting Notes",
    };

    const result = getTitleOrDefault(doc);
    expect(result).toBe("My Meeting Notes");
  });

  it("should return default title with timestamp when title is missing", () => {
    const doc: GranolaDoc = {
      id: "doc-123",
      title: null,
      created_at: "2024-01-15T10:30:00Z",
    };

    const result = getTitleOrDefault(doc);
    expect(result).toMatch(
      /^Untitled Granola Note at \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/
    );
  });
});
