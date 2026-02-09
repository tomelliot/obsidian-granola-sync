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
import { updateSection } from "../utils/textUtils";
import { log } from "../utils/logger";

export interface NoteData {
  title: string;
  docId: string;
  createdAt?: string;
  updatedAt?: string;
  markdown: string;
}

export interface NoteLinkData {
  title: string;
  filePath: string;
  time?: string; // HH:MM format
}

/**
 * Service for building and managing daily notes with Granola content.
 * Handles grouping notes by date, building section content, and updating daily notes.
 */
export class DailyNoteBuilder {
  constructor(private app: App, private documentProcessor: DocumentProcessor) {}

  /**
   * Extracts existing Granola IDs and their updated_at timestamps from a daily note section.
   *
   * @param fileContent - The content of the daily note file
   * @param sectionHeading - The section heading to look for
   * @returns Map of Granola IDs to their updated_at timestamps
   */
  extractExistingNotes(
    fileContent: string,
    sectionHeading: string
  ): Map<string, string | undefined> {
    const existingNotes = new Map<string, string | undefined>();
    const lines = fileContent.split("\n");
    const headingLevel = lines
      .find((line) => line.trim() === sectionHeading)
      ?.match(/^(#{1,6})\s/)?.[1].length;

    if (!headingLevel) {
      return existingNotes; // Section doesn't exist
    }

    let inSection = false;
    let currentGranolaId: string | null = null;
    let currentUpdatedAt: string | undefined = undefined;

    for (const line of lines) {
      if (line.trim() === sectionHeading) {
        inSection = true;
        continue;
      }

      if (inSection) {
        // Check if we've reached the next section at the same or higher level
        const currentLevel = line.match(/^(#{1,6})\s/)?.[1].length;
        if (currentLevel && currentLevel <= headingLevel) {
          // Save the last note if we have one
          if (currentGranolaId) {
            existingNotes.set(currentGranolaId, currentUpdatedAt);
          }
          break; // End of section
        }

        // Look for Granola ID pattern
        const idMatch = line.match(/^\*\*Granola ID:\*\*\s+(.+)$/);
        if (idMatch) {
          // Save previous note if exists
          if (currentGranolaId) {
            existingNotes.set(currentGranolaId, currentUpdatedAt);
          }
          currentGranolaId = idMatch[1].trim();
          currentUpdatedAt = undefined;
        }

        // Look for Updated timestamp pattern
        const updatedMatch = line.match(/^\*\*Updated:\*\*\s+(.+)$/);
        if (updatedMatch && currentGranolaId) {
          currentUpdatedAt = updatedMatch[1].trim();
        }
      }
    }

    // Don't forget the last note
    if (currentGranolaId) {
      existingNotes.set(currentGranolaId, currentUpdatedAt);
    }

    return existingNotes;
  }

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
   * @returns The formatted section content
   */
  buildDailyNoteSectionContent(
    notesForDay: NoteData[],
    sectionHeading: string
  ): string {
    if (notesForDay.length === 0) {
      return sectionHeading;
    }

    // Determine the section heading level
    const sectionLevel =
      sectionHeading.match(/^(#{1,6})\s/)?.[1].length || 2;
    const noteHeadingLevel = Math.min(sectionLevel + 1, 6); // One level deeper, max 6
    const noteHeadingPrefix = "#".repeat(noteHeadingLevel);

    let content = sectionHeading;

    for (const note of notesForDay) {
      content += `\n${noteHeadingPrefix} ${note.title}\n`;
      content += `**Granola ID:** ${note.docId}\n`;

      if (note.createdAt) {
        content += `**Created:** ${note.createdAt}\n`;
      }
      if (note.updatedAt) {
        content += `**Updated:** ${note.updatedAt}\n`;
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
   * Groups note link data by date and returns a map of date keys to arrays of link data.
   *
   * @param notesWithPaths - Array of objects containing doc and note path
   * @returns Map of date keys (YYYY-MM-DD) to arrays of note link data
   */
  buildDailyNoteLinksMap(
    notesWithPaths: Array<{
      doc: GranolaDoc;
      notePath: string;
    }>
  ): Map<string, NoteLinkData[]> {
    const linksMap = new Map<string, NoteLinkData[]>();

    for (const { doc, notePath } of notesWithPaths) {
      const noteDate = getNoteDate(doc);
      const mapKey = moment(noteDate).format("YYYY-MM-DD");
      const title = doc.title || "Untitled";

      // Extract time from the note date
      const hours = noteDate.getHours().toString().padStart(2, "0");
      const minutes = noteDate.getMinutes().toString().padStart(2, "0");
      const time = `${hours}:${minutes}`;

      const linkData: NoteLinkData = {
        title,
        filePath: notePath,
        time,
      };

      if (!linksMap.has(mapKey)) {
        linksMap.set(mapKey, []);
      }

      linksMap.get(mapKey)!.push(linkData);
    }

    // Sort links within each day by time
    for (const [, links] of linksMap) {
      links.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    }

    return linksMap;
  }

  /**
   * Builds the section content for daily note links.
   *
   * @param linksForDay - Array of note link data for the day
   * @param sectionHeading - The heading to use for the section
   * @returns The formatted section content with links
   */
  buildDailyNoteLinksSectionContent(
    linksForDay: NoteLinkData[],
    sectionHeading: string
  ): string {
    if (linksForDay.length === 0) {
      return sectionHeading;
    }

    let content = sectionHeading;

    for (const link of linksForDay) {
      // Extract just the filename without extension for the wiki link
      const filename = link.filePath.replace(/\.md$/, "");
      const timePrefix = link.time ? `${link.time} - ` : "";
      content += `\n- ${timePrefix}[[${filename}|${link.title}]]`;
    }

    return content.trim() + "\n";
  }

  /**
   * Adds links to daily notes for a set of synced individual note files.
   *
   * @param notesWithPaths - Array of objects containing doc and note path
   * @param sectionHeading - The heading for the links section
   * @param forceOverwrite - If true, always updates the section even if content is unchanged
   */
  async addLinksToDailyNotes(
    notesWithPaths: Array<{
      doc: GranolaDoc;
      notePath: string;
    }>,
    sectionHeading: string,
    forceOverwrite: boolean = false
  ): Promise<void> {
    const linksMap = this.buildDailyNoteLinksMap(notesWithPaths);

    for (const [dateKey, linksForDay] of linksMap) {
      try {
        const dailyNoteFile = await this.getOrCreateDailyNote(dateKey);
        const sectionContent = this.buildDailyNoteLinksSectionContent(
          linksForDay,
          sectionHeading
        );

        await this.updateDailyNoteSection(
          dailyNoteFile,
          sectionHeading,
          sectionContent,
          forceOverwrite
        );

        log.debug(
          `Added ${linksForDay.length} link(s) to daily note for ${dateKey}`
        );
      } catch (error) {
        log.error(`Error adding links to daily note for ${dateKey}:`, error);
        new Notice(
          `Error adding meeting links to daily note for ${dateKey}. Check console.`,
          7000
        );
      }
    }
  }
}
