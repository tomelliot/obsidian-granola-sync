import { normalizePath } from "obsidian";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";
import moment from "moment";
import { sanitizeFilename } from "../utils/filenameUtils";
import { TranscriptSettings, TranscriptDestination, NoteSettings } from "../settings";
import { GranolaDoc } from "./granolaApi";

/**
 * Resolves file paths for notes and transcripts based on plugin settings
 * and daily note configuration.
 */
export class PathResolver {
  constructor(
    private settings: Pick<TranscriptSettings, 'transcriptDestination' | 'granolaTranscriptsFolder'>,
    private baseFolder?: string
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
   * Computes the folder path based on Granola's folder structure.
   * Uses folder_path if available (full path), otherwise falls back to folder, collection, or workspace.
   *
   * @param doc - The Granola document with folder information
   * @param baseFolder - The base folder where Granola folders should be created
   * @returns The folder path where the file should be stored
   */
  computeGranolaFolderPath(doc: GranolaDoc, baseFolder: string): string {
    // Prefer folder_path as it's likely the full path
    let granolaPath: string | null = null;
    
    if (doc.folder_path) {
      granolaPath = doc.folder_path;
    } else if (doc.folder) {
      granolaPath = doc.folder;
    } else if (doc.collection) {
      granolaPath = doc.collection;
    } else if (doc.workspace) {
      granolaPath = doc.workspace;
    }

    // If no folder info, use base folder only
    if (!granolaPath) {
      return normalizePath(baseFolder);
    }

    // Normalize the Granola path (remove leading/trailing slashes, handle path separators)
    const normalizedGranolaPath = granolaPath
      .replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
      .replace(/\\/g, '/'); // Convert backslashes to forward slashes

    // Combine base folder with Granola folder structure
    return normalizePath(`${baseFolder}/${normalizedGranolaPath}`);
  }

  /**
   * Computes the full path for a transcript file based on settings.
   *
   * @param title - The title of the note/transcript
   * @param noteDate - The date of the note
   * @param doc - Optional Granola document (required for GRANOLA_FOLDERS destination)
   * @returns The full file path for the transcript
   */
  computeTranscriptPath(title: string, noteDate: Date, doc?: GranolaDoc): string {
    const transcriptFilename = sanitizeFilename(title) + "-transcript.md";

    if (
      this.settings.transcriptDestination ===
      TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE
    ) {
      const folderPath = this.computeDailyNoteFolderPath(noteDate);
      return normalizePath(`${folderPath}/${transcriptFilename}`);
    } else if (
      this.settings.transcriptDestination ===
      TranscriptDestination.GRANOLA_FOLDERS
    ) {
      if (!doc) {
        // Fallback to transcripts folder if doc not provided
        return normalizePath(
          `${this.settings.granolaTranscriptsFolder}/${transcriptFilename}`
        );
      }
      const folderPath = this.computeGranolaFolderPath(
        doc,
        this.baseFolder || "Granola"
      );
      return normalizePath(`${folderPath}/${transcriptFilename}`);
    } else {
      // GRANOLA_TRANSCRIPTS_FOLDER
      return normalizePath(
        `${this.settings.granolaTranscriptsFolder}/${transcriptFilename}`
      );
    }
  }
}
