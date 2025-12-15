import { escapeYamlString } from "../../src/utils/yamlUtils";

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
    expect(escapeYamlString("O'Brien")).toBe("\"O'Brien\"");
    expect(escapeYamlString("It's fine")).toBe("\"It's fine\"");
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
