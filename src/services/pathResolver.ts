import { normalizePath } from "obsidian";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";
import moment from "moment";
import { sanitizeFilename } from "../utils/filenameUtils";
import { TranscriptSettings, TranscriptDestination, NoteSettings, SyncDestination } from "../settings";

/**
 * Resolves file paths for notes and transcripts based on plugin settings
 * and daily note configuration.
 */
export class PathResolver {
  constructor(
    private settings: Pick<TranscriptSettings, 'transcriptDestination' | 'granolaTranscriptsFolder'> &
                     Pick<NoteSettings, 'syncDestination' | 'granolaFolder'>
  ) {}

  /**
   * Computes the folder path for a daily note based on its date.
   * Uses the daily notes plugin settings to determine the structure.
   *
   * @param noteDate - The date of the note
   * @returns The folder path where the note should be stored
   */
  computeDailyNoteFolderPath(noteDate: Date): string {
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
   * Computes the full path for a note file based on settings.
   * Note: DAILY_NOTES destination doesn't create individual files, so this method
   * should only be called for GRANOLA_FOLDER or DAILY_NOTE_FOLDER_STRUCTURE destinations.
   *
   * @param title - The title of the note
   * @param noteDate - The date of the note
   * @returns The full file path for the note
   */
  computeNotePath(title: string, noteDate: Date): string {
    const noteFilename = sanitizeFilename(title) + ".md";

    if (
      this.settings.syncDestination ===
      SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE
    ) {
      const folderPath = this.computeDailyNoteFolderPath(noteDate);
      return normalizePath(`${folderPath}/${noteFilename}`);
    } else {
      // GRANOLA_FOLDER
      return normalizePath(
        `${this.settings.granolaFolder}/${noteFilename}`
      );
    }
  }

  /**
   * Computes the full path for a transcript file based on settings.
   *
   * @param title - The title of the note/transcript
   * @param noteDate - The date of the note
   * @returns The full file path for the transcript
   */
  computeTranscriptPath(title: string, noteDate: Date): string {
    const transcriptFilename = sanitizeFilename(title) + "-transcript.md";

    if (
      this.settings.transcriptDestination ===
      TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE
    ) {
      const folderPath = this.computeDailyNoteFolderPath(noteDate);
      return normalizePath(`${folderPath}/${transcriptFilename}`);
    } else {
      // GRANOLA_TRANSCRIPTS_FOLDER
      return normalizePath(
        `${this.settings.granolaTranscriptsFolder}/${transcriptFilename}`
      );
    }
  }
}
