import {
  convertProsemirrorToMarkdown,
  ProseMirrorDoc,
} from "../../src/services/prosemirrorMarkdown";
import * as fs from "fs";
import * as path from "path";
import * as example from "./proseMirror-examples/example01.json";

describe("convertProsemirrorToMarkdown", () => {
  it("should convert nested bullet lists to Markdown with correct indentation", () => {
    const doc: ProseMirrorDoc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item 1" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Subitem 1.1" }],
                        },
                        {
                          type: "bulletList",
                          content: [
                            {
                              type: "listItem",
                              content: [
                                {
                                  type: "paragraph",
                                  content: [
                                    { type: "text", text: "Subsubitem 1.1.1" },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Subitem 1.2" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item 2" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const expected = [
      "- Item 1",
      "	- Subitem 1.1",
      "		- Subsubitem 1.1.1",
      "	- Subitem 1.2",
      "- Item 2",
      "",
    ].join("\n");

    const result = convertProsemirrorToMarkdown(doc);
    expect(result).toBe(expected);
  });

  it("should convert headings of various levels to Markdown", () => {
    const doc: ProseMirrorDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Heading 1" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Heading 2" }],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Heading 3" }],
        },
      ],
    };

    const expected = [
      "# Heading 1",
      "",
      "## Heading 2",
      "",
      "### Heading 3",
      "",
    ].join("\n");

    const result = convertProsemirrorToMarkdown(doc);
    expect(result).toBe(expected);
  });

  it("should convert the example JSON doc to the expected markdown from the .md file", () => {
    // Use the first doc's notes
    const doc = example as ProseMirrorDoc;
    // Read the expected markdown from the .md file
    const mdPath = path.join(__dirname, "proseMirror-examples/example01.md");
    const expected = fs.readFileSync(mdPath, "utf8");
    const result = convertProsemirrorToMarkdown(doc);
    expect(result.trim()).toBe(expected.trim());
  });
});
