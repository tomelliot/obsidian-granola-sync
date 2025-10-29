import {
  createDailyNote,
  getDailyNote,
  getAllDailyNotes,
} from "obsidian-daily-notes-interface";
import moment from "moment";
import { TFile } from "obsidian";
import { GranolaDoc } from "./granolaApi";
import { convertProsemirrorToMarkdown } from "./prosemirrorMarkdown";
import { getNoteDate } from "../utils/dateUtils";

export interface DailyNoteEntry {
  title: string;
  docId: string;
  createdAt?: string;
  updatedAt?: string;
  markdown: string;
}

export interface DailyNoteBuildOptions {
  includeTranscriptLinks: boolean;
  computeTranscriptPath?: (title: string, noteDate: Date) => string;
}

/**
 * Service for building daily notes from Granola documents.
 */
export class DailyNoteBuilder {
  /**
   * Builds a map of daily notes grouped by date.
   *
   * @param documents - Array of Granola documents to process
   * @returns Map of date keys (YYYY-MM-DD) to arrays of note entries
   */
  buildMap(documents: GranolaDoc[]): Map<string, DailyNoteEntry[]> {
    const dailyNotesMap = new Map<string, DailyNoteEntry[]>();

    for (const doc of documents) {
      const contentToParse = doc.last_viewed_panel?.content;
      if (!contentToParse || contentToParse.type !== "doc") {
        continue;
      }

      const title = doc.title || "Untitled Granola Note";
      const docId = doc.id || "unknown_id";
      const markdownContent = convertProsemirrorToMarkdown(contentToParse);
      const noteDate = getNoteDate(doc);
      const mapKey = moment(noteDate).format("YYYY-MM-DD");

      if (!dailyNotesMap.has(mapKey)) {
        dailyNotesMap.set(mapKey, []);
      }

      dailyNotesMap.get(mapKey)!.push({
        title,
        docId,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        markdown: markdownContent,
      });
    }

    return dailyNotesMap;
  }

  /**
   * Gets an existing daily note or creates a new one for the given date.
   *
   * @param dateKey - Date string in YYYY-MM-DD format
   * @returns The daily note file
   */
  async getOrCreate(dateKey: string): Promise<TFile> {
    const noteMoment = moment(dateKey, "YYYY-MM-DD");
    let dailyNoteFile = getDailyNote(noteMoment, getAllDailyNotes());

    if (!dailyNoteFile) {
      dailyNoteFile = await createDailyNote(noteMoment);
    }

    return dailyNoteFile;
  }

  /**
   * Builds the section content for notes on a given day.
   *
   * @param notesForDay - Array of notes for the day
   * @param sectionHeading - The heading for the section
   * @param dateKey - Date string in YYYY-MM-DD format (for fallback dates)
   * @param options - Build options for transcript links
   * @returns Formatted markdown content for the section
   */
  buildSectionContent(
    notesForDay: DailyNoteEntry[],
    sectionHeading: string,
    dateKey: string,
    options: DailyNoteBuildOptions = { includeTranscriptLinks: false }
  ): string {
    if (notesForDay.length === 0) {
      return sectionHeading;
    }

    let content = sectionHeading;

    for (const note of notesForDay) {
      content += `\n### ${note.title}\n`;
      content += `**Granola ID:** ${note.docId}\n`;

      if (note.createdAt) {
        content += `**Created:** ${note.createdAt}\n`;
      }
      if (note.updatedAt) {
        content += `**Updated:** ${note.updatedAt}\n`;
      }

      if (
        options.includeTranscriptLinks &&
        options.computeTranscriptPath
      ) {
        const noteDate = this.getNoteDateFromNote(note, dateKey);
        const transcriptPath = options.computeTranscriptPath(note.title, noteDate);
        content += `**Transcript:** [[${transcriptPath}]]\n`;
      }

      content += `\n${note.markdown}\n`;
    }

    return content.trim() + "\n";
  }

  /**
   * Helper method to get the date for a note entry.
   *
   * @param note - The note entry
   * @param fallbackDateKey - Fallback date string if note dates are missing
   * @returns The note date
   */
  private getNoteDateFromNote(
    note: {
      createdAt?: string;
      updatedAt?: string;
    },
    fallbackDateKey: string
  ): Date {
    if (note.createdAt) return new Date(note.createdAt);
    if (note.updatedAt) return new Date(note.updatedAt);
    return new Date(fallbackDateKey);
  }
}
