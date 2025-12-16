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
 * Available variables for filename and subfolder patterns.
 */
export const PATTERN_VARIABLES = {
  title: "{title}",
  date: "{date}",
  time: "{time}",
  year: "{year}",
  month: "{month}",
  day: "{day}",
  quarter: "{quarter}",
} as const;

/**
 * Validates a custom pattern string to ensure it only contains valid variables.
 *
 * @param pattern - The pattern string to validate
 * @returns An object with isValid flag and optional error message
 */
export function validatePattern(pattern: string): {
  isValid: boolean;
  error?: string;
} {
  if (!pattern || pattern.trim().length === 0) {
    return { isValid: false, error: "Pattern cannot be empty" };
  }

  // Extract all variables from the pattern
  const variableRegex = /\{([^}]+)\}/g;
  const matches = pattern.matchAll(variableRegex);
  const validVariables = Object.keys(PATTERN_VARIABLES);

  for (const match of matches) {
    const variable = match[1];
    if (!validVariables.includes(variable)) {
      return {
        isValid: false,
        error: `Invalid variable: {${variable}}. Valid variables are: ${validVariables.map((v) => `{${v}}`).join(", ")}`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Resolves a filename pattern by substituting variables with actual values.
 *
 * @param pattern - The filename pattern (e.g., "{title}", "{date}-{title}")
 * @param title - The document title
 * @param noteDate - The date of the note
 * @returns The resolved filename (without .md extension)
 */
export function resolveFilenamePattern(
  pattern: string,
  title: string,
  noteDate: Date
): string {
  const sanitizedTitle = sanitizeFilename(title);
  const year = noteDate.getFullYear().toString();
  const month = (noteDate.getMonth() + 1).toString().padStart(2, "0");
  const day = noteDate.getDate().toString().padStart(2, "0");
  const hours = noteDate.getHours().toString().padStart(2, "0");
  const minutes = noteDate.getMinutes().toString().padStart(2, "0");
  const seconds = noteDate.getSeconds().toString().padStart(2, "0");
  const quarter = Math.floor(noteDate.getMonth() / 3) + 1;

  const resolved = pattern
    .replace(/\{title\}/g, sanitizedTitle)
    .replace(/\{date\}/g, `${year}-${month}-${day}`)
    .replace(/\{time\}/g, `${hours}-${minutes}-${seconds}`)
    .replace(/\{year\}/g, year)
    .replace(/\{month\}/g, month)
    .replace(/\{day\}/g, day)
    .replace(/\{quarter\}/g, quarter.toString());

  // Sanitize the resolved pattern to remove any invalid characters
  return sanitizeFilename(resolved);
}

/**
 * Resolves a subfolder pattern by substituting date variables with actual values.
 *
 * @param pattern - The subfolder pattern type or custom pattern
 * @param noteDate - The date of the note
 * @param customPattern - Optional custom pattern if pattern is 'custom'
 * @returns The resolved subfolder path (empty string for 'none')
 */
export function resolveSubfolderPattern(
  pattern: "none" | "day" | "month" | "year-month" | "year-quarter" | "custom",
  noteDate: Date,
  customPattern?: string
): string {
  const year = noteDate.getFullYear().toString();
  const month = (noteDate.getMonth() + 1).toString().padStart(2, "0");
  const day = noteDate.getDate().toString().padStart(2, "0");
  const quarter = Math.floor(noteDate.getMonth() / 3) + 1;

  switch (pattern) {
    case "none":
      return "";
    case "day":
      return `${year}-${month}-${day}`;
    case "month":
      return `${year}-${month}`;
    case "year-month":
      return `${year}/${month}`;
    case "year-quarter":
      return `${year}/Q${quarter}`;
    case "custom":
      if (!customPattern) {
        return "";
      }
      return customPattern
        .replace(/\{year\}/g, year)
        .replace(/\{month\}/g, month)
        .replace(/\{day\}/g, day)
        .replace(/\{quarter\}/g, quarter.toString());
    default:
      return "";
  }
}
