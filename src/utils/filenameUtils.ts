import { GranolaDoc } from "../services/granolaApi";
import { getNoteDate, formatDateForFilename } from "./dateUtils";

/**
 * Sanitizes a filename by removing invalid characters and ensuring proper length.
 *
 * @param title - The original filename/title to sanitize
 * @returns A sanitized filename safe for filesystem operations
 */
export function sanitizeFilename(title: string): string {
  const invalidChars = /[<>:"/\\|?*]/g;
  let filename = title.replace(invalidChars, "_");
  // Truncate filename if too long (e.g., 200 chars, common limit)
  const maxLength = 200;
  if (filename.length > maxLength) {
    filename = filename.substring(0, maxLength);
  }
  return filename.trim();
}

/**
 * Gets the title from a document, or generates a default title with timestamp if missing.
 *
 * @param doc - The Granola document
 * @returns The document title or a default title with timestamp
 */
export function getTitleOrDefault(doc: GranolaDoc): string {
  if (doc.title) {
    return doc.title;
  }
  const noteDate = getNoteDate(doc);
  const formattedDate = formatDateForFilename(noteDate);
  return `Untitled Granola Note at ${formattedDate}`;
}

/**
 * Formats a file path for use in Obsidian wikilinks.
 * Always wraps the path in angle brackets for proper linking in Obsidian.
 *
 * @param path - The file path to format
 * @returns The path formatted for wikilink usage (with angle brackets)
 */
export function formatWikilinkPath(path: string): string {
  // Always wrap paths in angle brackets for Obsidian wikilinks
  if (path === "") {
    return "";
  }
  return `<${path}>`;
}
