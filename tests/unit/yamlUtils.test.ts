import {
  escapeYamlString,
  formatAttendeesAsYaml,
} from "../../src/utils/yamlUtils";

describe("escapeYamlString", () => {
  it("should wrap simple strings in double quotes", () => {
    expect(escapeYamlString("Alice")).toBe('"Alice"');
    expect(escapeYamlString("Bob Smith")).toBe('"Bob Smith"');
  });

  it("should handle empty strings", () => {
    expect(escapeYamlString("")).toBe('""');
  });

  it("should escape double quotes", () => {
    expect(escapeYamlString('Say "Hello"')).toBe('"Say \\"Hello\\""');
    expect(escapeYamlString('"quoted"')).toBe('"\\"quoted\\""');
  });

  it("should escape backslashes", () => {
    expect(escapeYamlString("path\\to\\file")).toBe('"path\\\\to\\\\file"');
    expect(escapeYamlString("\\")).toBe('"\\\\"');
  });

  it("should escape backslashes before quotes", () => {
    expect(escapeYamlString('\\"')).toBe('"\\\\\\""');
  });

  it("should handle colons safely", () => {
    expect(escapeYamlString("key: value")).toBe('"key: value"');
    expect(escapeYamlString(":")).toBe('":"');
  });

  it("should handle asterisks safely", () => {
    expect(escapeYamlString("*important*")).toBe('"*important*"');
    expect(escapeYamlString("***")).toBe('"***"');
  });

  it("should handle at signs safely", () => {
    expect(escapeYamlString("user@example.com")).toBe('"user@example.com"');
    expect(escapeYamlString("@mention")).toBe('"@mention"');
  });

  it("should handle hash signs safely", () => {
    expect(escapeYamlString("#hashtag")).toBe('"#hashtag"');
    expect(escapeYamlString("value # comment")).toBe('"value # comment"');
  });

  it("should handle brackets safely", () => {
    expect(escapeYamlString("[array]")).toBe('"[array]"');
    expect(escapeYamlString("{object}")).toBe('"{object}"');
  });

  it("should handle ampersands safely", () => {
    expect(escapeYamlString("&anchor")).toBe('"&anchor"');
    expect(escapeYamlString("Tom & Jerry")).toBe('"Tom & Jerry"');
  });

  it("should handle percent signs safely", () => {
    expect(escapeYamlString("%TAG")).toBe('"%TAG"');
    expect(escapeYamlString("100%")).toBe('"100%"');
  });

  it("should handle question marks and exclamation marks safely", () => {
    expect(escapeYamlString("What?")).toBe('"What?"');
    expect(escapeYamlString("!important")).toBe('"!important"');
  });

  it("should handle pipe and greater-than signs safely", () => {
    expect(escapeYamlString("|literal")).toBe('"|literal"');
    expect(escapeYamlString(">folded")).toBe('">folded"');
  });

  it("should handle mixed special characters", () => {
    expect(escapeYamlString('*John "Johnny" Doe*')).toBe(
      '"*John \\"Johnny\\" Doe*"'
    );
    expect(escapeYamlString("user@example.com: admin")).toBe(
      '"user@example.com: admin"'
    );
  });

  it("should handle names with apostrophes", () => {
    expect(escapeYamlString("O'Brien")).toBe('"O\'Brien"');
    expect(escapeYamlString("It's fine")).toBe('"It\'s fine"');
  });

  it("should handle unicode characters", () => {
    expect(escapeYamlString("José García")).toBe('"José García"');
    expect(escapeYamlString("田中太郎")).toBe('"田中太郎"');
  });

  it("should handle leading/trailing spaces", () => {
    expect(escapeYamlString(" leading")).toBe('" leading"');
    expect(escapeYamlString("trailing ")).toBe('"trailing "');
    expect(escapeYamlString("  both  ")).toBe('"  both  "');
  });
});

describe("formatAttendeesAsYaml", () => {
  it("should format a single attendee with leading newline", () => {
    expect(formatAttendeesAsYaml(["Alice"])).toBe('\n  - "Alice"');
  });

  it("should format multiple attendees with leading newline", () => {
    const result = formatAttendeesAsYaml(["Alice", "Bob Smith", "Carol"]);
    expect(result).toBe('\n  - "Alice"\n  - "Bob Smith"\n  - "Carol"');
  });

  it("should return [] for empty array", () => {
    expect(formatAttendeesAsYaml([])).toBe("[]");
  });

  it("should properly escape special characters in attendee names", () => {
    const result = formatAttendeesAsYaml(['John "Johnny" Doe', "O'Brien"]);
    expect(result).toBe('\n  - "John \\"Johnny\\" Doe"\n  - "O\'Brien"');
  });

  it("should handle attendees with backslashes", () => {
    const result = formatAttendeesAsYaml(["path\\to\\user"]);
    expect(result).toBe('\n  - "path\\\\to\\\\user"');
  });

  it("should handle attendees with special YAML characters", () => {
    const result = formatAttendeesAsYaml([
      "user@example.com",
      "#hashtag",
      "key: value",
    ]);
    expect(result).toBe(
      '\n  - "user@example.com"\n  - "#hashtag"\n  - "key: value"'
    );
  });

  it("should handle unicode characters in attendee names", () => {
    const result = formatAttendeesAsYaml(["José García", "田中太郎"]);
    expect(result).toBe('\n  - "José García"\n  - "田中太郎"');
  });

  it("should maintain proper indentation for all items", () => {
    const result = formatAttendeesAsYaml(["A", "B", "C"]);
    const lines = result.split("\n");
    // First line is empty (the leading newline), then 3 items
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("");
    lines.slice(1).forEach((line) => {
      expect(line.startsWith("  - ")).toBe(true);
    });
  });
});
