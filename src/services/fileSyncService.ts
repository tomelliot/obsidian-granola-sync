import { App, Notice, TFile, normalizePath } from "obsidian";
import type { GranolaDoc } from "./granolaApi";
import type { DocumentProcessor } from "./documentProcessor";
import { PathResolver } from "./pathResolver";
import { GranolaSyncSettings } from "../settings";
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
    let cachedCount = 0;
    let missingGranolaIdCount = 0;
    let cacheReadErrors = 0;

    for (const file of files) {
      try {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.granola_id) {
          const granolaId = cache.frontmatter.granola_id as string;
          const type = cache.frontmatter.type || "note"; // Default for backward compatibility
          const cacheKey = `${granolaId}-${type}`;
          this.granolaIdCache.set(cacheKey, file);
          cachedCount++;
        } else if (cache?.frontmatter) {
          missingGranolaIdCount++;
        }
      } catch (e) {
        cacheReadErrors++;
        log.error(`Error reading frontmatter for ${file.path}:`, e);
      }
    }

    log.debug("Granola ID cache built", {
      totalMarkdownFiles: files.length,
      cachedCount,
      missingGranolaIdCount,
      cacheReadErrors,
    });
  }

  /**
   * Finds an existing file with the given Granola ID using the cache.
   *
   * @param granolaId - The Granola document ID to search for
   * @param type - Optional type ('note', 'transcript', or 'combined'). Defaults to 'note' for backward compatibility
   * @returns The file if found, null otherwise
   */
  findByGranolaId(
    granolaId: string,
    type: "note" | "transcript" | "combined" = "note"
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
   * @param type - Optional type ('note', 'transcript', or 'combined'). Defaults to 'note' for backward compatibility
   * @returns True if remote is newer or if comparison cannot be made, false if local is up-to-date
   */
  isRemoteNewer(
    granolaId: string,
    remoteUpdatedAt: string | undefined,
    type: "note" | "transcript" | "combined" = "note"
  ): boolean {
    // If no remote timestamp, assume we should update
    if (!remoteUpdatedAt) {
      log.debug("Remote timestamp missing; treating as newer", {
        granolaId,
        type,
      });
      return true;
    }

    const localFile = this.findByGranolaId(granolaId, type);
    if (!localFile) {
      // File doesn't exist locally, so remote is "newer"
      log.debug("Local file missing; treating remote as newer", {
        granolaId,
        type,
      });
      return true;
    }

    try {
      const cache = this.app.metadataCache.getFileCache(localFile);
      const localUpdated = cache?.frontmatter?.updated as string | undefined;

      if (!localUpdated) {
        // Local file has no timestamp, assume we should update
        log.debug("Local updated timestamp missing; treating remote as newer", {
          granolaId,
          type,
          localPath: localFile.path,
        });
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

      const isNewer = remoteDate > localDate;
      log.debug("Timestamp comparison result", {
        granolaId,
        type,
        localPath: localFile.path,
        remoteUpdatedAt,
        localUpdated,
        isNewer,
      });
      return isNewer;
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
   * @param type - Optional type ('note', 'transcript', or 'combined'). Defaults to 'note' for backward compatibility
   */
  updateCache(
    granolaId: string | undefined,
    file: TFile,
    type: "note" | "transcript" | "combined" = "note"
  ): void {
    if (granolaId) {
      const cacheKey = `${granolaId}-${type}`;
      this.granolaIdCache.set(cacheKey, file);
      log.debug("Granola ID cache updated", {
        granolaId,
        type,
        filePath: file.path,
      });
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
   * @param type - Optional type ('note', 'transcript', or 'combined'). Defaults to 'note' for backward compatibility
   * @param forceOverwrite - If true, always writes the file even if content is unchanged
   * @returns True if the file was created or modified, false if no change or error
   */
  async saveFile(
    filePath: string,
    content: string,
    granolaId: string,
    type: "note" | "transcript" | "combined" = "note",
    forceOverwrite: boolean = false
  ): Promise<boolean> {
    const normalizedPath = normalizePath(filePath);
    const existingFile = this.findByGranolaId(granolaId, type);
    log.debug("Saving file", {
      granolaId,
      type,
      normalizedPath,
      existingPath: existingFile?.path,
      forceOverwrite,
    });

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
    type: "note" | "transcript" | "combined"
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
    type: "note" | "transcript" | "combined",
    forceOverwrite: boolean
  ): Promise<boolean> {
    const existingContent = await this.app.vault.read(existingFile);

    // Skip update if content unchanged and not forcing overwrite
    if (!forceOverwrite && existingContent === content) {
      log.debug("Skipping file update (content unchanged)", {
        granolaId,
        type,
        filePath: existingFile.path,
      });
      this.updateCache(granolaId, existingFile, type);
      return false;
    }

    log.debug("Writing file update", {
      granolaId,
      type,
      filePath: existingFile.path,
      overwriteReason: forceOverwrite ? "forceOverwrite" : "contentChanged",
    });
    await this.app.vault.modify(existingFile, content);

    // Handle path change (e.g., title changed)
    if (existingFile.path !== normalizedPath) {
      log.debug("File path changed; attempting rename", {
        granolaId,
        type,
        fromPath: existingFile.path,
        toPath: normalizedPath,
      });
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
    type: "note" | "transcript" | "combined"
  ): Promise<void> {
    try {
      const previousPath = file.path;
      await this.app.vault.rename(file, newPath);
      this.updateCache(granolaId, file, type);
      log.debug("File renamed", {
        granolaId,
        type,
        fromPath: previousPath,
        toPath: newPath,
      });
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
        const existingCache = this.app.metadataCache.getFileCache(existingFile);
        const existingGranolaId = existingCache?.frontmatter?.granola_id;
        const existingType = existingCache?.frontmatter?.type || "unknown";
        log.debug("Filename collision detected", {
          granolaId,
          type,
          requestedPath: filePath,
          existingPath: existingFile.path,
          existingGranolaId,
          existingType,
          cacheHasGranolaId: Boolean(existingGranolaId),
          noteDate: noteDate.toISOString(),
        });
        const filenameWithoutExtension = resolvedFilename.replace(/\.md$/, "");
        const dateSuffix = formatDateForFilename(noteDate).replace(/\s+/g, "_");
        resolvedFilename = `${filenameWithoutExtension}-${dateSuffix}.md`;
        filePath = normalizePath(`${folderPath}/${resolvedFilename}`);
        log.debug("Resolved filename with date suffix", {
          granolaId,
          type,
          resolvedFilename,
          resolvedPath: filePath,
        });
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
      return this.pathResolver.computeTranscriptFolderPath(noteDate);
    } else {
      if (!settings.saveAsIndividualFiles) {
        new Notice(
          "Invalid configuration: trying to save individual file when saveAsIndividualFiles is false",
          7000
        );
        return null;
      }
      return this.pathResolver.computeNoteFolderPath(noteDate);
    }
  }

  /**
   * Prepares and saves a combined Granola note and transcript to disk.
   */
  async saveCombinedNoteToDisk(
    doc: GranolaDoc,
    documentProcessor: DocumentProcessor,
    transcriptContent: string,
    forceOverwrite: boolean = false
  ): Promise<boolean> {
    if (!doc.id) {
      log.error("Document missing required id field:", doc);
      return false;
    }
    const { filename, content } = documentProcessor.prepareCombinedNote(
      doc,
      transcriptContent
    );
    const noteDate = getNoteDate(doc);

    // Resolve folder path (combined files use note folder path, not transcript folder)
    const folderPath = this.resolveFolderPath(noteDate, false);
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

    const filePath = this.resolveFilePath(filename, noteDate, doc.id, false);
    if (!filePath) {
      return false;
    }

    // Save with type "combined"
    return this.saveFile(filePath, content, doc.id, "combined", forceOverwrite);
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
