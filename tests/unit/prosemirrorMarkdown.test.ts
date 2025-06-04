import {
  convertProsemirrorToMarkdown,
  ProseMirrorDoc,
} from "../../src/services/prosemirrorMarkdown";

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
});
