import type { ProseMirrorDoc, ProseMirrorNode } from "./granolaApi";

export function convertProsemirrorToMarkdown(
  doc: ProseMirrorDoc | null | undefined
): string {
  if (!doc || doc.type !== "doc" || !doc.content) {
    return "";
  }

  const markdownOutput: string[] = [];

  const processNode = (
    node: ProseMirrorNode,
    indentLevel = 0,
    isTopLevel = false
  ): string => {
    if (!node || typeof node !== "object") return "";

    let textContent = "";
    if (node.content && Array.isArray(node.content)) {
      if (node.type === "bulletList") {
        textContent = node.content
          .map((child) => processNode(child, indentLevel, false))
          .join("");
      } else if (node.type === "listItem") {
        textContent = node.content
          .map((child) => {
            if (child.type === "bulletList") {
              return processNode(child, indentLevel + 1, false);
            } else {
              return processNode(child, indentLevel, false);
            }
          })
          .join("");
      } else {
        textContent = node.content
          .map((child) => processNode(child, indentLevel, false))
          .join("");
      }
    } else if (node.text) {
      textContent = node.text;
    }

    switch (node.type) {
      case "heading": {
        const level =
          typeof node.attrs?.level === "number" ? node.attrs.level : 1;
        return `${"#".repeat(level)} ${textContent.trim()}${
          isTopLevel ? "\n\n" : "\n"
        }`;
      }
      case "paragraph":
        // Only add double newlines for top-level paragraphs
        return textContent + (isTopLevel ? "\n\n" : "");
      case "bulletList": {
        if (!node.content) return "";
        const items = node.content
          .map((itemNode) => {
            if (itemNode.type === "listItem") {
              // Gather all child content, separating paragraphs and nested lists by newlines
              const childContents = (itemNode.content || []).map((child) => {
                if (child.type === "bulletList") {
                  return "\n" + processNode(child, indentLevel + 1, false);
                } else {
                  return processNode(child, indentLevel, false);
                }
              });
              // The first non-bulletList child is the main item text
              const firstText =
                childContents.find((c) => !c.startsWith("\n")) || "";
              // The rest (if any) are nested lists
              const rest = childContents
                .filter((c) => c.startsWith("\n"))
                .join("");
              const indent = "	".repeat(Math.max(0, indentLevel));
              return `${indent}- ${firstText.trim()}${rest}`;
            }
            return "";
          })
          .filter((item) => item.length > 0);
        // Only add double newlines for top-level bullet lists
        return items.join("\n") + (isTopLevel ? "\n\n" : "");
      }
      case "text":
        return node.text || "";
      default:
        return textContent;
    }
  };

  doc.content.forEach((node) => {
    markdownOutput.push(processNode(node, 0, true));
  });

  return (
    markdownOutput
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}
