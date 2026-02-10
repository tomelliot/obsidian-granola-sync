import { App, Notice, TFile, normalizePath, requestUrl } from "obsidian";
import type { GranolaAttachment, GranolaDoc } from "./granolaApi";
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
    type: "note" | "transcript" | "combined"
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

    const contentWithAttachments = await this.appendImageEmbedsForAttachments(
      doc,
      content,
      filePath
    );

    // Save with type "combined"
    return this.saveFile(
      filePath,
      contentWithAttachments,
      doc.id,
      "combined",
      forceOverwrite
    );
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

    const contentWithAttachments = await this.appendImageEmbedsForAttachments(
      doc,
      content,
      filePath
    );

    return this.saveFile(
      filePath,
      contentWithAttachments,
      doc.id,
      "note",
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

  /**
   * Appends image embeds for any image attachments on the given document to the provided content.
   * Images are downloaded and stored under a predictable `attachments/` folder
   * in the vault. Only successfully saved images are embedded.
   *
   * Images are fetched in parallel for performance.
   *
   * @param doc - The Granola document with attachments
   * @param content - The markdown content to append embeds to
   * @param sourcePath - The file path (used to determine attachment storage location)
   * @returns The content with image embeds appended
   */
  async appendImageEmbedsForAttachments(
    doc: GranolaDoc,
    content: string,
    sourcePath: string
  ): Promise<string> {
    const imageAttachments =
      doc.attachments?.filter(
        (attachment) =>
          attachment &&
          typeof attachment.url === "string" &&
          attachment.type === "image"
      ) ?? [];

    if (imageAttachments.length === 0) {
      return content;
    }

    const results = await Promise.allSettled(
      imageAttachments.map((attachment, index) =>
        this.downloadAndSaveImageAttachment(
          doc,
          attachment,
          sourcePath,
          index
        )
      )
    );

    const embedLines: string[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        embedLines.push(`![[${result.value}]]`);
      }
    }

    if (embedLines.length === 0) {
      return content;
    }

    const separator = content.endsWith("\n") ? "\n" : "\n\n";
    return content + separator + embedLines.join("\n") + "\n";
  }

  /**
   * Maps a Content-Type header value to a file extension.
   * Returns null if the content type is missing or unrecognized.
   */
  private getExtensionFromContentType(contentType: string | undefined): string | null {
    if (!contentType) {
      return null;
    }

    const mimeType = contentType.split(";")[0].trim().toLowerCase();
    const mimeToExtension: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    };

    return mimeToExtension[mimeType] || null;
  }

  /**
   * Extracts a file extension from a URL path.
   * Returns null if no valid extension is found.
   */
  private getExtensionFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      if (!match) {
        return null;
      }

      const extension = match[1].toLowerCase();
      // Only accept known image extensions
      const validExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
      return validExtensions.includes(extension) ? extension : null;
    } catch {
      return null;
    }
  }

  /**
   * Downloads and stores a single image attachment, returning the vault-relative
   * path to the saved image if successful. If the file already exists, no
   * network request is made and the existing path is returned.
   */
  private async downloadAndSaveImageAttachment(
    doc: GranolaDoc,
    attachment: GranolaAttachment,
    sourcePath: string,
    index: number
  ): Promise<string | null> {
    try {
      // Download the image first to determine the correct extension from Content-Type
      const response = await requestUrl({
        url: attachment.url,
        method: "GET",
      });

      // Try to determine extension from Content-Type header first
      const contentType = response.headers["content-type"];
      let extension = this.getExtensionFromContentType(contentType);

      // If Content-Type doesn't provide an extension, try the URL
      if (!extension) {
        extension = this.getExtensionFromUrl(attachment.url);
      }

      // If we still can't determine the extension, skip this attachment
      if (!extension) {
        log.error(
          "Cannot determine file extension for image attachment - skipping",
          {
            granolaId: doc.id,
            attachmentId: attachment.id,
            url: attachment.url,
            contentType: contentType || "none",
          }
        );
        return null;
      }

      // Create filename with correct extension
      const filename = `${doc.id ?? "unknown"}-${
        attachment.id ?? `attachment-${index}`
      }.${extension}`;

      const targetPath =
        (await this.app.fileManager.getAvailablePathForAttachment(
          filename,
          sourcePath
        )) ?? filename;
      const normalizedPath = normalizePath(targetPath);

      // Check if file already exists at this path
      const existingFile = this.app.vault.getAbstractFileByPath(normalizedPath);
      if (existingFile instanceof TFile) {
        return normalizedPath;
      }

      // Save the downloaded image
      const buffer = response.arrayBuffer;
      await this.app.vault.createBinary(normalizedPath, buffer);
      return normalizedPath;
    } catch (error) {
      log.warn("Failed to download or save attachment image", {
        granolaId: doc.id,
        attachmentId: attachment.id,
        error:
          error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
