import { escapeYamlString } from "../../src/utils/yamlUtils";

describe("escapeYamlString", () => {
  it("should wrap normal strings in double quotes", () => {
    const result = escapeYamlString("John Doe");
    expect(result).toBe('"John Doe"');
  });

  it("should handle empty strings", () => {
    const result = escapeYamlString("");
    expect(result).toBe('""');
  });

  it("should escape asterisks by wrapping in quotes", () => {
    const result = escapeYamlString("John* Doe");
    expect(result).toBe('"John* Doe"');
  });

  it("should escape colons by wrapping in quotes", () => {
    const result = escapeYamlString("John: Doe");
    expect(result).toBe('"John: Doe"');
  });

  it("should escape double quotes within the string", () => {
    const result = escapeYamlString('John "The Man" Doe');
    expect(result).toBe('"John \\"The Man\\" Doe"');
  });

  it("should escape backslashes within the string", () => {
    const result = escapeYamlString("John\\Doe");
    expect(result).toBe('"John\\\\Doe"');
  });

  it("should handle strings with multiple special characters", () => {
    const result = escapeYamlString('John* "The: Man" Doe\\Jr');
    expect(result).toBe('"John* \\"The: Man\\" Doe\\\\Jr"');
  });

  it("should handle strings with @ symbol", () => {
    const result = escapeYamlString("john@example.com");
    expect(result).toBe('"john@example.com"');
  });

  it("should handle strings with # symbol", () => {
    const result = escapeYamlString("John #1");
    expect(result).toBe('"John #1"');
  });

  it("should handle strings with brackets", () => {
    const result = escapeYamlString("John [CEO]");
    expect(result).toBe('"John [CEO]"');
  });

  it("should handle strings with curly braces", () => {
    const result = escapeYamlString("John {admin}");
    expect(result).toBe('"John {admin}"');
  });

  it("should handle strings with ampersand", () => {
    const result = escapeYamlString("John & Jane");
    expect(result).toBe('"John & Jane"');
  });

  it("should handle strings with exclamation mark", () => {
    const result = escapeYamlString("John!");
    expect(result).toBe('"John!"');
  });

  it("should handle strings with percent sign", () => {
    const result = escapeYamlString("100% Attendance");
    expect(result).toBe('"100% Attendance"');
  });

  it("should handle strings with pipe character", () => {
    const result = escapeYamlString("John | Manager");
    expect(result).toBe('"John | Manager"');
  });

  it("should handle strings with greater than and less than", () => {
    const result = escapeYamlString("John <CEO>");
    expect(result).toBe('"John <CEO>"');
  });

  it("should handle strings that start with special YAML characters", () => {
    const result = escapeYamlString("- John Doe");
    expect(result).toBe('"- John Doe"');
  });

  it("should handle strings with newlines", () => {
    const result = escapeYamlString("John\nDoe");
    expect(result).toBe('"John\nDoe"');
  });
});

