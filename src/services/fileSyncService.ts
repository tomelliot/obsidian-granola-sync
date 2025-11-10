import { App, Notice, TFile, normalizePath } from "obsidian";
import type { GranolaDoc } from "./granolaApi";
import type { DocumentProcessor } from "./documentProcessor";
import { getNoteDate, formatDateForFilename } from "../utils/dateUtils";

/**
 * Service for handling file synchronization operations including
 * caching, file discovery, and file system operations.
 */
export class FileSyncService {
  private granolaIdCache: Map<string, TFile> = new Map();

  constructor(
    private app: App,
    private resolveFolderPath: (noteDate: Date, isTranscript: boolean) => string | null
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
        console.error(`Error reading frontmatter for ${file.path}:`, e);
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
      console.error("Folder creation error:", error);
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
   * @returns True if the file was created or modified, false if no change or error
   */
  async saveFile(
    filePath: string,
    content: string,
    granolaId: string,
    type: "note" | "transcript" = "note"
  ): Promise<boolean> {
    try {
      const normalizedPath = normalizePath(filePath);

      // Check if a file with this Granola ID already exists anywhere in the vault
      const existingFile = this.findByGranolaId(granolaId, type);

      if (existingFile) {
        const existingContent = await this.app.vault.read(existingFile);

        if (existingContent !== content) {
          await this.app.vault.modify(existingFile, content);

          // If the file path has changed (title changed), rename the file
          if (existingFile.path !== normalizedPath) {
            try {
              await this.app.vault.rename(existingFile, normalizedPath);
              this.updateCache(granolaId, existingFile, type);
            } catch (renameError) {
              // If rename fails (e.g., file already exists at new path), just update content
              console.warn(
                `Could not rename file from ${existingFile.path} to ${normalizedPath}:`,
                renameError
              );
            }
          }
          this.updateCache(granolaId, existingFile, type);
          return true; // Content was updated
        } else {
          this.updateCache(granolaId, existingFile, type);
          return false; // No change needed
        }
      } else {
        // File doesn't exist yet, create it
        const newFile = await this.app.vault.create(normalizedPath, content);
        this.updateCache(granolaId, newFile, type);
        return true; // New file created
      }
    } catch (e) {
      new Notice(`Error saving file: ${filePath}. Check console.`, 7000);
      console.error("Error saving file to disk:", e);
      return false;
    }
  }

  /**
   * Saves or updates a prepared document to disk by resolving its target path.
   */
  async saveToDisk(
    filename: string,
    content: string,
    noteDate: Date,
    granolaId: string,
    isTranscript: boolean = false
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

    return this.saveFile(filePath, content, granolaId, type);
  }

  /**
   * Prepares and saves a Granola note to disk.
   */
  async saveNoteToDisk(
    doc: GranolaDoc,
    documentProcessor: DocumentProcessor
  ): Promise<boolean> {
    if (!doc.id) {
      console.error("Document missing required id field:", doc);
      return false;
    }
    const { filename, content } = documentProcessor.prepareNote(doc);
    const noteDate = getNoteDate(doc);

    return this.saveToDisk(filename, content, noteDate, doc.id, false);
  }

  /**
   * Prepares and saves a Granola transcript to disk.
   */
  async saveTranscriptToDisk(
    doc: GranolaDoc,
    transcriptContent: string,
    documentProcessor: DocumentProcessor
  ): Promise<boolean> {
    if (!doc.id) {
      console.error("Document missing required id field:", doc);
      return false;
    }
    const { filename, content } = documentProcessor.prepareTranscript(
      doc,
      transcriptContent
    );
    const noteDate = getNoteDate(doc);

    return this.saveToDisk(filename, content, noteDate, doc.id, true);
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
