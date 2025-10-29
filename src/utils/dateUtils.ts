import { GranolaDoc } from "../services/granolaApi";

/**
 * Gets the date for a Granola document, using created_at if available,
 * falling back to updated_at, and finally to the current date.
 *
 * @param doc - The Granola document
 * @returns The date for the document
 */
export function getNoteDate(doc: GranolaDoc): Date {
  if (doc.created_at) return new Date(doc.created_at);
  if (doc.updated_at) return new Date(doc.updated_at);
  return new Date();
}
