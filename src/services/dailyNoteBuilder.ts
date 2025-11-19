import { App, TFile, Notice } from "obsidian";
import {
  createDailyNote,
  getDailyNote,
  getAllDailyNotes,
} from "obsidian-daily-notes-interface";
import moment from "moment";
import { GranolaDoc } from "./granolaApi";
import { getNoteDate } from "../utils/dateUtils";
import { DocumentProcessor } from "./documentProcessor";
import { PathResolver } from "./pathResolver";
import { updateSection } from "../utils/textUtils";
import {
  TranscriptSettings,
  NoteSettings,
  TranscriptLinkLocation,
} from "../settings";
import { log } from "../utils/logger";

export interface NoteData {
  title: string;
  docId: string;
  createdAt?: string;
  updatedAt?: string;
  markdown: string;
}

/**
 * Service for building and managing daily notes with Granola content.
 * Handles grouping notes by date, building section content, and updating daily notes.
 */
export class DailyNoteBuilder {
  constructor(
    private app: App,
    private documentProcessor: DocumentProcessor,
    private pathResolver: PathResolver,
    private settings: Pick<
      TranscriptSettings & NoteSettings,
      | "syncTranscripts"
      | "transcriptLinkLocation"
      | "dailyNoteSectionHeading"
    >
  ) {}

  /**
   * Groups documents by their date and extracts note data for each.
   *
   * @param documents - Array of Granola documents to process
   * @returns Map of date keys (YYYY-MM-DD) to arrays of note data
   */
  buildDailyNotesMap(documents: GranolaDoc[]): Map<string, NoteData[]> {
    const dailyNotesMap = new Map<string, NoteData[]>();

    for (const doc of documents) {
      const noteData = this.documentProcessor.extractNoteForDailyNote(doc);
      if (!noteData) {
        continue;
      }

      const noteDate = getNoteDate(doc);
      const mapKey = moment(noteDate).format("YYYY-MM-DD");

      if (!dailyNotesMap.has(mapKey)) {
        dailyNotesMap.set(mapKey, []);
      }

      dailyNotesMap.get(mapKey)!.push(noteData);
    }

    return dailyNotesMap;
  }

  /**
   * Gets or creates a daily note for the given date.
   *
   * @param dateKey - Date key in YYYY-MM-DD format
   * @returns The daily note file
   */
  async getOrCreateDailyNote(dateKey: string): Promise<TFile> {
    const noteMoment = moment(dateKey, "YYYY-MM-DD");
    let dailyNoteFile = getDailyNote(noteMoment, getAllDailyNotes());

    if (!dailyNoteFile) {
      dailyNoteFile = await createDailyNote(noteMoment);
    }

    return dailyNoteFile;
  }

  /**
   * Builds the section content for a daily note with the given notes.
   *
   * @param notesForDay - Array of note data for the day
   * @param sectionHeading - The heading to use for the section
   * @param dateKey - Date key for fallback date calculations
   * @returns The formatted section content
   */
  buildDailyNoteSectionContent(
    notesForDay: NoteData[],
    sectionHeading: string,
    dateKey: string
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
        this.settings.syncTranscripts &&
        this.settings.transcriptLinkLocation === TranscriptLinkLocation.LINK_AT_TOP
      ) {
        const noteDate = this.getNoteDateFromNote(note, dateKey);
        const transcriptPath = this.pathResolver.computeTranscriptPath(
          note.title,
          noteDate
        );

        content += `**Transcript:** [[<${transcriptPath}>]]\n`;
      }

      content += `\n${note.markdown}\n`;
    }

    return content.trim() + "\n";
  }

  /**
   * Updates a daily note section with the given content.
   *
   * @param dailyNoteFile - The daily note file to update
   * @param sectionHeading - The section heading to update
   * @param sectionContent - The new content for the section
   * @param forceOverwrite - If true, always updates the section even if content is unchanged
   */
  async updateDailyNoteSection(
    dailyNoteFile: TFile,
    sectionHeading: string,
    sectionContent: string,
    forceOverwrite: boolean = false
  ): Promise<void> {
    try {
      await updateSection(
        this.app,
        dailyNoteFile,
        sectionHeading,
        sectionContent,
        forceOverwrite
      );
    } catch (error) {
      new Notice(
        `Error updating section in ${dailyNoteFile.path}. Check console.`,
        7000
      );
      log.error("Error updating daily note section:", error);
    }
  }

  /**
   * Helper to get the date from a note, with fallback to the date key.
   *
   * @param note - Note data with optional timestamps
   * @param fallbackDateKey - Fallback date key in YYYY-MM-DD format
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
