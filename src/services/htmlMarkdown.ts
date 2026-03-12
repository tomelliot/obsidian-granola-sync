/**
 * Converts an HTML string to Markdown.
 *
 * The Granola API sometimes returns note content as an HTML string instead of
 * a ProseMirror JSON document. This module handles that case by converting the
 * HTML into Markdown that matches the output of the ProseMirror converter.
 *
 * Runs in Obsidian's Electron environment where DOMParser is available.
 */

/**
 * Convert an HTML string to Markdown.
 *
 * @param html - The HTML string to convert
 * @returns Markdown string
 */
export function convertHtmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const output = processChildren(doc.body, 0);
  return output.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function processChildren(element: Node, indentLevel: number): string {
  let result = "";
  for (const child of Array.from(element.childNodes)) {
    result += processNode(child, indentLevel);
  }
  return result;
}

function processNode(node: Node, indentLevel: number): string {
  // Text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }

  // Element nodes
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = parseInt(tag.charAt(1), 10);
      const text = getInlineContent(el).trim();
      return `${"#".repeat(level)} ${text}\n\n`;
    }
    case "p": {
      const text = getInlineContent(el);
      return text + "\n\n";
    }
    case "ul":
      return processListItems(el, indentLevel) + "\n\n";
    case "ol":
      return processOrderedListItems(el, indentLevel) + "\n\n";
    case "br":
      return "\n";
    case "strong":
    case "b":
      return `**${getInlineContent(el)}**`;
    case "em":
    case "i":
      return `*${getInlineContent(el)}*`;
    case "a": {
      const href = el.getAttribute("href") || "";
      const text = getInlineContent(el);
      return `[${text}](${href})`;
    }
    case "code":
      return `\`${el.textContent || ""}\``;
    case "pre":
      return `\`\`\`\n${el.textContent || ""}\n\`\`\`\n\n`;
    case "blockquote": {
      const content = processChildren(el, indentLevel).trim();
      return (
        content
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      );
    }
    case "div":
    case "section":
    case "article":
      return processChildren(el, indentLevel);
    default:
      return processChildren(el, indentLevel);
  }
}

/**
 * Get inline content from an element, handling nested inline elements like
 * strong, em, a, code, etc.
 */
function getInlineContent(el: HTMLElement): string {
  let result = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent || "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      const tag = childEl.tagName.toLowerCase();
      switch (tag) {
        case "strong":
        case "b":
          result += `**${getInlineContent(childEl)}**`;
          break;
        case "em":
        case "i":
          result += `*${getInlineContent(childEl)}*`;
          break;
        case "a": {
          const href = childEl.getAttribute("href") || "";
          result += `[${getInlineContent(childEl)}](${href})`;
          break;
        }
        case "code":
          result += `\`${childEl.textContent || ""}\``;
          break;
        case "br":
          result += "\n";
          break;
        default:
          result += getInlineContent(childEl);
      }
    }
  }
  return result;
}

function processListItems(ul: HTMLElement, indentLevel: number): string {
  const items: string[] = [];
  for (const child of Array.from(ul.children)) {
    if (child.tagName.toLowerCase() === "li") {
      const indent = "\t".repeat(indentLevel);
      const parts: string[] = [];
      let nestedLists = "";

      for (const liChild of Array.from(child.childNodes)) {
        if (liChild.nodeType === Node.TEXT_NODE) {
          const text = (liChild.textContent || "").trim();
          if (text) parts.push(text);
        } else if (liChild.nodeType === Node.ELEMENT_NODE) {
          const liChildEl = liChild as HTMLElement;
          const tag = liChildEl.tagName.toLowerCase();
          if (tag === "ul") {
            nestedLists +=
              "\n" + processListItems(liChildEl, indentLevel + 1);
          } else if (tag === "ol") {
            nestedLists +=
              "\n" + processOrderedListItems(liChildEl, indentLevel + 1);
          } else {
            parts.push(getInlineContent(liChildEl));
          }
        }
      }

      items.push(`${indent}- ${parts.join(" ").trim()}${nestedLists}`);
    }
  }
  return items.join("\n");
}

function processOrderedListItems(
  ol: HTMLElement,
  indentLevel: number
): string {
  const items: string[] = [];
  let index = 1;
  for (const child of Array.from(ol.children)) {
    if (child.tagName.toLowerCase() === "li") {
      const indent = "\t".repeat(indentLevel);
      const parts: string[] = [];
      let nestedLists = "";

      for (const liChild of Array.from(child.childNodes)) {
        if (liChild.nodeType === Node.TEXT_NODE) {
          const text = (liChild.textContent || "").trim();
          if (text) parts.push(text);
        } else if (liChild.nodeType === Node.ELEMENT_NODE) {
          const liChildEl = liChild as HTMLElement;
          const tag = liChildEl.tagName.toLowerCase();
          if (tag === "ul") {
            nestedLists +=
              "\n" + processListItems(liChildEl, indentLevel + 1);
          } else if (tag === "ol") {
            nestedLists +=
              "\n" + processOrderedListItems(liChildEl, indentLevel + 1);
          } else {
            parts.push(getInlineContent(liChildEl));
          }
        }
      }

      items.push(
        `${indent}${index}. ${parts.join(" ").trim()}${nestedLists}`
      );
      index++;
    }
  }
  return items.join("\n");
}
