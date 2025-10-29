import { getDailyNoteSettings } from "obsidian-daily-notes-interface";
import moment from "moment";
import { normalizePath } from "obsidian";
import { sanitizeFilename } from "../utils/filenameUtils";
import { SyncDestination, TranscriptDestination } from "../settings";

export interface PathResolverSettings {
  granolaFolder: string;
  granolaTranscriptsFolder: string;
  syncDestination: SyncDestination;
  transcriptDestination: TranscriptDestination;
}

/**
 * Service for resolving file and folder paths based on sync settings.
 */
export class PathResolver {
  constructor(private settings: PathResolverSettings) {}

  /**
   * Computes the folder path for a note based on daily note settings.
   *
   * @param noteDate - The date for the note
   * @returns The folder path
   */
  resolveDailyNoteFolder(noteDate: Date): string {
    const dailyNoteSettings = getDailyNoteSettings();
    const noteMoment = moment(noteDate);

    // Format the date according to the daily note format
    const formattedPath = noteMoment.format(
      dailyNoteSettings.format || "YYYY-MM-DD"
    );

    // Extract just the folder part (everything except the filename)
    const pathParts = formattedPath.split("/");
    const folderParts = pathParts.slice(0, -1); // Remove the last part (filename)

    // Combine with the base daily notes folder
    const baseFolder = dailyNoteSettings.folder || "";
    if (folderParts.length > 0) {
      return normalizePath(`${baseFolder}/${folderParts.join("/")}`);
    } else {
      return normalizePath(baseFolder);
    }
  }

  /**
   * Resolves the full path for a transcript file based on settings.
   *
   * @param title - The document title
   * @param noteDate - The note date
   * @returns The full transcript file path
   */
  resolveTranscriptPath(title: string, noteDate: Date): string {
    const transcriptFilename = sanitizeFilename(title) + "-transcript.md";

    if (
      this.settings.transcriptDestination ===
      TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE
    ) {
      const folderPath = this.resolveDailyNoteFolder(noteDate);
      return normalizePath(`${folderPath}/${transcriptFilename}`);
    } else {
      // GRANOLA_TRANSCRIPTS_FOLDER
      return normalizePath(
        `${this.settings.granolaTranscriptsFolder}/${transcriptFilename}`
      );
    }
  }

  /**
   * Resolves the folder path based on whether the file is a transcript and settings.
   *
   * @param noteDate - The note date
   * @param isTranscript - Whether this is a transcript file
   * @returns The folder path
   */
  resolveFolderPath(noteDate: Date, isTranscript: boolean): string {
    if (isTranscript) {
      // Handle transcript destinations
      switch (this.settings.transcriptDestination) {
        case TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE:
          return this.resolveDailyNoteFolder(noteDate);
        case TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER:
          return normalizePath(this.settings.granolaTranscriptsFolder);
      }
    } else {
      // Handle note destinations
      switch (this.settings.syncDestination) {
        case SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE:
          return this.resolveDailyNoteFolder(noteDate);
        case SyncDestination.GRANOLA_FOLDER:
          return normalizePath(this.settings.granolaFolder);
      }
    }
    // Fallback (shouldn't reach here)
    return normalizePath(this.settings.granolaFolder);
  }

  /**
   * Updates the settings used by the path resolver.
   *
   * @param settings - The new settings
   */
  updateSettings(settings: PathResolverSettings): void {
    this.settings = settings;
  }
}
