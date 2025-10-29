/**
 * Sanitizes a filename by removing invalid characters and ensuring proper length.
 *
 * @param title - The original filename/title to sanitize
 * @returns A sanitized filename safe for filesystem operations
 */
export function sanitizeFilename(title: string): string {
  const invalidChars = /[<>:"/\\|?*]/g;
  let filename = title.replace(invalidChars, "");
  filename = filename.replace(/\s+/g, "_"); // Replace one or more spaces with a single underscore
  // Truncate filename if too long (e.g., 200 chars, common limit)
  const maxLength = 200;
  if (filename.length > maxLength) {
    filename = filename.substring(0, maxLength);
  }
  return filename;
}
