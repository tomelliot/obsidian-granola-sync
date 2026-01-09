import { normalizePath } from "obsidian";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";
import moment from "moment";
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

/**
 * Computes the full file path for a daily note based on its date.
 * Uses the daily notes plugin settings to determine the structure.
 * This is a standalone utility for use across the codebase.
 *
 * @param noteDate - The date of the note
 * @returns The full file path for the daily note (including .md extension)
 */
export function computeDailyNoteFilePath(noteDate: Date): string {
  const dailyNoteSettings = getDailyNoteSettings();
  const noteMoment = moment(noteDate);

  // Format the date according to the daily note format
  const formattedPath = noteMoment.format(
    dailyNoteSettings.format || "YYYY-MM-DD"
  );

  // Combine with the base daily notes folder
  const baseFolder = dailyNoteSettings.folder || "";
  return normalizePath(
    baseFolder ? `${baseFolder}/${formattedPath}.md` : `${formattedPath}.md`
  );
}
