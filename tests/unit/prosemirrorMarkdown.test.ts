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

  it("should convert a top-level ordered list to numbered markdown", () => {
    const doc: ProseMirrorDoc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "First" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Second" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertProsemirrorToMarkdown(doc);
    expect(result).toBe("1. First\n2. Second\n");
  });

  it("honours the `start` attribute on ordered lists", () => {
    const doc: ProseMirrorDoc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 5 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Fifth" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Sixth" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertProsemirrorToMarkdown(doc);
    expect(result).toBe("5. Fifth\n6. Sixth\n");
  });

  it("renders an ordered list nested under a bulleted item without dropping content", () => {
    // Reproducer for the bug where bulletList → listItem → orderedList children
    // were silently dropped because only nested bulletLists were preserved.
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
                  content: [
                    { type: "text", text: "Meeting agenda priorities:" },
                  ],
                },
                {
                  type: "orderedList",
                  attrs: { start: 1 },
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "Updates since last conversation" },
                          ],
                        },
                      ],
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "Define 5 broad success metrics" },
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
                  content: [{ type: "text", text: "Other bullet" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertProsemirrorToMarkdown(doc);
    expect(result).toBe(
      "- Meeting agenda priorities:\n" +
        "\t1. Updates since last conversation\n" +
        "\t2. Define 5 broad success metrics\n" +
        "- Other bullet\n"
    );
  });

  it("renders a bulleted list nested under an ordered item", () => {
    const doc: ProseMirrorDoc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Step one" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "Detail" }],
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
                  content: [{ type: "text", text: "Step two" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = convertProsemirrorToMarkdown(doc);
    expect(result).toBe(
      "1. Step one\n\t- Detail\n2. Step two\n"
    );
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
