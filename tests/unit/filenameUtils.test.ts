import {
  sanitizeFilename,
  getTitleOrDefault,
  formatWikilinkPath,
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
      created_at: "2024-01-15T10:30:00Z",
    };

    const result = getTitleOrDefault(doc);
    expect(result).toMatch(/^Untitled Granola Note at \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/);
  });
});

describe("formatWikilinkPath", () => {
  it("should wrap paths with spaces in angle brackets", () => {
    const path = "Transcripts/My Meeting Transcript.md";
    const result = formatWikilinkPath(path);
    expect(result).toBe("<Transcripts/My Meeting Transcript.md>");
  });

  it("should not wrap paths without spaces in angle brackets", () => {
    const path = "Transcripts/TestNote-transcript.md";
    const result = formatWikilinkPath(path);
    expect(result).toBe("Transcripts/TestNote-transcript.md");
  });

  it("should wrap paths with special characters in angle brackets", () => {
    const path = "Transcripts/Meeting: Q1 Planning.md";
    const result = formatWikilinkPath(path);
    expect(result).toBe("<Transcripts/Meeting: Q1 Planning.md>");
  });

  it("should wrap paths with pipe characters in angle brackets", () => {
    const path = "Transcripts/Meeting|Notes.md";
    const result = formatWikilinkPath(path);
    expect(result).toBe("<Transcripts/Meeting|Notes.md>");
  });

  it("should wrap paths with question marks in angle brackets", () => {
    const path = "Transcripts/What? Meeting.md";
    const result = formatWikilinkPath(path);
    expect(result).toBe("<Transcripts/What? Meeting.md>");
  });

  it("should wrap paths with asterisks in angle brackets", () => {
    const path = "Transcripts/Important*Meeting.md";
    const result = formatWikilinkPath(path);
    expect(result).toBe("<Transcripts/Important*Meeting.md>");
  });

  it("should handle paths with multiple spaces", () => {
    const path = "Folder/My Very Long Meeting Name.md";
    const result = formatWikilinkPath(path);
    expect(result).toBe("<Folder/My Very Long Meeting Name.md>");
  });

  it("should handle paths with no special characters", () => {
    const path = "folder/file-name.md";
    const result = formatWikilinkPath(path);
    expect(result).toBe("folder/file-name.md");
  });

  it("should handle empty paths", () => {
    const path = "";
    const result = formatWikilinkPath(path);
    expect(result).toBe("");
  });
});
