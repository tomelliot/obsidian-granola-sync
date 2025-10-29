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
