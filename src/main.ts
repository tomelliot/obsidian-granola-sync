import { Notice, Plugin } from "obsidian";
import moment from "moment";
import { getDailyNote, getAllDailyNotes } from "obsidian-daily-notes-interface";
import { getTitleOrDefault, sanitizeFilename } from "./utils/filenameUtils";
import { getNoteDate } from "./utils/dateUtils";
import {
  GranolaSyncSettings,
  DEFAULT_SETTINGS,
  GranolaSyncSettingTab,
  SyncDestination,
  TranscriptDestination,
} from "./settings";
import {
  fetchAllGranolaDocuments,
  fetchGranolaDocumentsByDaysBack,
  fetchGranolaTranscript,
  GranolaDoc,
  TranscriptEntry,
} from "./services/granolaApi";
import {
  loadCredentials as loadGranolaCredentials,
  stopCredentialsServer,
} from "./services/credentials";
import {
  formatTranscriptBySpeaker,
  formatTranscriptBody,
} from "./services/transcriptFormatter";
import { PathResolver } from "./services/pathResolver";
import { FileSyncService } from "./services/fileSyncService";
import { DocumentProcessor } from "./services/documentProcessor";
import { DailyNoteBuilder } from "./services/dailyNoteBuilder";
import { FrontmatterMigrationService } from "./services/frontmatterMigration";
import { log } from "./utils/logger";
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

    // Initialize services
    this.pathResolver = new PathResolver({
      transcriptDestination: this.settings.transcriptDestination,
      granolaTranscriptsFolder: this.settings.granolaTranscriptsFolder,
      syncDestination: this.settings.syncDestination,
      granolaFolder: this.settings.granolaFolder,
    });
    this.fileSyncService = new FileSyncService(
      this.app,
      this.pathResolver,
      () => this.settings
    );
    this.documentProcessor = new DocumentProcessor(
      {
        syncTranscripts: this.settings.syncTranscripts,
      },
      this.pathResolver
    );
    this.dailyNoteBuilder = new DailyNoteBuilder(
      this.app,
      this.documentProcessor
    );

    // Run silent migration for legacy frontmatter formats
    const migrationService = new FrontmatterMigrationService(this.app);
    migrationService.migrateLegacyFrontmatter().catch((error) => {
      log.error("Error during frontmatter migration:", error);
    });

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
    stopCredentialsServer();
    // Clean up status bar (includes clearing timeout)
    hideStatusBar(this);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.setupPeriodicSync();
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

  // Build the Granola ID cache by scanning all markdown files in the vault

  // Compute the folder path for a note based on daily note settings

  // Top-level sync function that handles common setup once
  async sync(options: { mode?: "standard" | "full" } = {}) {
    const mode = options.mode ?? "standard";
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
    try {
      if (mode === "full") {
        documents = await fetchAllGranolaDocuments(accessToken);
      } else {
        documents = await fetchGranolaDocumentsByDaysBack(
          accessToken,
          this.settings.syncDaysBack
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

    // Always sync transcripts first if enabled, so notes can link to them
    const forceOverwrite = mode === "full";
    let transcriptDataMap: Map<string, TranscriptEntry[]> | null = null;
    if (this.settings.syncTranscripts) {
      transcriptDataMap = await this.syncTranscripts(
        documents,
        accessToken,
        forceOverwrite
      );
    }
    if (this.settings.syncNotes) {
      await this.syncNotes(documents, forceOverwrite, transcriptDataMap);
    }

    // Show success message
    showStatusBarTemporary(this, "Granola sync: Complete");
  }

  private async syncNotes(
    documents: GranolaDoc[],
    forceOverwrite: boolean = false,
    transcriptDataMap: Map<string, TranscriptEntry[]> | null = null
  ): Promise<void> {
    const syncedCount =
      this.settings.syncDestination === SyncDestination.DAILY_NOTES
        ? await this.syncNotesToDailyNotes(documents, forceOverwrite)
        : await this.syncNotesToIndividualFiles(
            documents,
            forceOverwrite,
            transcriptDataMap
          );

    this.settings.latestSyncTime = Date.now();
    await this.saveSettings();

    log.debug(`Saved ${syncedCount} note(s)`);
  }

  private async syncNotesToDailyNotes(
    documents: GranolaDoc[],
    forceOverwrite: boolean = false
  ): Promise<number> {

    
    const dailyNotesMap = this.dailyNoteBuilder.buildDailyNotesMap(documents);
    const sectionHeadingSetting = this.settings.dailyNoteSectionHeading.trim();
    let processedCount = 0;
    let syncedCount = 0;

    for (const [dateKey, notesForDay] of dailyNotesMap) {
      const dailyNoteFile = await this.dailyNoteBuilder.getOrCreateDailyNote(
        dateKey
      );
      const sectionContent = this.dailyNoteBuilder.buildDailyNoteSectionContent(
        notesForDay,
        sectionHeadingSetting
      );

      await this.dailyNoteBuilder.updateDailyNoteSection(
        dailyNoteFile,
        sectionHeadingSetting,
        sectionContent,
        forceOverwrite
      );
      processedCount++;
      this.updateSyncStatus("Note", processedCount, documents.length);

      syncedCount += notesForDay.length;
    }

    return syncedCount;
  }

  private async syncNotesToIndividualFiles(
    documents: GranolaDoc[],
    forceOverwrite: boolean = false,
    transcriptDataMap: Map<string, TranscriptEntry[]> | null = null
  ): Promise<number> {

    
    let processedCount = 0;
    let syncedCount = 0;
    const isCombinedMode =
      this.settings.syncTranscripts &&
      this.settings.transcriptDestination ===
        TranscriptDestination.COMBINED_WITH_NOTE;

    for (const doc of documents) {
      const contentToParse = doc.last_viewed_panel?.content;
      if (
        !contentToParse ||
        typeof contentToParse === "string" ||
        contentToParse.type !== "doc"
      ) {
        continue;
      }

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
            continue;
          }
        }
      }

      processedCount++;
      this.updateSyncStatus("Note", processedCount, documents.length);

      // Handle combined mode: save note and transcript together
      if (isCombinedMode && transcriptDataMap) {
        const transcriptData = transcriptDataMap.get(doc.id || "");
        if (transcriptData && transcriptData.length > 0) {
          const transcriptBody = formatTranscriptBody(transcriptData);
          if (
            await this.fileSyncService.saveCombinedNoteToDisk(
              doc,
              this.documentProcessor,
              transcriptBody,
              forceOverwrite
            )
          ) {
            syncedCount++;
          }
        } else {
          // No transcript available, save as regular note
          if (
            await this.fileSyncService.saveNoteToDisk(
              doc,
              this.documentProcessor,
              forceOverwrite
            )
          ) {
            syncedCount++;
          }
        }
      } else {
        // Regular mode: save note separately (with optional transcript link)
        // Compute transcript path before preparing note (for frontmatter linking)
        // Only add transcript link when syncing to individual files (not DAILY_NOTES)
        // and not in combined mode
        let transcriptPath: string | null = null;
        if (
          this.settings.syncTranscripts &&
          this.settings.transcriptDestination !==
            TranscriptDestination.COMBINED_WITH_NOTE
        ) {
          const title = getTitleOrDefault(doc);
          const noteDate = getNoteDate(doc);
          const transcriptFilename = sanitizeFilename(title) + "-transcript.md";
          transcriptPath = this.fileSyncService.resolveFilePath(
            transcriptFilename,
            noteDate,
            doc.id,
            true
          );
        }

        if (
          await this.fileSyncService.saveNoteToDisk(
            doc,
            this.documentProcessor,
            forceOverwrite,
            transcriptPath ?? undefined
          )
        ) {
          syncedCount++;
        }
      }
    }

    log.debug(
      `syncNotesToIndividualFiles - Completed: ${syncedCount} saved out of ${processedCount} processed`
    );
    return syncedCount;
  }

  private async syncTranscripts(
    documents: GranolaDoc[],
    accessToken: string,
    forceOverwrite: boolean = false
  ): Promise<Map<string, TranscriptEntry[]>> {
    const transcriptDataMap = new Map<string, TranscriptEntry[]>();
    const isCombinedMode =
      this.settings.transcriptDestination ===
      TranscriptDestination.COMBINED_WITH_NOTE;

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
              continue;
            }
          }
        }

        const transcriptData: TranscriptEntry[] = await fetchGranolaTranscript(
          accessToken,
          docId
        );
        if (transcriptData.length === 0) {
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

        // Compute note path before formatting transcript (for frontmatter linking)
        // Always add note link when notes are being synced
        let notePath: string | null = null;
        if (this.settings.syncNotes) {
          const noteDate = getNoteDate(doc);

          if (this.settings.syncDestination === SyncDestination.DAILY_NOTES) {
            // For daily notes, link to the daily note file with a heading anchor
            const noteMoment = moment(noteDate);
            const dailyNoteFile = getDailyNote(noteMoment, getAllDailyNotes());
            if (dailyNoteFile) {
              // Link to the daily note with the note title as the heading
              notePath = `${dailyNoteFile.basename}#${title}`;
            }
          } else {
            // For individual files, use the resolved file path
            const noteFilename = sanitizeFilename(title) + ".md";
            notePath = this.fileSyncService.resolveFilePath(
              noteFilename,
              noteDate,
              docId,
              false
            );
          }
        }

        // Use the extracted formatting function
        const transcriptMd = formatTranscriptBySpeaker(
          transcriptData,
          title,
          docId,
          doc.created_at,
          doc.updated_at,
          doc.people?.attendees
            ?.map((attendee) => attendee.name || attendee.email || "Unknown")
            .filter((name) => name !== "Unknown"),
          notePath ?? undefined
        );
        processedCount++;
        this.updateSyncStatus("Transcript", processedCount, documents.length);
        if (
          await this.fileSyncService.saveTranscriptToDisk(
            doc,
            transcriptMd,
            this.documentProcessor,
            forceOverwrite
          )
        ) {
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
    return transcriptDataMap;
  }
}
