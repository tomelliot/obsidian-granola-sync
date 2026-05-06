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
 * Returns the most recent of `doc.updated_at` and `doc.last_viewed_panel.updated_at`.
 *
 * The note body is rendered from `last_viewed_panel.content`, but Granola only
 * advances the doc-level `updated_at` for some kinds of edits — regenerating the
 * AI summary panel can change the panel without touching the doc timestamp. Using
 * the max of both keeps the staleness check and the persisted `updated`
 * frontmatter aligned with what's actually displayed.
 *
 * @param doc - The Granola document
 * @returns The later ISO timestamp, or undefined if neither is set
 */
export function getEffectiveUpdatedAt(doc: GranolaDoc): string | undefined {
  const docUpdated = doc.updated_at ?? undefined;
  const panelUpdated = doc.last_viewed_panel?.updated_at ?? undefined;

  if (!docUpdated) return panelUpdated;
  if (!panelUpdated) return docUpdated;

  const docTime = Date.parse(docUpdated);
  const panelTime = Date.parse(panelUpdated);

  if (isNaN(docTime)) return panelUpdated;
  if (isNaN(panelTime)) return docUpdated;

  return panelTime > docTime ? panelUpdated : docUpdated;
}

/**
 * Formats a date as a filename-safe human-readable string.
 * Format: YYYY-MM-DD HH-MM-SS (e.g., "2024-01-15 10-30-45")
 *
 * @param date - The date to format
 * @returns Filename-safe date string
 */
export function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
}
