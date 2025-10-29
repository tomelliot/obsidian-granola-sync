import { GranolaDoc } from "../services/granolaApi";
import { getNoteDate } from "./dateUtils";

/**
 * Filters documents based on date range criteria.
 *
 * @param documents - Array of Granola documents to filter
 * @param daysBack - Number of days to look back (0 = no filtering, return all)
 * @returns Filtered array of documents within the date range
 */
export function filterDocumentsByDate(
  documents: GranolaDoc[],
  daysBack: number
): GranolaDoc[] {
  // If daysBack is 0, return all documents (no filtering)
  if (daysBack === 0) {
    return documents;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  return documents.filter((doc) => {
    const docDate = getNoteDate(doc);
    return docDate >= cutoffDate;
  });
}
