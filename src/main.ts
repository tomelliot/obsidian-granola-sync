import { Notice, Plugin, normalizePath } from "obsidian";
import { getNoteDate } from "./utils/dateUtils";
import { filterDocumentsByDate } from "./utils/documentFilter";
import {
  GranolaSyncSettings,
  DEFAULT_SETTINGS,
  GranolaSyncSettingTab,
  SyncDestination,
  TranscriptDestination,
} from "./settings";
import {
  fetchGranolaDocuments,
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
    this.fileSyncService = new FileSyncService(this.app);
    this.documentProcessor = new DocumentProcessor(
      {
        syncTranscripts: this.settings.syncTranscripts,
        createLinkFromNoteToTranscript:
          this.settings.createLinkFromNoteToTranscript,
        includeAttendees: this.settings.includeAttendees,
        attendeesFieldName: this.settings.attendeesFieldName,
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

  // Build the Granola ID cache by scanning all markdown files in the vault

  // Compute the folder path for a note based on daily note settings

  /**
   * Resolves the folder path for a file based on settings and file type.
   */
  private resolveFolderPath(
    noteDate: Date,
    isTranscript: boolean
  ): string | null {
    if (isTranscript) {
      // Handle transcript destinations
      switch (this.settings.transcriptDestination) {
        case TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE:
          return this.pathResolver.computeDailyNoteFolderPath(noteDate);
        case TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER:
          return normalizePath(this.settings.granolaTranscriptsFolder);
      }
    } else {
      // Handle note destinations
      switch (this.settings.syncDestination) {
        case SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE:
          return this.pathResolver.computeDailyNoteFolderPath(noteDate);
        case SyncDestination.GRANOLA_FOLDER:
          return normalizePath(this.settings.granolaFolder);
        default:
          // This shouldn't happen for individual files
          new Notice(
            `Invalid sync destination for individual files: ${this.settings.syncDestination}`,
            7000
          );
          return null;
      }
    }
  }

  /**
   * Generic save to disk method that resolves the folder path and delegates to FileSyncService.
   * Returns: true if a new file was created or an existing file was updated, false if skipped or error
   */
  private async saveToDisk(
    filename: string,
    content: string,
    noteDate: Date,
    isTranscript: boolean = false,
    granolaId?: string
  ): Promise<boolean> {
    // Resolve the folder path
    const folderPath = this.resolveFolderPath(noteDate, isTranscript);
    if (!folderPath) {
      return false;
    }

    // Ensure the folder exists
    if (!(await this.fileSyncService.ensureFolder(folderPath))) {
      new Notice(
        `Error creating folder: ${folderPath}. Skipping file: ${filename}`,
        7000
      );
      return false;
    }

    // Build the full file path and delegate to FileSyncService
    const filePath = normalizePath(`${folderPath}/${filename}`);
    const type = isTranscript ? "transcript" : "note";
    return this.fileSyncService.saveFile(filePath, content, granolaId, type);
  }

  // Save a note to disk based on the sync destination setting
  private async saveNoteToDisk(doc: GranolaDoc): Promise<boolean> {
    const { filename, content } = this.documentProcessor.prepareNote(doc);
    const docId = doc.id || "unknown_id";
    const noteDate = getNoteDate(doc);

    return this.saveToDisk(filename, content, noteDate, false, docId);
  }

  // Save a transcript to disk based on the transcript destination setting
  private async saveTranscriptToDisk(
    doc: GranolaDoc,
    transcriptContent: string
  ): Promise<boolean> {
    const { filename, content } = this.documentProcessor.prepareTranscript(
      doc,
      transcriptContent
    );
    const docId = doc.id || "unknown_id";
    const noteDate = getNoteDate(doc);

    // Use the original docId - transcripts now distinguished by type field in frontmatter
    return this.saveToDisk(filename, content, noteDate, true, docId);
  }

  private async fetchDocuments(accessToken: string): Promise<GranolaDoc[]> {
    try {
      return await fetchGranolaDocuments(accessToken);
    } catch (error: unknown) {
      console.error("Error fetching Granola documents: ", error);
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
      console.error("API request error:", error);
      return [];
    }
  }

  // Top-level sync function that handles common setup once
  async sync() {
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

    // Fetch documents (now handles credentials)
    const documents = await this.fetchDocuments(accessToken);
    if (!documents || documents.length === 0) {
      log.debug("No documents fetched from Granola API");
      hideStatusBar(this);
      return;
    }
    log.debug(`Granola API: Fetched ${documents.length} documents from`);

    // Filter documents based on syncDaysBack setting
    const filteredDocuments = filterDocumentsByDate(
      documents,
      this.settings.syncDaysBack
    );
    log.debug(`Filtered to ${filteredDocuments.length} documents`);
    if (filteredDocuments.length === 0) {
      new Notice(
        `Granola sync: No documents found within the last ${this.settings.syncDaysBack} days.`,
        5000
      );
      hideStatusBar(this);
      return;
    }

    // Always sync transcripts first if enabled, so notes can link to them
    if (this.settings.syncTranscripts) {
      await this.syncTranscripts(filteredDocuments, accessToken);
    }
    if (this.settings.syncNotes) {
      await this.syncNotes(filteredDocuments);
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

      syncedCount += notesForDay.length;
    }

    return syncedCount;
  }

  private async syncNotesToIndividualFiles(
    documents: GranolaDoc[]
  ): Promise<number> {
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

      if (await this.saveNoteToDisk(doc)) {
        syncedCount++;
      }
    }

    return syncedCount;
  }

  private async syncTranscripts(
    documents: GranolaDoc[],
    accessToken: string
  ): Promise<void> {
    let syncedCount = 0;
    for (const doc of documents) {
      const docId = doc.id;
      const title = doc.title || "Untitled Granola Note";
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
          doc.attendees,
          this.settings.includeAttendees,
          this.settings.attendeesFieldName
        );
        if (await this.saveTranscriptToDisk(doc, transcriptMd)) {
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

    let locationMessage: string;
    switch (this.settings.transcriptDestination) {
      case TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE:
        locationMessage = "daily note folder structure";
        break;
      case TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER:
        locationMessage = `'${this.settings.granolaTranscriptsFolder}'`;
        break;
    }
  }
}
