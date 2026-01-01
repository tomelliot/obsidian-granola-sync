import { normalizePath } from "obsidian";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";
import moment from "moment";
import {
  resolveFilenamePattern,
  resolveSubfolderPattern,
} from "../utils/filenameUtils";
import { TranscriptSettings, NoteSettings } from "../settings";
import { GranolaDoc } from "./granolaApi";
import { getNoteDate } from "../utils/dateUtils";

/**
 * Resolves file paths for notes and transcripts based on plugin settings
 * and daily note configuration.
 */
export class PathResolver {
  constructor(private settings: NoteSettings & TranscriptSettings) {}

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
   * Computes the base folder path for notes based on settings.
   *
   * @param noteDate - The date of the note (used for daily notes folder)
   * @returns The base folder path
   */
  private computeNoteBaseFolder(noteDate: Date): string {
    if (!this.settings.saveAsIndividualFiles) {
      // Sections in daily notes - no individual files
      return "";
    }

    if (this.settings.baseFolderType === "daily-notes") {
      return this.computeDailyNoteFolderPath(noteDate);
    } else {
      // Custom folder
      return normalizePath(this.settings.customBaseFolder || "Granola");
    }
  }

  /**
   * Computes the full folder path for a note including subfolders.
   *
   * @param noteDate - The date of the note
   * @returns The full folder path for the note
   */
  computeNoteFolderPath(noteDate: Date): string {
    const baseFolder = this.computeNoteBaseFolder(noteDate);
    const subfolder = resolveSubfolderPattern(
      this.settings.subfolderPattern,
      noteDate,
      this.settings.customSubfolderPattern
    );

    if (subfolder) {
      return normalizePath(`${baseFolder}/${subfolder}`);
    }
    return baseFolder;
  }

  /**
   * Computes the full path for a note file based on settings.
   *
   * @param doc - The Granola document
   * @returns The full file path for the note
   */
  computeNotePath(doc: GranolaDoc): string {
    const noteDate = getNoteDate(doc);
    const folderPath = this.computeNoteFolderPath(noteDate);
    const filename = resolveFilenamePattern(doc, this.settings.filenamePattern);
    return normalizePath(`${folderPath}/${filename}`);
  }

  /**
   * Computes the base folder path for transcripts based on settings.
   *
   * @param noteDate - The date of the note
   * @returns The base folder path for transcripts
   */
  private computeTranscriptBaseFolder(noteDate: Date): string {
    if (this.settings.transcriptHandling === "same-location") {
      // Use same location as notes
      return this.computeNoteBaseFolder(noteDate);
    } else if (this.settings.transcriptHandling === "custom-location") {
      return normalizePath(
        this.settings.customTranscriptBaseFolder || "Granola/Transcripts"
      );
    }
    // Combined mode doesn't use separate transcript files
    return "";
  }

  /**
   * Computes the full folder path for a transcript including subfolders.
   *
   * @param noteDate - The date of the note
   * @returns The full folder path for the transcript
   */
  computeTranscriptFolderPath(noteDate: Date): string {
    const baseFolder = this.computeTranscriptBaseFolder(noteDate);

    if (this.settings.transcriptHandling === "same-location") {
      // Use same subfolder pattern as notes
      const subfolder = resolveSubfolderPattern(
        this.settings.subfolderPattern,
        noteDate,
        this.settings.customSubfolderPattern
      );
      if (subfolder) {
        return normalizePath(`${baseFolder}/${subfolder}`);
      }
      return baseFolder;
    } else if (this.settings.transcriptHandling === "custom-location") {
      const subfolder = resolveSubfolderPattern(
        this.settings.transcriptSubfolderPattern || "none",
        noteDate,
        this.settings.customTranscriptSubfolderPattern
      );
      if (subfolder) {
        return normalizePath(`${baseFolder}/${subfolder}`);
      }
      return baseFolder;
    }

    return "";
  }

  /**
   * Computes the full path for a transcript file based on settings.
   *
   * @param doc - The Granola document
   * @returns The full file path for the transcript
   */
  computeTranscriptPath(doc: GranolaDoc): string {
    const noteDate = getNoteDate(doc);
    const folderPath = this.computeTranscriptFolderPath(noteDate);

    let filenamePattern: string;
    if (this.settings.transcriptHandling === "same-location") {
      // Use note filename pattern with "-transcript" suffix
      filenamePattern = this.settings.filenamePattern + "-transcript";
    } else if (this.settings.transcriptHandling === "custom-location") {
      filenamePattern =
        this.settings.transcriptFilenamePattern || "{title}-transcript";
    } else {
      // Combined mode
      filenamePattern = "{title}-transcript";
    }

    const filename = resolveFilenamePattern(doc, filenamePattern);
    return normalizePath(`${folderPath}/${filename}`);
  }
}
