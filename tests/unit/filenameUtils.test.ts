import {
  sanitizeFilename,
  getTitleOrDefault,
  validatePattern,
  resolveFilenamePattern,
  resolveSubfolderPattern,
  resolveDocFilename,
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

describe("validatePattern", () => {
  it("should validate pattern with valid variables", () => {
    const result = validatePattern("{title}-{date}");
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject pattern with invalid variables", () => {
    const result = validatePattern("{title}-{invalid}");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("Invalid variable: {invalid}");
  });

  it("should reject empty pattern", () => {
    const result = validatePattern("");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Pattern cannot be empty");
  });

  it("should accept pattern with no variables", () => {
    const result = validatePattern("static-filename");
    expect(result.isValid).toBe(true);
  });

  it("should accept all valid variables", () => {
    const result = validatePattern(
      "{title}-{date}-{time}-{year}-{month}-{day}-{quarter}"
    );
    expect(result.isValid).toBe(true);
  });
});

describe("resolveFilenamePattern", () => {
  const testDate = new Date("2024-03-15T14:30:45Z");

  it("should resolve {title} variable", () => {
    const result = resolveFilenamePattern("{title}", "Test Meeting", testDate);
    expect(result).toBe("Test Meeting");
  });

  it("should resolve {date} variable", () => {
    const result = resolveFilenamePattern("{date}", "Test", testDate);
    expect(result).toBe("2024-03-15");
  });

  it("should resolve {time} variable", () => {
    const result = resolveFilenamePattern("{time}", "Test", testDate);
    expect(result).toBe("14-30-45");
  });

  it("should resolve {year} variable", () => {
    const result = resolveFilenamePattern("{year}", "Test", testDate);
    expect(result).toBe("2024");
  });

  it("should resolve {month} variable", () => {
    const result = resolveFilenamePattern("{month}", "Test", testDate);
    expect(result).toBe("03");
  });

  it("should resolve {day} variable", () => {
    const result = resolveFilenamePattern("{day}", "Test", testDate);
    expect(result).toBe("15");
  });

  it("should resolve {quarter} variable", () => {
    const result = resolveFilenamePattern("{quarter}", "Test", testDate);
    expect(result).toBe("1");
  });

  it("should resolve multiple variables", () => {
    const result = resolveFilenamePattern(
      "{date}-{title}",
      "Test Meeting",
      testDate
    );
    expect(result).toBe("2024-03-15-Test Meeting");
  });

  it("should sanitize title in pattern", () => {
    const result = resolveFilenamePattern(
      "{title}",
      "Test: Meeting/Notes",
      testDate
    );
    expect(result).toBe("Test_ Meeting_Notes");
  });

  it("should handle pattern with no variables", () => {
    const result = resolveFilenamePattern("static-name", "Test", testDate);
    expect(result).toBe("static-name");
  });
});

describe("resolveSubfolderPattern", () => {
  const testDate = new Date("2024-03-15T14:30:45Z");

  it("should return empty string for 'none' pattern", () => {
    const result = resolveSubfolderPattern("none", testDate);
    expect(result).toBe("");
  });

  it("should resolve 'day' pattern", () => {
    const result = resolveSubfolderPattern("day", testDate);
    expect(result).toBe("2024-03-15");
  });

  it("should resolve 'month' pattern", () => {
    const result = resolveSubfolderPattern("month", testDate);
    expect(result).toBe("2024-03");
  });

  it("should resolve 'year-month' pattern", () => {
    const result = resolveSubfolderPattern("year-month", testDate);
    expect(result).toBe("2024/03");
  });

  it("should resolve 'year-quarter' pattern", () => {
    const result = resolveSubfolderPattern("year-quarter", testDate);
    expect(result).toBe("2024/Q1");
  });

  it("should resolve custom pattern with {year}/{month}", () => {
    const result = resolveSubfolderPattern(
      "custom",
      testDate,
      "{year}/{month}"
    );
    expect(result).toBe("2024/03");
  });

  it("should resolve custom pattern with {year}/Q{quarter}", () => {
    const result = resolveSubfolderPattern(
      "custom",
      testDate,
      "{year}/Q{quarter}"
    );
    expect(result).toBe("2024/Q1");
  });

  it("should handle custom pattern with no variables", () => {
    const result = resolveSubfolderPattern("custom", testDate, "static-folder");
    expect(result).toBe("static-folder");
  });

  it("should return empty string for custom pattern without customPattern", () => {
    const result = resolveSubfolderPattern("custom", testDate);
    expect(result).toBe("");
  });

  it("should handle Q4 quarter correctly", () => {
    const q4Date = new Date("2024-12-15T14:30:45Z");
    const result = resolveSubfolderPattern("year-quarter", q4Date);
    expect(result).toBe("2024/Q4");
  });

  it("should return empty string for invalid pattern type", () => {
    const result = resolveSubfolderPattern(
      "invalid" as any,
      new Date("2024-03-15")
    );
    expect(result).toBe("");
  });
});

describe("resolveDocFilename", () => {
  it("should resolve filename from doc with title pattern", () => {
    const doc: GranolaDoc = {
      id: "doc-123",
      title: "Test Meeting",
      created_at: "2024-03-15T14:30:45Z",
    };

    const result = resolveDocFilename(doc, "{title}");
    expect(result).toBe("Test Meeting.md");
  });

  it("should resolve filename from doc with date-title pattern", () => {
    const doc: GranolaDoc = {
      id: "doc-123",
      title: "Test Meeting",
      created_at: "2024-03-15T14:30:45Z",
    };

    const result = resolveDocFilename(doc, "{date}-{title}");
    expect(result).toBe("2024-03-15-Test Meeting.md");
  });

  it("should use default title when doc has no title", () => {
    const doc: GranolaDoc = {
      id: "doc-123",
      created_at: "2024-03-15T14:30:45Z",
    };

    const result = resolveDocFilename(doc, "{title}");
    expect(result).toContain("Untitled Granola Note");
    expect(result.endsWith(".md")).toBe(true);
  });

  it("should handle transcript filename pattern", () => {
    const doc: GranolaDoc = {
      id: "doc-123",
      title: "Test Meeting",
      created_at: "2024-03-15T14:30:45Z",
    };

    const result = resolveDocFilename(doc, "{title}-transcript");
    expect(result).toBe("Test Meeting-transcript.md");
  });
});
