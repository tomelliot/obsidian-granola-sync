import { GranolaDoc } from "../services/granolaApi";

/**
 * Gets the note date from a Granola document, preferring created_at,
 * then falling back to updated_at, and finally to the current date.
 *
 * @param doc - The Granola document to extract the date from
 * @returns The date associated with the document
 */
export function getNoteDate(doc: GranolaDoc): Date {
  if (doc.created_at) return new Date(doc.created_at);
  if (doc.updated_at) return new Date(doc.updated_at);
  return new Date();
}

/**
 * Formats a date as a filename-safe human-readable string.
 * Format: YYYY-MM-DD HH-MM (e.g., "2024-01-15 10-30")
 *
 * @param date - The date to format
 * @returns Filename-safe date string
 */
export function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}-${minutes}`;
}
