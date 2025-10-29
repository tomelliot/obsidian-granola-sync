import { Notice, TFile, Vault, MetadataCache, normalizePath } from "obsidian";

/**
 * Service for handling file synchronization operations with the Obsidian vault.
 */
export class FileSyncService {
  private granolaIdCache: Map<string, TFile> = new Map();

  constructor(
    private vault: Vault,
    private metadataCache: MetadataCache
  ) {}

  /**
   * Builds a cache of Granola IDs to files by scanning all markdown files in the vault.
   */
  async buildCache(): Promise<void> {
    this.granolaIdCache.clear();
    const files = this.vault.getMarkdownFiles();

    for (const file of files) {
      try {
        const cache = this.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.granola_id) {
          const granolaId = cache.frontmatter.granola_id as string;
          this.granolaIdCache.set(granolaId, file);
        }
      } catch (e) {
        console.error(`Error reading frontmatter for ${file.path}:`, e);
      }
    }
  }

  /**
   * Finds an existing file with the given Granola ID using the cache.
   *
   * @param granolaId - The Granola ID to search for
   * @returns The file if found, null otherwise
   */
  findByGranolaId(granolaId: string): TFile | null {
    return this.granolaIdCache.get(granolaId) || null;
  }

  /**
   * Updates the Granola ID cache for a file.
   *
   * @param granolaId - The Granola ID (can be undefined)
   * @param file - The file to associate with the ID
   */
  updateCache(granolaId: string | undefined, file: TFile): void {
    if (granolaId) {
      this.granolaIdCache.set(granolaId, file);
    }
  }

  /**
   * Ensures that a folder exists in the vault, creating it if necessary.
   *
   * @param folderPath - The path to the folder
   * @returns true if the folder exists or was created, false on error
   */
  async ensureFolder(folderPath: string): Promise<boolean> {
    try {
      const folderExists = this.vault.getAbstractFileByPath(folderPath);
      if (!folderExists) {
        await this.vault.createFolder(folderPath);
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
   * Saves a file to the vault, creating new or updating existing files.
   * Handles file renaming if the title changed and deduplication by Granola ID.
   *
   * @param filePath - The full path where the file should be saved
   * @param content - The file content
   * @param granolaId - Optional Granola ID for deduplication
   * @returns true if file was created or updated, false if no change or error
   */
  async saveFile(
    filePath: string,
    content: string,
    granolaId?: string
  ): Promise<boolean> {
    try {
      const normalizedPath = normalizePath(filePath);

      // First, check if a file with this Granola ID already exists anywhere in the vault
      let existingFile: TFile | null = null;
      if (granolaId) {
        existingFile = this.findByGranolaId(granolaId);
      }

      // If no file found by Granola ID, check by path
      if (!existingFile) {
        const fileByPath = this.vault.getAbstractFileByPath(normalizedPath);
        if (fileByPath instanceof TFile) {
          existingFile = fileByPath;
        }
      }

      if (existingFile) {
        const existingContent = await this.vault.read(existingFile);

        if (existingContent !== content) {
          await this.vault.modify(existingFile, content);

          // If the file path has changed (title changed), rename the file
          if (existingFile.path !== normalizedPath) {
            try {
              await this.vault.rename(existingFile, normalizedPath);
              this.updateCache(granolaId, existingFile);
            } catch (renameError) {
              // If rename fails (e.g., file already exists at new path), just update content
              console.warn(
                `Could not rename file from ${existingFile.path} to ${normalizedPath}:`,
                renameError
              );
            }
          }
          this.updateCache(granolaId, existingFile);
          return true; // Content was updated
        } else {
          this.updateCache(granolaId, existingFile);
          return false; // No change needed
        }
      } else {
        const newFile = await this.vault.create(normalizedPath, content);
        this.updateCache(granolaId, newFile);
        return true; // New file created
      }
    } catch (e) {
      console.error("Error saving file to disk:", e);
      return false;
    }
  }
}
