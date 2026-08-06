import { App, Notice, TFile, normalizePath } from "obsidian";
import type { GranolaDoc } from "./granolaApi";
import type { DocumentProcessor } from "./documentProcessor";
import { PathResolver } from "./pathResolver";
import { GranolaSyncSettings } from "../settings";
import { getNoteDate, formatDateForFilename } from "../utils/dateUtils";
import { log } from "../utils/logger";

const LEGACY_WEB_URL_RE =
  /\/d\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * Extracts the legacy internal document UUID from a note's Granola web URL
 * (https://notes.granola.ai/d/<uuid>). Files synced by pre-public-API versions
 * carry that UUID as their granola_id, so it lets a first sync after the
 * migration update those files in place instead of duplicating them.
 */
export function extractLegacyIdFromWebUrl(
  webUrl: string | undefined
): string | null {
  if (!webUrl) return null;
  const match = webUrl.match(LEGACY_WEB_URL_RE);
  return match ? match[1] : null;
}

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
          const type = (cache.frontmatter.type as string | undefined) || "note"; // Default for backward compatibility
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
   * Resolves a file path to its Granola ID using the cache.
   * Used as the source of truth for deduplicating daily note links (same note may have different paths).
   *
   * @param path - Vault-relative file path (e.g. "Granola/Meeting.md")
   * @returns The Granola ID if the file is in the cache, null otherwise
   */
  getGranolaIdByPath(path: string): string | null {
    const normalizedPath = normalizePath(path);
    const types: Array<"note" | "transcript" | "combined"> = [
      "note",
      "transcript",
      "combined",
    ];
    for (const [cacheKey, file] of this.granolaIdCache) {
      if (!file?.path || normalizePath(file.path) !== normalizedPath) {
        continue;
      }
      for (const type of types) {
        if (cacheKey.endsWith(`-${type}`)) {
          return cacheKey.slice(0, -type.length - 1);
        }
      }
    }
    return null;
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
    // A null/undefined file poisons every later cache scan, so refuse it here
    // even though the signature says it cannot happen.
    if (granolaId && file) {
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
   * @param noteDate - Used to build a collision-resolved filename if the target path is already taken
   * @param legacyId - Optional pre-public-API document UUID (from web_url) used
   *   to match files synced by older plugin versions and update them in place
   * @returns True if the file was created or modified, false if no change or error
   */
  async saveFile(
    filePath: string,
    content: string,
    granolaId: string,
    type: "note" | "transcript" | "combined" = "note",
    forceOverwrite: boolean = false,
    noteDate: Date = new Date(),
    legacyId: string | null = null
  ): Promise<boolean> {
    const normalizedPath = normalizePath(filePath);
    let existingFile = this.findByGranolaId(granolaId, type);

    // Migration: match files created by pre-public-API versions, whose
    // granola_id is the legacy internal UUID. Re-key them to the new id
    // (the written content carries the new granola_id in frontmatter).
    if (!existingFile && legacyId) {
      const legacyFile = this.findByGranolaId(legacyId, type);
      if (legacyFile) {
        this.granolaIdCache.delete(`${legacyId}-${type}`);
        existingFile = legacyFile;
        log.debug(
          `Migrating ${type} file ${legacyFile.path} from legacy id ${legacyId} to ${granolaId}`
        );
      }
    }

    try {
      // Last-resort migration: a Granola-synced file (present in the id cache)
      // already sits at the computed target path under some other id. This runs
      // inside the try so a failure costs one document, not the whole sync.
      if (!existingFile) {
        const adopted = this.adoptGranolaFileAtPath(normalizedPath);
        if (adopted) {
          existingFile = adopted;
          log.debug(
            `Adopting existing Granola file at ${normalizedPath} for id ${granolaId}`
          );
        }
      }

      if (!existingFile) {
        return await this.createNewFile(
          normalizedPath,
          content,
          granolaId,
          type,
          noteDate
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
   * Finds a cached (Granola-synced) file at the given normalized path and
   * removes its stale cache entry so the caller can re-register it under a
   * new id. Returns null when no Granola-synced file occupies the path.
   */
  private adoptGranolaFileAtPath(normalizedPath: string): TFile | null {
    for (const [cacheKey, file] of this.granolaIdCache) {
      // Drop any malformed entry rather than dereferencing it: one bad value
      // would otherwise abort every remaining save in the sync.
      if (!file?.path) {
        this.granolaIdCache.delete(cacheKey);
        continue;
      }
      if (normalizePath(file.path) === normalizedPath) {
        this.granolaIdCache.delete(cacheKey);
        return file;
      }
    }
    return null;
  }

  /**
   * Creates a new file, recovering from path collisions.
   *
   * The filesystem is the source of truth: we attempt `vault.create` and, if it
   * reports the path is already taken, retry under a collision-resolved name
   * (date suffix, then a numeric counter). This is robust on case-insensitive
   * filesystems where a path pre-check via getAbstractFileByPath can miss a
   * case/normalization variant that `create` then collides with.
   */
  private async createNewFile(
    normalizedPath: string,
    content: string,
    granolaId: string,
    type: "note" | "transcript" | "combined",
    noteDate: Date
  ): Promise<boolean> {
    const maxAttempts = 20;
    let candidate = normalizedPath;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const newFile = await this.app.vault.create(candidate, content);
        this.cacheCreatedFile(granolaId, newFile, candidate, type);
        if (candidate === normalizedPath) {
          log.debug(`Created ${type} file: ${candidate} (granolaId=${granolaId})`);
        } else {
          log.debug(`Created ${type} file under collision-resolved name: ${candidate} (granolaId=${granolaId})`);
        }
        return true;
      } catch (e) {
        if (!this.isFileAlreadyExistsError(e)) {
          throw e;
        }
        candidate = this.buildCollisionCandidate(
          normalizedPath,
          noteDate,
          attempt + 1
        );
        log.debug(`Filename collision at ${normalizedPath} — retrying as ${candidate} (granolaId=${granolaId})`);
      }
    }

    throw new Error(
      `Could not find an available filename for ${normalizedPath} after ${maxAttempts} attempts`
    );
  }

  /**
   * Caches a freshly created file, working around `vault.create` resolving null.
   *
   * Obsidian writes the file through the vault adapter and then looks the path
   * up in its in-memory file index, returning `null` when that lookup misses —
   * even though the declared return type is `Promise<TFile>`. The index is
   * populated from a filesystem watcher event, so the miss is a timing window,
   * not a failed write. Caching that null poisoned `granolaIdCache` and made
   * every later cache scan throw `Cannot read properties of null`.
   */
  private cacheCreatedFile(
    granolaId: string,
    created: TFile | null,
    candidate: string,
    type: "note" | "transcript" | "combined"
  ): void {
    const file = created ?? this.app.vault.getFileByPath(candidate);
    if (file) {
      this.updateCache(granolaId, file, type);
      return;
    }

    // The file is on disk but not yet indexed. Leave it out of the cache: the
    // next sync rebuilds the cache from frontmatter and picks it up in place.
    log.warn(
      `Created ${type} file ${candidate} (granolaId=${granolaId}) but the vault has not indexed it yet — skipping cache entry`
    );
  }

  /**
   * Returns true if an error from `vault.create`/`vault.rename` indicates the
   * target path is already occupied (as opposed to a real I/O failure).
   */
  private isFileAlreadyExistsError(e: unknown): boolean {
    const message = e instanceof Error ? e.message : String(e);
    return /already exists/i.test(message);
  }

  /**
   * Builds a collision-resolved candidate path by appending a date suffix and,
   * for repeated collisions, a numeric counter to the base filename.
   */
  private buildCollisionCandidate(
    basePath: string,
    noteDate: Date,
    n: number
  ): string {
    const stem = basePath.replace(/\.md$/, "");
    const dateSuffix = formatDateForFilename(noteDate).replace(/\s+/g, "_");
    const suffix = n <= 1 ? `-${dateSuffix}` : `-${dateSuffix}-${n}`;
    return normalizePath(`${stem}${suffix}.md`);
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
      log.debug(`Skipped ${type} file — content unchanged: ${existingFile.path} (granolaId=${granolaId})`);
      return false;
    }

    await this.app.vault.modify(existingFile, content);

    // Handle path change (e.g., title changed)
    if (existingFile.path !== normalizedPath) {
      log.debug(`Renaming ${type} file: ${existingFile.path} → ${normalizedPath} (granolaId=${granolaId})`);
      await this.attemptRename(existingFile, normalizedPath, granolaId, type);
    }

    log.debug(`Updated ${type} file: ${existingFile.path} (granolaId=${granolaId})`);
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
   * Resolves the ideal (collision-free) file path for a note or transcript.
   *
   * Collision handling is no longer done here: `createNewFile` treats the
   * filesystem as the source of truth and resolves collisions on `create`,
   * which is correct on case-insensitive filesystems where a path pre-check
   * can miss a case/normalization variant.
   *
   * @param filename - The base filename (e.g., "Note.md")
   * @param noteDate - The date of the note (determines the target folder)
   * @param isTranscript - Whether this is a transcript file
   * @returns The resolved file path, or null if folder path cannot be resolved
   */
  resolveFilePath(
    filename: string,
    noteDate: Date,
    isTranscript: boolean = false
  ): string | null {
    const folderPath = this.resolveFolderPath(noteDate, isTranscript);
    if (!folderPath) {
      return null;
    }

    return normalizePath(`${folderPath}/${filename}`);
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
      log.debug(`Cannot resolve folder path for ${filename} (granolaId=${granolaId}, isTranscript=${isTranscript})`);
      return false;
    }

    if (!(await this.ensureFolder(folderPath))) {
      log.debug(`Failed to create folder: ${folderPath} — skipping ${filename}`);
      new Notice(
        `Error creating folder: ${folderPath}. Skipping file: ${filename}`,
        7000
      );
      return false;
    }

    const filePath = this.resolveFilePath(filename, noteDate, isTranscript);
    if (!filePath) {
      log.debug(`Cannot resolve file path for ${filename} (granolaId=${granolaId})`);
      return false;
    }

    const type = isTranscript ? "transcript" : "note";
    return this.saveFile(
      filePath,
      content,
      granolaId,
      type,
      forceOverwrite,
      noteDate,
      null
    );
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
    forceOverwrite: boolean = false,
    folders?: string[]
  ): Promise<{ saved: boolean; path: string | null }> {
    if (!doc.id) {
      log.error("Document missing required id field:", doc);
      return { saved: false, path: null };
    }
    const prepared = documentProcessor.prepareCombinedNote(
      doc,
      transcriptContent,
      folders
    );
    if (!prepared) {
      log.debug(`Skipping combined doc ${doc.id} — no parseable content`);
      return { saved: false, path: null };
    }
    const { filename, content } = prepared;
    const noteDate = getNoteDate(doc);

    // Resolve folder path (combined files use note folder path, not transcript folder)
    const folderPath = this.resolveFolderPath(noteDate, false);
    if (!folderPath) {
      return { saved: false, path: null };
    }

    if (!(await this.ensureFolder(folderPath))) {
      new Notice(
        `Error creating folder: ${folderPath}. Skipping file: ${filename}`,
        7000
      );
      return { saved: false, path: null };
    }

    const filePath = this.resolveFilePath(filename, noteDate, false);
    if (!filePath) {
      return { saved: false, path: null };
    }

    // Save with type "combined"
    const saved = await this.saveFile(
      filePath,
      content,
      doc.id,
      "combined",
      forceOverwrite,
      noteDate,
      extractLegacyIdFromWebUrl(doc.web_url)
    );

    // Return the actual on-disk path. When we try to rename to the "ideal"
    // collision-free filename and `vault.rename()` fails, we must not return
    // the attempted destination path (which would break daily-note links).
    const savedFile = this.findByGranolaId(doc.id, "combined");
    const actualPath =
      savedFile?.path ? normalizePath(savedFile.path) : filePath;

    return { saved, path: actualPath };
  }

  /**
   * Prepares and saves a Granola note to disk.
   */
  async saveNoteToDisk(
    doc: GranolaDoc,
    documentProcessor: DocumentProcessor,
    forceOverwrite: boolean = false,
    folders?: string[]
  ): Promise<{ saved: boolean; path: string | null }> {
    if (!doc.id) {
      log.error("Document missing required id field:", doc);
      return { saved: false, path: null };
    }
    const prepared = documentProcessor.prepareNote(doc, folders);
    if (!prepared) {
      log.debug(`Skipping doc ${doc.id} — no parseable content`);
      return { saved: false, path: null };
    }
    const { filename, content } = prepared;
    const noteDate = getNoteDate(doc);

    const folderPath = this.resolveFolderPath(noteDate, false);
    if (!folderPath) {
      return { saved: false, path: null };
    }

    if (!(await this.ensureFolder(folderPath))) {
      new Notice(
        `Error creating folder: ${folderPath}. Skipping file: ${filename}`,
        7000
      );
      return { saved: false, path: null };
    }

    const filePath = this.resolveFilePath(filename, noteDate, false);
    if (!filePath) {
      return { saved: false, path: null };
    }

    const saved = await this.saveFile(
      filePath,
      content,
      doc.id,
      "note",
      forceOverwrite,
      noteDate,
      extractLegacyIdFromWebUrl(doc.web_url)
    );

    // Return the actual on-disk path. When we try to rename to the "ideal"
    // collision-free filename and `vault.rename()` fails, we must not return
    // the attempted destination path (which would break daily-note links).
    const savedFile = this.findByGranolaId(doc.id, "note");
    const actualPath =
      savedFile?.path ? normalizePath(savedFile.path) : filePath;

    return { saved, path: actualPath };
  }

  /**
   * Prepares and saves a Granola transcript to disk.
   */
  async saveTranscriptToDisk(
    doc: GranolaDoc,
    transcriptContent: string,
    documentProcessor: DocumentProcessor,
    forceOverwrite: boolean = false
  ): Promise<{ saved: boolean; path: string | null }> {
    if (!doc.id) {
      log.error("Document missing required id field:", doc);
      return { saved: false, path: null };
    }
    const { filename, content } = documentProcessor.prepareTranscript(
      doc,
      transcriptContent
    );
    const noteDate = getNoteDate(doc);

    const folderPath = this.resolveFolderPath(noteDate, true);
    if (!folderPath) {
      log.debug(`Cannot resolve folder path for ${filename} (granolaId=${doc.id}, isTranscript=true)`);
      return { saved: false, path: null };
    }

    if (!(await this.ensureFolder(folderPath))) {
      log.debug(`Failed to create folder: ${folderPath} — skipping ${filename}`);
      new Notice(
        `Error creating folder: ${folderPath}. Skipping file: ${filename}`,
        7000
      );
      return { saved: false, path: null };
    }

    const filePath = this.resolveFilePath(filename, noteDate, true);
    if (!filePath) {
      log.debug(`Cannot resolve file path for ${filename} (granolaId=${doc.id})`);
      return { saved: false, path: null };
    }

    const saved = await this.saveFile(
      filePath,
      content,
      doc.id,
      "transcript",
      forceOverwrite,
      noteDate,
      extractLegacyIdFromWebUrl(doc.web_url)
    );

    // Return the actual on-disk path. When we try to rename to the "ideal"
    // collision-free filename and `vault.rename()` fails, we must not return
    // the attempted destination path (which would break note frontmatter).
    const savedFile = this.findByGranolaId(doc.id, "transcript");
    const actualPath =
      savedFile?.path ? normalizePath(savedFile.path) : filePath;

    return { saved, path: actualPath };
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
