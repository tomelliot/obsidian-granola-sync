import { sanitizeFilename } from "../../src/utils/filenameUtils";

describe("sanitizeFilename", () => {
  describe("invalid character removal", () => {
    it("should remove invalid filesystem characters", () => {
      expect(sanitizeFilename('file<name')).toBe('filename');
      expect(sanitizeFilename('file>name')).toBe('filename');
      expect(sanitizeFilename('file:name')).toBe('filename');
      expect(sanitizeFilename('file"name')).toBe('filename');
      expect(sanitizeFilename('file/name')).toBe('filename');
      expect(sanitizeFilename('file\\name')).toBe('filename');
      expect(sanitizeFilename('file|name')).toBe('filename');
      expect(sanitizeFilename('file?name')).toBe('filename');
      expect(sanitizeFilename('file*name')).toBe('filename');
    });

    it("should remove multiple invalid characters", () => {
      expect(sanitizeFilename('file<>:name')).toBe('filename');
      expect(sanitizeFilename('file"/\\|?*name')).toBe('filename');
    });

    it("should handle strings with only invalid characters", () => {
      expect(sanitizeFilename('<>:"/\\|?*')).toBe('');
    });
  });

  describe("whitespace handling", () => {
    it("should replace single spaces with underscores", () => {
      expect(sanitizeFilename('my file name')).toBe('my_file_name');
    });

    it("should replace multiple consecutive spaces with a single underscore", () => {
      expect(sanitizeFilename('my   file   name')).toBe('my_file_name');
    });

    it("should handle tabs and other whitespace characters", () => {
      expect(sanitizeFilename('my\tfile\nname')).toBe('my_file_name');
    });

    it("should handle leading and trailing spaces", () => {
      expect(sanitizeFilename('  my file name  ')).toBe('_my_file_name_');
    });
  });

  describe("length truncation", () => {
    it("should truncate filenames longer than 200 characters", () => {
      const longTitle = "a".repeat(250);
      const result = sanitizeFilename(longTitle);
      expect(result.length).toBe(200);
      expect(result).toBe("a".repeat(200));
    });

    it("should not truncate filenames shorter than 200 characters", () => {
      const shortTitle = "a".repeat(150);
      const result = sanitizeFilename(shortTitle);
      expect(result.length).toBe(150);
      expect(result).toBe(shortTitle);
    });

    it("should handle exactly 200 character filenames", () => {
      const exactTitle = "a".repeat(200);
      const result = sanitizeFilename(exactTitle);
      expect(result.length).toBe(200);
      expect(result).toBe(exactTitle);
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings", () => {
      expect(sanitizeFilename('')).toBe('');
    });

    it("should handle strings with mixed invalid characters and spaces", () => {
      expect(sanitizeFilename('my file: name* with? invalid')).toBe('my_file_name_with_invalid');
    });

    it("should handle valid filenames unchanged (except spaces)", () => {
      expect(sanitizeFilename('valid-filename_123')).toBe('valid-filename_123');
    });

    it("should handle special but valid characters", () => {
      expect(sanitizeFilename('file.name-with_special(chars)')).toBe('file.name-with_special(chars)');
    });

    it("should handle unicode characters", () => {
      expect(sanitizeFilename('文件名')).toBe('文件名');
      expect(sanitizeFilename('файл名')).toBe('файл名');
    });
  });

  describe("combined transformations", () => {
    it("should remove invalid chars, replace spaces, and truncate in one pass", () => {
      const title = 'my file: name* ' + 'a'.repeat(200);
      const result = sanitizeFilename(title);
      expect(result.length).toBe(200);
      expect(result).not.toContain(':');
      expect(result).not.toContain('*');
      expect(result).not.toContain(' ');
    });
  });
});
