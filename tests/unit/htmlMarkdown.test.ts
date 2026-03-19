import { convertHtmlToMarkdown } from "../../src/services/htmlMarkdown";
import * as fs from "fs";
import * as path from "path";

describe("convertHtmlToMarkdown", () => {
  it("should convert an example HTML doc to the expected markdown fixture", () => {
    const htmlPath = path.join(__dirname, "htmlMarkdown-examples/example01.html");
    const expectedPath = path.join(
      __dirname,
      "htmlMarkdown-examples/example01.md"
    );
    const html = fs.readFileSync(htmlPath, "utf8");
    const expected = fs.readFileSync(expectedPath, "utf8");

    const result = convertHtmlToMarkdown(html);

    expect(result.trim()).toBe(expected.trim());
  });

  it("should convert ordered lists", () => {
    const html = "<ol><li>First</li><li>Second</li></ol>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("1. First\n2. Second\n");
  });

  it("should convert fenced code blocks", () => {
    const html = "<pre>line1\nline2</pre>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("```\nline1\nline2\n```\n");
  });

  it("should preserve unknown tags by flattening their children", () => {
    const html = "<article><p>Hello <span>there</span></p></article>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("Hello there\n");
  });

  it.todo(
    "should convert HTML tables to markdown table syntax (not yet supported)"
  );

  it("should convert line breaks inside paragraphs", () => {
    const html = "<p>first line<br/>second line</p><p>next paragraph</p>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("first line\nsecond line\n\nnext paragraph\n");
  });

  it("should convert blockquotes", () => {
    const html = "<blockquote><p>This is quoted text</p></blockquote>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("> This is quoted text\n");
  });

  it("should convert multi-line blockquotes", () => {
    const html =
      "<blockquote><p>Line one</p><p>Line two</p></blockquote>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toContain("> Line one");
    expect(result).toContain("> ");
    expect(result).toContain("> Line two");
  });

  it("should convert inline code", () => {
    const html = "<p>Use the <code>convertHtmlToMarkdown</code> function</p>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("Use the `convertHtmlToMarkdown` function\n");
  });

  it("should convert standalone inline code at block level", () => {
    const html = "<code>inline code</code>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("`inline code`\n");
  });

  it("should convert <b> and <i> tags like <strong> and <em>", () => {
    const html = "<p>This is <b>bold</b> and <i>italic</i></p>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("This is **bold** and *italic*\n");
  });

  it("should convert nested inline <b> and <i> inside paragraphs", () => {
    const html = "<p>Some <b>bold with <i>nested italic</i></b> text</p>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("Some **bold with *nested italic*** text\n");
  });

  it("should convert h4, h5, and h6 headings", () => {
    const html = "<h4>Four</h4><h5>Five</h5><h6>Six</h6>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toContain("#### Four");
    expect(result).toContain("##### Five");
    expect(result).toContain("###### Six");
  });

  it("should convert links with nested inline formatting", () => {
    const html =
      '<p>See <a href="https://example.com"><strong>this link</strong></a></p>';

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("See [**this link**](https://example.com)\n");
  });

  it("should handle nested ordered list inside unordered list", () => {
    const html =
      "<ul><li>Item<ol><li>Sub one</li><li>Sub two</li></ol></li></ul>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toContain("- Item");
    expect(result).toContain("\t1. Sub one");
    expect(result).toContain("\t2. Sub two");
  });

  it("should handle nested unordered list inside ordered list", () => {
    const html =
      "<ol><li>Item<ul><li>Sub a</li><li>Sub b</li></ul></li></ol>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toContain("1. Item");
    expect(result).toContain("\t- Sub a");
    expect(result).toContain("\t- Sub b");
  });

  it("should handle nested ordered list inside ordered list", () => {
    const html =
      "<ol><li>Item<ol><li>Sub one</li><li>Sub two</li></ol></li></ol>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toContain("1. Item");
    expect(result).toContain("\t1. Sub one");
    expect(result).toContain("\t2. Sub two");
  });

  it("should handle list items with direct text nodes", () => {
    const html = "<ul><li>Direct text</li></ul>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("- Direct text\n");
  });

  it("should handle ordered list items with direct text nodes", () => {
    const html = "<ol><li>Direct text</li></ol>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("1. Direct text\n");
  });

  it("should handle div and section as transparent containers", () => {
    const html = "<div><section><p>Nested content</p></section></div>";

    const result = convertHtmlToMarkdown(html);

    expect(result).toBe("Nested content\n");
  });

  it("should collapse excessive blank lines", () => {
    const html = "<p>One</p><p></p><p></p><p>Two</p>";

    const result = convertHtmlToMarkdown(html);

    // Should not have more than one blank line between paragraphs
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain("One");
    expect(result).toContain("Two");
  });

  it("should handle empty input", () => {
    const result = convertHtmlToMarkdown("");
    expect(result).toBe("\n");
  });

  it("should handle plain text without HTML tags", () => {
    const result = convertHtmlToMarkdown("Just plain text");
    expect(result).toBe("Just plain text\n");
  });
});
