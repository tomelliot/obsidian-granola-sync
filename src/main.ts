import { Notice, Plugin } from "obsidian";
import { getTitleOrDefault } from "./utils/filenameUtils";
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
import { formatTranscriptBySpeaker } from "./services/transcriptFormatter";
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
  initialSyncTimeoutId: number | null = null;
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
    });
    this.fileSyncService = new FileSyncService(
      this.app,
      this.pathResolver,
      () => this.settings
    );
    this.documentProcessor = new DocumentProcessor(
      {
        syncTranscripts: this.settings.syncTranscripts,
        createLinkFromNoteToTranscript:
          this.settings.createLinkFromNoteToTranscript,
      },
      this.pathResolver
    );
    this.dailyNoteBuilder = new DailyNoteBuilder(
      this.app,
      this.documentProcessor,
      this.pathResolver,
      {
        syncTranscripts: this.settings.syncTranscripts,
        createLinkFromNoteToTranscript:
          this.settings.createLinkFromNoteToTranscript,
        dailyNoteSectionHeading: this.settings.dailyNoteSectionHeading,
      }
    );

    // Run silent migration for legacy frontmatter formats
    const migrationService = new FrontmatterMigrationService(this.app);
    migrationService.migrateLegacyFrontmatter().catch((error) => {
      console.error("Error during frontmatter migration:", error);
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
      // Schedule first sync after 60 seconds
      this.initialSyncTimeoutId = window.setTimeout(async () => {
        await this.sync();
        this.initialSyncTimeoutId = null;
        
        // After first sync, set up regular interval
        this.syncIntervalId = window.setInterval(async () => {
          await this.sync();
        }, this.settings.syncInterval * 1000);
        this.registerInterval(this.syncIntervalId);
      }, 60000); // 60 seconds delay for first sync
      
      this.registerInterval(this.initialSyncTimeoutId);
    }
  }

  clearPeriodicSync() {
    if (this.initialSyncTimeoutId !== null) {
      window.clearTimeout(this.initialSyncTimeoutId);
      this.initialSyncTimeoutId = null;
    }
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
      console.error("Error loading Granola credentials:", error);
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
          "Granola sync error: Authentication failed. Your access token may have expired. Please update your credentials file.",
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
      console.error("Error fetching Granola documents: ", error);
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
    if (this.settings.syncTranscripts) {
      await this.syncTranscripts(documents, accessToken);
    }
    if (this.settings.syncNotes) {
      await this.syncNotes(documents);
    }

    // Show success message
    showStatusBarTemporary(this, "Granola sync: Complete");
  }

  private async syncNotes(documents: GranolaDoc[]): Promise<void> {
    const syncedCount =
      this.settings.syncDestination === SyncDestination.DAILY_NOTES
        ? await this.syncNotesToDailyNotes(documents)
        : await this.syncNotesToIndividualFiles(documents);

    this.settings.latestSyncTime = Date.now();
    await this.saveSettings();

    log.debug(`Saved ${syncedCount} note(s)`);
  }

  private async syncNotesToDailyNotes(
    documents: GranolaDoc[]
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
        sectionHeadingSetting,
        dateKey
      );

      await this.dailyNoteBuilder.updateDailyNoteSection(
        dailyNoteFile,
        sectionHeadingSetting,
        sectionContent
      );
      processedCount++;
      this.updateSyncStatus("Note", processedCount, documents.length);

      syncedCount += notesForDay.length;
    }

    return syncedCount;
  }

  private async syncNotesToIndividualFiles(
    documents: GranolaDoc[]
  ): Promise<number> {
    let processedCount = 0;
    let syncedCount = 0;

    for (const doc of documents) {
      const contentToParse = doc.last_viewed_panel?.content;
      if (
        !contentToParse ||
        typeof contentToParse === "string" ||
        contentToParse.type !== "doc"
      ) {
        continue;
      }
      processedCount++;
      this.updateSyncStatus("Note", processedCount, documents.length);

      if (
        await this.fileSyncService.saveNoteToDisk(doc, this.documentProcessor)
      ) {
        syncedCount++;
      }
    }

    return syncedCount;
  }

  private async syncTranscripts(
    documents: GranolaDoc[],
    accessToken: string
  ): Promise<void> {
    let processedCount = 0;
    let syncedCount = 0;
    for (const doc of documents) {
      const docId = doc.id;
      const title = getTitleOrDefault(doc);
      try {
        const transcriptData: TranscriptEntry[] = await fetchGranolaTranscript(
          accessToken,
          docId
        );
        if (transcriptData.length === 0) {
          continue;
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
            .filter((name) => name !== "Unknown")
        );
        processedCount++;
        this.updateSyncStatus("Transcript", processedCount, documents.length);
        if (
          await this.fileSyncService.saveTranscriptToDisk(
            doc,
            transcriptMd,
            this.documentProcessor
          )
        ) {
          syncedCount++;
        }
      } catch (e) {
        new Notice(
          `Error fetching transcript for document: ${title}. Check console.`,
          7000
        );
        console.error(`Transcript fetch error for doc ${docId}:`, e);
      }
    }

    log.debug(`Saved ${syncedCount} transcript(s)`);
  }
}
