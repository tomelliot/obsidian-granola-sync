import { App, Notice, TFile, normalizePath } from "obsidian";
import type { GranolaDoc } from "./granolaApi";
import type { DocumentProcessor } from "./documentProcessor";
import { PathResolver } from "./pathResolver";
import {
  GranolaSyncSettings,
  SyncDestination,
  TranscriptDestination,
} from "../settings";
import { getNoteDate, formatDateForFilename } from "../utils/dateUtils";
import { log } from "../utils/logger";

/**
 * Service for handling file synchronization operations including
 * caching, file discovery, and file system operations.
 */
export class FileSyncService {
  private granolaIdCache: Map<string, TFile> = new Map();

  constructor(
    private app: App,
    private pathResolver: PathResolver,
    private getSettings: () => GranolaSyncSettings
  ) {}

  /**
   * Builds a cache of Granola IDs to file mappings by scanning all markdown files
   * in the vault and reading their frontmatter.
   * Cache keys are in the format: `${granolaId}-${type}` to support both notes
   * and transcripts with the same Granola ID.
   */
  async buildCache(): Promise<void> {
    this.granolaIdCache.clear();
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      try {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.granola_id) {
          const granolaId = cache.frontmatter.granola_id as string;
          const type = cache.frontmatter.type || "note"; // Default for backward compatibility
          const cacheKey = `${granolaId}-${type}`;
          this.granolaIdCache.set(cacheKey, file);
        }
      } catch (e) {
        log.error(`Error reading frontmatter for ${file.path}:`, e);
      }
    }
  }

  /**
   * Finds an existing file with the given Granola ID using the cache.
   *
   * @param granolaId - The Granola document ID to search for
   * @param type - Optional type ('note' or 'transcript'). Defaults to 'note' for backward compatibility
   * @returns The file if found, null otherwise
   */
  findByGranolaId(
    granolaId: string,
    type: "note" | "transcript" = "note"
  ): TFile | null {
    const cacheKey = `${granolaId}-${type}`;
    return this.granolaIdCache.get(cacheKey) || null;
  }

  /**
   * Checks if a remote document is newer than the local file.
   * Compares the remote document's updated_at timestamp with the local file's updated frontmatter field.
   *
   * @param granolaId - The Granola document ID
   * @param remoteUpdatedAt - The remote document's updated_at timestamp (ISO string)
   * @param type - Optional type ('note' or 'transcript'). Defaults to 'note' for backward compatibility
   * @returns True if remote is newer or if comparison cannot be made, false if local is up-to-date
   */
  isRemoteNewer(
    granolaId: string,
    remoteUpdatedAt: string | undefined,
    type: "note" | "transcript" = "note"
  ): boolean {
    // If no remote timestamp, assume we should update
    if (!remoteUpdatedAt) {
      return true;
    }

    const localFile = this.findByGranolaId(granolaId, type);
    if (!localFile) {
      // File doesn't exist locally, so remote is "newer"
      return true;
    }

    try {
      const cache = this.app.metadataCache.getFileCache(localFile);
      const localUpdated = cache?.frontmatter?.updated as string | undefined;

      if (!localUpdated) {
        // Local file has no timestamp, assume we should update
        return true;
      }

      // Compare timestamps
      const remoteDate = new Date(remoteUpdatedAt);
      const localDate = new Date(localUpdated);

      // Check for invalid dates
      if (isNaN(remoteDate.getTime()) || isNaN(localDate.getTime())) {
        log.warn(
          `Invalid timestamp comparison for ${granolaId}, assuming remote is newer`
        );
        return true;
      }

      return remoteDate > localDate;
    } catch (e) {
      log.error(`Error comparing timestamps for ${granolaId}:`, e);
      // On error, assume we should update
      return true;
    }
  }

  /**
   * Updates the Granola ID cache with a file mapping.
   *
   * @param granolaId - The Granola document ID (optional)
   * @param file - The file to associate with the ID
   * @param type - Optional type ('note' or 'transcript'). Defaults to 'note' for backward compatibility
   */
  updateCache(
    granolaId: string | undefined,
    file: TFile,
    type: "note" | "transcript" = "note"
  ): void {
    if (granolaId) {
      const cacheKey = `${granolaId}-${type}`;
      this.granolaIdCache.set(cacheKey, file);
    }
  }

  /**
   * Ensures a folder exists, creating it if necessary.
   *
   * @param folderPath - The path to the folder
   * @returns True if the folder exists or was created successfully, false on error
   */
  async ensureFolder(folderPath: string): Promise<boolean> {
    try {
      const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
      if (!folderExists) {
        await this.app.vault.createFolder(folderPath);
      }
      return true;
    } catch (error) {
      new Notice(
        `Granola sync error: Could not create folder '${folderPath}'. Check console.`,
        10000
      );
      log.error("Folder creation error:", error);
      return false;
    }
  }

  /**
   * Saves or updates a file to disk.
   *
   * @param filePath - The full path where the file should be saved
   * @param content - The content to write to the file
   * @param granolaId - Granola ID for caching and deduplication
   * @param type - Optional type ('note' or 'transcript'). Defaults to 'note' for backward compatibility
   * @param forceOverwrite - If true, always writes the file even if content is unchanged
   * @returns True if the file was created or modified, false if no change or error
   */
  async saveFile(
    filePath: string,
    content: string,
    granolaId: string,
    type: "note" | "transcript" = "note",
    forceOverwrite: boolean = false
  ): Promise<boolean> {
    const normalizedPath = normalizePath(filePath);
    const existingFile = this.findByGranolaId(granolaId, type);

    try {
      if (!existingFile) {
        return await this.createNewFile(
          normalizedPath,
          content,
          granolaId,
          type
        );
      }

      return await this.updateExistingFile(
        existingFile,
        normalizedPath,
        content,
        granolaId,
        type,
        forceOverwrite
      );
    } catch (e) {
      new Notice(`Error saving file: ${normalizedPath}. Check console.`, 7000);
      log.error(
        "Error saving file to disk:",
        {
          granolaId,
          type,
          originalPath: filePath,
          normalizedPath,
          existingPath: existingFile?.path,
          error: e instanceof Error ? e.message : String(e),
        },
        e
      );
      return false;
    }
  }

  /**
   * Creates a new file at the specified path.
   */
  private async createNewFile(
    normalizedPath: string,
    content: string,
    granolaId: string,
    type: "note" | "transcript"
  ): Promise<boolean> {
    const newFile = await this.app.vault.create(normalizedPath, content);
    this.updateCache(granolaId, newFile, type);
    return true;
  }

  /**
   * Updates an existing file with new content, handling path changes.
   */
  private async updateExistingFile(
    existingFile: TFile,
    normalizedPath: string,
    content: string,
    granolaId: string,
    type: "note" | "transcript",
    forceOverwrite: boolean
  ): Promise<boolean> {
    const existingContent = await this.app.vault.read(existingFile);

    // Skip update if content unchanged and not forcing overwrite
    if (!forceOverwrite && existingContent === content) {
      this.updateCache(granolaId, existingFile, type);
      return false;
    }

    await this.app.vault.modify(existingFile, content);

    // Handle path change (e.g., title changed)
    if (existingFile.path !== normalizedPath) {
      await this.attemptRename(existingFile, normalizedPath, granolaId, type);
    }

    this.updateCache(granolaId, existingFile, type);
    return true;
  }

  /**
   * Attempts to rename a file, logging a warning if it fails.
   */
  private async attemptRename(
    file: TFile,
    newPath: string,
    granolaId: string,
    type: "note" | "transcript"
  ): Promise<void> {
    try {
      await this.app.vault.rename(file, newPath);
      this.updateCache(granolaId, file, type);
    } catch (renameError) {
      // If rename fails (e.g., file already exists at new path), just update content
      log.warn(
        `Could not rename file from ${file.path} to ${newPath} (granolaId: ${granolaId}, type: ${type}):`,
        renameError
      );
    }
  }

  /**
   * Resolves the final file path for a note or transcript, accounting for filename collisions.
   * If there is a filename collision (different Granola ID but same filename),
   * the file is renamed to include a date/timestamp suffix.
   *
   * @param filename - The base filename (e.g., "Note.md")
   * @param noteDate - The date of the note
   * @param granolaId - The Granola document ID
   * @param isTranscript - Whether this is a transcript file
   * @returns The resolved file path, or null if folder path cannot be resolved
   */
  resolveFilePath(
    filename: string,
    noteDate: Date,
    granolaId: string,
    isTranscript: boolean = false
  ): string | null {
    const folderPath = this.resolveFolderPath(noteDate, isTranscript);
    if (!folderPath) {
      return null;
    }

    const type = isTranscript ? "transcript" : "note";
    let resolvedFilename = filename;
    let filePath = normalizePath(`${folderPath}/${resolvedFilename}`);

    if (!this.findByGranolaId(granolaId, type)) {
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);
      if (existingFile instanceof TFile) {
        const filenameWithoutExtension = resolvedFilename.replace(/\.md$/, "");
        const dateSuffix = formatDateForFilename(noteDate).replace(/\s+/g, "_");
        resolvedFilename = `${filenameWithoutExtension}-${dateSuffix}.md`;
        filePath = normalizePath(`${folderPath}/${resolvedFilename}`);
      }
    }

    return filePath;
  }

  /**
   * Saves or updates a prepared document to disk by resolving its target path.
   * If there is a filename collision (different Granola ID but same filename),
   * the file is renamed to include a date/timestamp suffix.
   */
  async saveToDisk(
    filename: string,
    content: string,
    noteDate: Date,
    granolaId: string,
    isTranscript: boolean = false,
    forceOverwrite: boolean = false
  ): Promise<boolean> {
    const folderPath = this.resolveFolderPath(noteDate, isTranscript);
    if (!folderPath) {
      return false;
    }

    if (!(await this.ensureFolder(folderPath))) {
      new Notice(
        `Error creating folder: ${folderPath}. Skipping file: ${filename}`,
        7000
      );
      return false;
    }

    const filePath = this.resolveFilePath(
      filename,
      noteDate,
      granolaId,
      isTranscript
    );
    if (!filePath) {
      return false;
    }

    const type = isTranscript ? "transcript" : "note";
    return this.saveFile(filePath, content, granolaId, type, forceOverwrite);
  }

  /**
   * Resolves the target folder path for a note or transcript based on settings.
   */
  private resolveFolderPath(
    noteDate: Date,
    isTranscript: boolean
  ): string | null {
    const settings = this.getSettings();

    if (isTranscript) {
      switch (settings.transcriptDestination) {
        case TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE:
          return this.pathResolver.computeDailyNoteFolderPath(noteDate);
        case TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER:
          return normalizePath(settings.granolaTranscriptsFolder);
      }
    } else {
      switch (settings.syncDestination) {
        case SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE:
          return this.pathResolver.computeDailyNoteFolderPath(noteDate);
        case SyncDestination.GRANOLA_FOLDER:
          return normalizePath(settings.granolaFolder);
        default:
          new Notice(
            `Invalid sync destination for individual files: ${settings.syncDestination}`,
            7000
          );
          return null;
      }
    }

    return null;
  }

  /**
   * Prepares and saves a Granola note to disk.
   */
  async saveNoteToDisk(
    doc: GranolaDoc,
    documentProcessor: DocumentProcessor,
    forceOverwrite: boolean = false,
    transcriptPath?: string
  ): Promise<boolean> {
    if (!doc.id) {
      log.error("Document missing required id field:", doc);
      return false;
    }
    const { filename, content } = documentProcessor.prepareNote(
      doc,
      transcriptPath
    );
    const noteDate = getNoteDate(doc);

    return this.saveToDisk(
      filename,
      content,
      noteDate,
      doc.id,
      false,
      forceOverwrite
    );
  }

  /**
   * Prepares and saves a Granola transcript to disk.
   */
  async saveTranscriptToDisk(
    doc: GranolaDoc,
    transcriptContent: string,
    documentProcessor: DocumentProcessor,
    forceOverwrite: boolean = false
  ): Promise<boolean> {
    if (!doc.id) {
      log.error("Document missing required id field:", doc);
      return false;
    }
    const { filename, content } = documentProcessor.prepareTranscript(
      doc,
      transcriptContent
    );
    const noteDate = getNoteDate(doc);

    return this.saveToDisk(
      filename,
      content,
      noteDate,
      doc.id,
      true,
      forceOverwrite
    );
  }

  /**
   * Clears the Granola ID cache.
   */
  clearCache(): void {
    this.granolaIdCache.clear();
  }

  /**
   * Gets the current cache size.
   */
  getCacheSize(): number {
    return this.granolaIdCache.size;
  }
}
