import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import fs from "fs";
import path from "path";
import moment from "moment";
import { getDailyNote, getAllDailyNotes } from "obsidian-daily-notes-interface";
import { getTitleOrDefault } from "./utils/filenameUtils";
import { getNoteDate } from "./utils/dateUtils";
import {
  GranolaSyncSettings,
  DEFAULT_SETTINGS,
  GranolaSyncSettingTab,
  migrateSettingsToNewFormat,
} from "./settings";
import {
  getAllDocuments,
  getRecentDocuments,
  fetchGranolaTranscript,
  GranolaDoc,
  TranscriptEntry,
} from "./services/granolaApi";
import {
  buildFolderMap,
  diffFolderMaps,
} from "./services/folderMapBuilder";
import {
  loadCredentials as loadGranolaCredentials,
} from "./services/credentials";
import {
  formatTranscriptBySpeaker,
  formatTranscriptBody,
} from "./services/transcriptFormatter";
import { PathResolver } from "./services/pathResolver";
import { FileSyncService } from "./services/fileSyncService";
import { DocumentProcessor } from "./services/documentProcessor";
import { DailyNoteBuilder } from "./services/dailyNoteBuilder";
import { filterDocumentsByTitle } from "./utils/documentFilter";
import { configureLogger, log } from "./utils/logger";
import { formatStringListAsYaml } from "./utils/yamlUtils";
import {
  showStatusBar,
  hideStatusBar,
  showStatusBarTemporary,
} from "./utils/statusBar";

export default class GranolaSync extends Plugin {
  settings: GranolaSyncSettings;
  syncIntervalId: number | null = null;
  private pathResolver!: PathResolver;
  private fileSyncService!: FileSyncService;
  private documentProcessor!: DocumentProcessor;
  private dailyNoteBuilder!: DailyNoteBuilder;
  statusBarItemEl: HTMLElement | null = null;
  statusBarTimeoutId: number | null = null;

  async onload() {
    await this.loadSettings();

    this.initializeLogger();

    // Initialize services
    this.initializeServices();

    // This adds a simple command that can be triggered anywhere
    this.addCommand({
      id: "sync-granola",
      name: "Sync from Granola",
      callback: async () => {
        new Notice("Granola sync: Starting manual sync.");
        await this.sync();
        new Notice("Granola sync: Manual sync complete.");

        if (!this.settings.syncNotes && !this.settings.syncTranscripts) {
          new Notice(
            "Granola sync: No sync options enabled. Please enable either notes or transcripts in settings."
          );
        }
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new GranolaSyncSettingTab(this.app, this));

    // Setup periodic sync based on settings
    this.setupPeriodicSync();

    // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
    // Example: this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
    // We handle our interval manually with setupPeriodicSync and clearPeriodicSync
  }

  async onunload() {
    // Clean up status bar (includes clearing timeout)
    hideStatusBar(this);
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    const mergedSettings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

    // Check if migration is needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((mergedSettings as any).syncDestination) {
      // Migrate old settings to new format
      this.settings = migrateSettingsToNewFormat(mergedSettings);
      // Save migrated settings immediately
      await this.saveData(this.settings);
      log.info("Migrated settings from old format to new format");
    } else {
      // Already in new format
      this.settings = mergedSettings;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateServices();
    this.setupPeriodicSync();
  }

  /**
   * Initializes all services with current settings.
   * Called during plugin load and when settings change.
   */
  private initializeServices(): void {
    // Initialize PathResolver with current settings
    this.pathResolver = new PathResolver(this.settings);

    // Initialize FileSyncService with PathResolver
    // FileSyncService uses getter function for settings, so it will automatically
    // pick up the latest settings values
    this.fileSyncService = new FileSyncService(
      this.app,
      this.pathResolver,
      () => this.settings
    );

    // Initialize DocumentProcessor with current settings
    this.documentProcessor = new DocumentProcessor(
      {
        syncTranscripts: this.settings.syncTranscripts,
        includePrivateNotes: this.settings.includePrivateNotes,
      },
      this.pathResolver
    );

    // Initialize DailyNoteBuilder with DocumentProcessor
    this.dailyNoteBuilder = new DailyNoteBuilder(
      this.app,
      this.documentProcessor
    );
  }

  /**
   * Updates services when settings change during plugin runtime.
   * Recreates services that depend on settings to ensure they use the latest values.
   */
  private updateServices(): void {
    this.initializeServices();
  }

  setupPeriodicSync() {
    this.clearPeriodicSync(); // Clear any existing interval first
    if (this.settings.isSyncEnabled && this.settings.syncInterval > 0) {
      this.syncIntervalId = window.setInterval(async () => {
        await this.sync();
      }, this.settings.syncInterval * 1000);
      this.registerInterval(this.syncIntervalId); // Register with Obsidian to auto-clear on disable
    }
  }

  clearPeriodicSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  private debugLogFilePath: string | null = null;

  private getPluginDirPath(): string | null {
    const adapter = this.app.vault.adapter;

    if (adapter instanceof FileSystemAdapter) {
      const basePath = adapter.getBasePath();
      const configDir = this.app.vault.configDir;
      return path.join(basePath, configDir, "plugins", this.manifest.id);
    }

    return null;
  }

  private initializeLogger(): void {
    const pluginDir = this.getPluginDirPath();

    if (!pluginDir) {
      configureLogger(null);
      return;
    }

    // Generate a timestamped log filename once per session
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\.\d{3}Z$/, "");
    this.debugLogFilePath = path.join(
      pluginDir,
      "logs",
      `${timestamp}.log`
    );

    configureLogger({
      isDebugEnabled: () => this.settings.enableDebugLogging,
      appendLine: async (line: string) => {
        if (!this.debugLogFilePath) return;
        try {
          await fs.promises.mkdir(path.dirname(this.debugLogFilePath), {
            recursive: true,
          });
          await fs.promises.appendFile(this.debugLogFilePath, line, "utf-8");
        } catch {
          // Swallow all errors to avoid affecting plugin behavior
        }
      },
    });
  }

  async copyDebugLogsToClipboard(): Promise<void> {
    const debugLogPath = this.debugLogFilePath;

    if (!debugLogPath) {
      new Notice(
        "Copying debug logs is not available in this environment."
      );
      return;
    }

    try {
      const contents = await fs.promises.readFile(debugLogPath, "utf-8");

      if (!contents) {
        new Notice("Debug log file is empty.");
        return;
      }

      await navigator.clipboard.writeText(contents);
      new Notice("Debug logs copied to clipboard.");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        new Notice(
          "Debug log file not found. Enable debug logging and try again."
        );
      } else {
        new Notice(
          "Failed to copy debug logs: " +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }
  }

  private updateSyncStatus(
    kind: "Note" | "Transcript",
    current: number,
    total: number
  ): void {
    if (total <= 0) {
      return;
    }

    const clampedCurrent = Math.min(Math.max(current, 1), total);
    const label = kind === "Note" ? "note" : "Transcript";
    showStatusBar(this, `Granola sync: ${label} ${clampedCurrent}/${total}`);
  }

  /**
   * Updates frontmatter on all vault notes affected by folder renames.
   * Scans all markdown files for folders entries matching old paths
   * and replaces them with new paths.
   */
  private async updateRenamedFolders(
    renamedPaths: Map<string, string>
  ): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    let updatedCount = 0;

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const folders = cache?.frontmatter?.folders as
        | string[]
        | undefined;
      if (!folders || !Array.isArray(folders)) continue;

      let changed = false;
      const updatedFolders = folders.map((folder) => {
        const newPath = renamedPaths.get(folder);
        if (newPath) {
          changed = true;
          return newPath;
        }
        return folder;
      });

      if (changed) {
        const content = await this.app.vault.read(file);
        const updatedContent = this.replaceFrontmatterFolders(
          content,
          updatedFolders
        );
        if (updatedContent !== content) {
          await this.app.vault.modify(file, updatedContent);
          updatedCount++;
        }
      }
    }

    if (updatedCount > 0) {
      log.debug(
        `Updated folders in ${updatedCount} file(s) due to folder renames`
      );
    }
  }

  /**
   * Replaces the folders list in YAML frontmatter with updated values.
   */
  private replaceFrontmatterFolders(
    content: string,
    newFolders: string[]
  ): string {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return content;

    const frontmatter = frontmatterMatch[1];

    const folderBlockRegex =
      /folders:\s*\n((?:\s+-\s+.*\n?)*)/;
    const match = frontmatter.match(folderBlockRegex);
    if (!match) return content;

    const newBlock =
      "folders:\n" +
      newFolders.map((f) => `  - "${f}"`).join("\n") +
      "\n";
    const updatedFrontmatter = frontmatter.replace(folderBlockRegex, newBlock);

    return content.replace(
      /^---\n[\s\S]*?\n---/,
      `---\n${updatedFrontmatter}\n---`
    );
  }

  /**
   * Backfills the `folders` frontmatter field on existing vault notes that have
   * a `granola_id` but are missing folder metadata. This ensures previously
   * synced documents get folder paths added when the feature is first enabled.
   */
  private async backfillFolderMetadata(
    docFolders: Record<string, string[]>
  ): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    let updatedCount = 0;
    let scannedCount = 0;
    let alreadyHasFoldersCount = 0;
    let noFolderDataCount = 0;
    let noFrontmatterCount = 0;

    log.debug(`backfillFolderMetadata — scanning ${files.length} markdown file(s), docFolders has ${Object.keys(docFolders).length} mapping(s)`);

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter?.granola_id) continue;

      scannedCount++;

      // Skip files that already have a folders field
      if (cache.frontmatter.folders !== undefined) {
        alreadyHasFoldersCount++;
        continue;
      }

      const granolaId = cache.frontmatter.granola_id as string;
      const folders = docFolders[granolaId];
      if (!folders || folders.length === 0) {
        noFolderDataCount++;
        log.debug(`backfill skip — no folder data for granolaId=${granolaId} (${file.path})`);
        continue;
      }

      const content = await this.app.vault.read(file);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        noFrontmatterCount++;
        log.debug(`backfill skip — no parseable frontmatter in ${file.path}`);
        continue;
      }

      const frontmatter = frontmatterMatch[1];
      const foldersYaml = `folders: ${formatStringListAsYaml(folders)}`;
      const updatedFrontmatter = frontmatter + "\n" + foldersYaml;
      const updatedContent = content.replace(
        /^---\n[\s\S]*?\n---/,
        `---\n${updatedFrontmatter}\n---`
      );

      if (updatedContent !== content) {
        await this.app.vault.modify(file, updatedContent);
        updatedCount++;
        log.debug(`backfill updated — ${file.path} (granolaId=${granolaId}, folders=${JSON.stringify(folders)})`);
      }
    }

    log.debug(`backfillFolderMetadata — scanned=${scannedCount} granola files, updated=${updatedCount}, alreadyHasFolders=${alreadyHasFoldersCount}, noFolderData=${noFolderDataCount}, noFrontmatter=${noFrontmatterCount}`);
  }

  // Top-level sync function that handles common setup once
  async sync(options: { mode?: "standard" | "full" } = {}) {
    const mode = options.mode ?? "standard";
    log.debug(`Sync started — mode=${mode}, daysBack=${this.settings.syncDaysBack}`);
    showStatusBar(this, "Granola sync: Syncing...");

    // Load credentials at the start of each sync
    const { accessToken, error } = await loadGranolaCredentials();
    if (!accessToken || error) {
      log.error("Error loading Granola credentials:", error);
      new Notice(
        `Granola sync error: ${error || "No access token loaded."}`,
        10000
      );
      hideStatusBar(this);
      return;
    }

    // Build the Granola ID cache before syncing
    await this.fileSyncService.buildCache();

    // Fetch documents
    let documents: GranolaDoc[] = [];
    const includeShared = this.settings.includeSharedNotes;
    try {
      if (mode === "full") {
        documents = await getAllDocuments(accessToken, 100, includeShared);
      } else {
        documents = await getRecentDocuments(
          accessToken,
          this.settings.syncDaysBack,
          100,
          includeShared
        );
      }
    } catch (error: unknown) {
      const errorStatus = (error as { status?: number })?.status;
      if (errorStatus === 401) {
        new Notice(
          "Granola sync error: Authentication failed. Your access token may have expired. Please reload Granola to update your credentials file.",
          10000
        );
      } else if (errorStatus === 403) {
        new Notice(
          "Granola sync error: Access forbidden. Please check your permissions.",
          10000
        );
      } else if (errorStatus === 404) {
        new Notice(
          "Granola sync error: API endpoint not found. Please check for updates.",
          10000
        );
      } else if (errorStatus && errorStatus >= 500) {
        new Notice(
          "Granola sync error: Granola API server error. Please try again later.",
          10000
        );
      } else {
        new Notice(
          "Granola sync error: Failed to fetch documents from Granola API. Please check your internet connection.",
          10000
        );
      }
      log.error("Error fetching Granola documents:", error);
      hideStatusBar(this);
      return;
    }

    // Apply title filter
    documents = filterDocumentsByTitle(
      documents,
      this.settings.titleFilterMode,
      this.settings.titleFilterKeyword
    );

    if (documents.length === 0) {
      new Notice(
        mode === "full"
          ? "Granola sync: No documents returned from Granola API."
          : `Granola sync: No documents found within the last ${this.settings.syncDaysBack} days.`,
        5000
      );
      hideStatusBar(this);
      return;
    }

    showStatusBar(this, `Granola sync: Syncing ${documents.length} documents`);
    log.debug(
      mode === "full"
        ? `Granola API: fetched ${documents.length} documents (full sync)`
        : `Granola API: fetched ${documents.length} documents within ${this.settings.syncDaysBack} day(s)`
    );

    // Build folder map (document → folder paths)
    let docFolders: Record<string, string[]> = {};
    try {
      showStatusBar(this, "Granola sync: Fetching folders...");
      const freshFolderMap = await buildFolderMap(accessToken);
      const previousFolderMap = this.settings._folderMapCache ?? null;

      // Detect folder renames and update affected notes
      const diff = diffFolderMaps(previousFolderMap, freshFolderMap);
      if (diff.renamedPaths.size > 0) {
        log.debug(`Detected ${diff.renamedPaths.size} folder rename(s)`);
        await this.updateRenamedFolders(diff.renamedPaths);
      }

      // Persist the fresh folder map
      this.settings._folderMapCache = freshFolderMap;
      await this.saveData(this.settings);

      docFolders = freshFolderMap.docFolders;
      log.debug(`Folder map built — ${Object.keys(freshFolderMap.folders).length} folder(s), ${Object.keys(docFolders).length} document(s) with folder data`);

      // Backfill folders on existing notes that don't have the field yet
      await this.backfillFolderMetadata(docFolders);
    } catch (error) {
      log.error("Failed to build folder map, continuing sync without folder data:", error);
      // Use previously cached data if available
      if (this.settings._folderMapCache) {
        docFolders = this.settings._folderMapCache.docFolders;
        log.debug("Using cached folder map from previous sync");
      }
    }

    const forceOverwrite = mode === "full";
    let transcriptDataMap: Map<string, TranscriptEntry[]> | null = null;
    if (this.settings.syncTranscripts) {
      const transcriptResult = await this.syncTranscripts(
        documents,
        accessToken,
        forceOverwrite
      );
      transcriptDataMap = transcriptResult.transcriptDataMap;
    }
    if (this.settings.syncNotes) {
      await this.syncNotes(documents, forceOverwrite, transcriptDataMap, docFolders);
    }

    // Update frontmatter cross-links between notes and transcripts using
    // actual on-disk paths (after collision resolution).
    await this.updateCrossLinks(documents);

    // Show success message
    showStatusBarTemporary(this, "Granola sync: Complete");
  }

  private async syncNotes(
    documents: GranolaDoc[],
    forceOverwrite: boolean = false,
    transcriptDataMap: Map<string, TranscriptEntry[]> | null = null,
    docFolders: Record<string, string[]> = {}
  ): Promise<void> {
    let syncedCount: number;
    log.debug(`syncNotes — mode=${this.settings.saveAsIndividualFiles ? "individual" : "daily-notes"}, docs=${documents.length}`);

    if (!this.settings.saveAsIndividualFiles) {
      syncedCount = await this.syncNotesToDailyNotes(
        documents,
        forceOverwrite,
        transcriptDataMap,
        docFolders
      );
    } else {
      const result = await this.syncNotesToIndividualFiles(
        documents,
        forceOverwrite,
        transcriptDataMap,
        docFolders
      );
      syncedCount = result.syncedCount;

      // Add links to daily notes if enabled.
      // Sync order: buildCache() runs before sync; each save updates the cache. So when we merge
      // existing links here, every link we wrote in a prior sync either resolves (note still in
      // vault) or is dropped (note deleted).
      if (this.settings.linkFromDailyNotes && result.syncedNotes.length > 0) {
        const linkHeading =
          this.settings.dailyNoteLinkHeading ||
          DEFAULT_SETTINGS.dailyNoteLinkHeading!;
        await this.dailyNoteBuilder.addLinksToDailyNotes(
          result.syncedNotes,
          linkHeading,
          forceOverwrite,
          (path) => this.fileSyncService.getGranolaIdByPath(path)
        );
      }
    }

    this.settings.latestSyncTime = Date.now();
    await this.saveSettings();

    log.debug(`Saved ${syncedCount} note(s)`);
  }

  private async syncNotesToDailyNotes(
    documents: GranolaDoc[],
    forceOverwrite: boolean = false,
    transcriptDataMap: Map<string, TranscriptEntry[]> | null = null,
    docFolders: Record<string, string[]> = {}
  ): Promise<number> {
    const dailyNotesMap = this.dailyNoteBuilder.buildDailyNotesMap(documents, docFolders);
    const sectionHeadingSetting = (
      this.settings.dailyNoteSectionHeading ||
      DEFAULT_SETTINGS.dailyNoteSectionHeading!
    ).trim();
    const isCombinedMode =
      this.settings.syncTranscripts &&
      this.settings.transcriptHandling === "combined";
    let processedCount = 0;
    let syncedCount = 0;

    for (const [dateKey, notesWithDocs] of dailyNotesMap) {
      const dailyNoteFile = await this.dailyNoteBuilder.getOrCreateDailyNote(
        dateKey
      );

      // Extract just the note data for comparison
      const notesForDay = notesWithDocs.map((item) => item.noteData);

      // Check if all notes for this date are already up-to-date (unless forceOverwrite is true)
      if (!forceOverwrite) {
        const fileContent = await this.app.vault.read(dailyNoteFile);
        const existingNotes = this.dailyNoteBuilder.extractExistingNotes(
          fileContent,
          sectionHeadingSetting
        );

        // Check if all notes are present and up-to-date
        const allNotesUpToDate = notesForDay.every((note) => {
          const existingUpdatedAt = existingNotes.get(note.docId);
          // Note is up-to-date if it exists and has the same or newer updated_at timestamp
          return existingUpdatedAt !== undefined && existingUpdatedAt === note.updatedAt;
        });

        if (allNotesUpToDate && existingNotes.size === notesForDay.length) {
          log.debug(`Daily notes for ${dateKey} — all ${notesForDay.length} note(s) up-to-date, skipping`);
          processedCount += notesForDay.length;
          this.updateSyncStatus("Note", processedCount, documents.length);
          continue;
        }
      }

      // Process image attachments and transcripts for each note
      const notesWithImages = await Promise.all(
        notesWithDocs.map(async ({ noteData, doc }) => {
          // Append image embeds to the note's markdown
          let markdownWithImages =
            await this.fileSyncService.appendImageEmbedsForAttachments(
              doc,
              noteData.markdown,
              dailyNoteFile.path
            );

          // If combined mode and transcript available, append transcript content
          if (isCombinedMode && transcriptDataMap) {
            const transcriptData = transcriptDataMap.get(doc.id || "");
            if (transcriptData && transcriptData.length > 0) {
              const transcriptBody = formatTranscriptBody(transcriptData);
              markdownWithImages += "\n\n### Transcript\n\n" + transcriptBody;
              // Set transcript link to heading within the same section
              return {
                ...noteData,
                markdown: markdownWithImages,
                transcript: "[[#Transcript]]",
              };
            }
          }

          return {
            ...noteData,
            markdown: markdownWithImages,
          };
        })
      );

      const sectionContent = this.dailyNoteBuilder.buildDailyNoteSectionContent(
        notesWithImages,
        sectionHeadingSetting
      );

      await this.dailyNoteBuilder.updateDailyNoteSection(
        dailyNoteFile,
        sectionHeadingSetting,
        sectionContent,
        forceOverwrite
      );
      processedCount += notesForDay.length;
      this.updateSyncStatus("Note", processedCount, documents.length);

      syncedCount += notesForDay.length;
    }

    return syncedCount;
  }

  private async syncNotesToIndividualFiles(
    documents: GranolaDoc[],
    forceOverwrite: boolean = false,
    transcriptDataMap: Map<string, TranscriptEntry[]> | null = null,
    docFolders: Record<string, string[]> = {}
  ): Promise<{
    syncedCount: number;
    syncedNotes: Array<{ doc: GranolaDoc; notePath: string }>;
  }> {
    let processedCount = 0;
    let syncedCount = 0;
    const syncedNotes: Array<{
      doc: GranolaDoc;
      notePath: string;
    }> = [];
    const isCombinedMode =
      this.settings.syncTranscripts &&
      this.settings.transcriptHandling === "combined";

    for (const doc of documents) {
      const notePath = this.pathResolver.computeNotePath(doc);

      // Skip processing if note already exists locally and is up-to-date (unless forceOverwrite is true)
      if (!forceOverwrite) {
        const existingNote = this.fileSyncService.findByGranolaId(
          doc.id,
          isCombinedMode ? "combined" : "note"
        );
        if (existingNote) {
          // Check if remote is newer than local
          if (
            !this.fileSyncService.isRemoteNewer(
              doc.id,
              doc.updated_at,
              isCombinedMode ? "combined" : "note"
            )
          ) {
            log.debug(`Skipping doc ${doc.id} — local copy is up-to-date`);
            continue;
          }
        }
      }

      processedCount++;
      this.updateSyncStatus("Note", processedCount, documents.length);

      const folders = docFolders[doc.id];
      log.debug(`Syncing doc ${doc.id} — folders=${folders ? JSON.stringify(folders) : "none"}`);

      // Handle combined mode: save note and transcript together
      if (isCombinedMode && transcriptDataMap) {
        const transcriptData = transcriptDataMap.get(doc.id || "");
        if (transcriptData && transcriptData.length > 0) {
          const transcriptBody = formatTranscriptBody(transcriptData);
          const result = await this.fileSyncService.saveCombinedNoteToDisk(
            doc,
            this.documentProcessor,
            transcriptBody,
            forceOverwrite,
            folders
          );
          if (result.saved) {
            syncedCount++;
            // Use the actual on-disk path to handle collision-resolved filenames
            // (recurring meetings share a title, so later saves get a date suffix).
            syncedNotes.push({ doc, notePath: result.path ?? notePath });
          }
        } else {
          // No transcript available, save as regular note
          const result = await this.fileSyncService.saveNoteToDisk(
            doc,
            this.documentProcessor,
            forceOverwrite,
            undefined,
            folders
          );
          if (result.saved) {
            syncedCount++;
            syncedNotes.push({ doc, notePath: result.path ?? notePath });
          }
        }
      } else {
        // Save note without cross-links; frontmatter linking is done
        // in updateCrossLinks() after both notes and transcripts are saved.
        const result = await this.fileSyncService.saveNoteToDisk(
          doc,
          this.documentProcessor,
          forceOverwrite,
          undefined,
          folders
        );
        if (result.saved) {
          syncedCount++;
          syncedNotes.push({ doc, notePath: result.path ?? notePath });
        }
      }
    }

    log.debug(
      `syncNotesToIndividualFiles - Completed: ${syncedCount} saved out of ${processedCount} processed`
    );
    return { syncedCount, syncedNotes };
  }

  /**
   * After both notes and transcripts are saved, update frontmatter cross-links
   * using the actual on-disk paths (which may differ from computed paths due to
   * collision resolution with date suffixes).
   */
  private async updateCrossLinks(documents: GranolaDoc[]): Promise<void> {
    // Cross-links only apply when both notes and transcripts are synced, and
    // transcripts are saved as separate files (not combined mode).
    if (
      !this.settings.syncNotes ||
      !this.settings.syncTranscripts ||
      this.settings.transcriptHandling === "combined"
    ) {
      return;
    }

    let updatedCount = 0;
    for (const doc of documents) {
      const transcriptFile = this.fileSyncService.findByGranolaId(doc.id, "transcript");
      if (!transcriptFile) continue;

      // Resolve the note path for transcript→note linking
      let noteLinkPath: string | null = null;
      if (this.settings.saveAsIndividualFiles) {
        // Individual files: use actual on-disk path from cache
        const noteFile = this.fileSyncService.findByGranolaId(doc.id, "note");
        if (noteFile) {
          noteLinkPath = noteFile.path;

          // Update note frontmatter with transcript link
          const noteContent = await this.app.vault.read(noteFile);
          const updatedNote = this.upsertFrontmatterField(
            noteContent,
            "transcript",
            `"[[${transcriptFile.path}]]"`
          );
          if (updatedNote !== noteContent) {
            await this.app.vault.modify(noteFile, updatedNote);
          }
        }
      } else {
        // Daily notes mode: link to the daily note heading
        const noteDate = getNoteDate(doc);
        const noteMoment = moment(noteDate);
        const dailyNoteFile = getDailyNote(noteMoment, getAllDailyNotes());
        if (dailyNoteFile) {
          const title = getTitleOrDefault(doc);
          noteLinkPath = `${dailyNoteFile.basename}#${title}`;
        }
      }

      // Update transcript frontmatter with note link
      if (noteLinkPath) {
        const transcriptContent = await this.app.vault.read(transcriptFile);
        const updatedTranscript = this.upsertFrontmatterField(
          transcriptContent,
          "note",
          `"[[${noteLinkPath}]]"`
        );
        if (updatedTranscript !== transcriptContent) {
          await this.app.vault.modify(transcriptFile, updatedTranscript);
        }
      }

      updatedCount++;
    }

    if (updatedCount > 0) {
      log.debug(`Updated cross-links in ${updatedCount} note/transcript pair(s)`);
    }
  }

  /**
   * Adds or updates a single YAML frontmatter field. If the field already
   * exists, its value is replaced; otherwise it is inserted before the
   * closing `---` delimiter.
   */
  private upsertFrontmatterField(
    content: string,
    field: string,
    value: string
  ): string {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return content;

    const frontmatter = frontmatterMatch[1];
    const fieldRegex = new RegExp(`^${field}:.*$`, "m");

    let updatedFrontmatter: string;
    if (fieldRegex.test(frontmatter)) {
      updatedFrontmatter = frontmatter.replace(fieldRegex, `${field}: ${value}`);
    } else {
      updatedFrontmatter = frontmatter + `\n${field}: ${value}`;
    }

    if (updatedFrontmatter === frontmatter) return content;

    return content.replace(
      /^---\n[\s\S]*?\n---/,
      `---\n${updatedFrontmatter}\n---`
    );
  }

  private async syncTranscripts(
    documents: GranolaDoc[],
    accessToken: string,
    forceOverwrite: boolean = false
  ): Promise<{ transcriptDataMap: Map<string, TranscriptEntry[]> }> {
    const transcriptDataMap = new Map<string, TranscriptEntry[]>();
    const isCombinedMode = this.settings.transcriptHandling === "combined";

    let processedCount = 0;
    let syncedCount = 0;

    for (const doc of documents) {
      const docId = doc.id;
      const title = getTitleOrDefault(doc);
      try {
        // Skip fetching if transcript already exists locally and is up-to-date (unless forceOverwrite is true)
        // In combined mode, check for combined files instead of transcript files
        if (!forceOverwrite) {
          const existingTranscript = this.fileSyncService.findByGranolaId(
            docId,
            isCombinedMode ? "combined" : "transcript"
          );
          if (existingTranscript) {
            if (
              !this.fileSyncService.isRemoteNewer(
                docId,
                doc.updated_at,
                isCombinedMode ? "combined" : "transcript"
              )
            ) {
              log.debug(`Skipping transcript for doc ${docId} — local copy is up-to-date`);
              continue;
            }
          }
        }

        const transcriptData: TranscriptEntry[] = await fetchGranolaTranscript(
          accessToken,
          docId
        );
        if (transcriptData.length === 0) {
          log.debug(`Skipping transcript for doc ${docId} — API returned empty transcript`);
          continue;
        }

        // Store transcript data for use in combined mode
        if (docId) {
          transcriptDataMap.set(docId, transcriptData);
        }

        // In combined mode, skip saving separate transcript files
        if (isCombinedMode) {
          processedCount++;
          this.updateSyncStatus("Transcript", processedCount, documents.length);
          continue;
        }

        // Save transcript without cross-links; frontmatter linking is done
        // in updateCrossLinks() after both notes and transcripts are saved,
        // so the paths reflect any collision-resolved filenames.
        const transcriptMd = formatTranscriptBySpeaker(
          transcriptData,
          title,
          docId,
          doc.created_at,
          doc.updated_at,
          doc.people?.attendees
            ?.map((attendee) => attendee.name || attendee.email || "Unknown")
            .filter((name) => name !== "Unknown"),
          undefined
        );
        processedCount++;
        this.updateSyncStatus("Transcript", processedCount, documents.length);
        const transcriptResult = await this.fileSyncService.saveTranscriptToDisk(
          doc,
          transcriptMd,
          this.documentProcessor,
          forceOverwrite
        );
        if (transcriptResult.saved) {
          syncedCount++;
        }
      } catch (e) {
        new Notice(
          `Error fetching transcript for document: ${title}. Check console.`,
          7000
        );
        log.error(`Transcript fetch error for doc ${docId}:`, e);
      }
    }
    log.debug(
      `syncTranscripts - Completed: ${syncedCount} saved out of ${processedCount} processed`
    );
    return { transcriptDataMap };
  }
}
