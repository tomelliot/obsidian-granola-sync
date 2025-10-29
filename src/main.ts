import { Notice, Plugin, normalizePath, TFile } from "obsidian";
import {
  createDailyNote,
  getDailyNote,
  getAllDailyNotes,
} from "obsidian-daily-notes-interface";
import { updateSection } from "./utils/textUtils";
import { sanitizeFilename } from "./utils/filenameUtils";
import { getNoteDate } from "./utils/dateUtils";
import {
  GranolaSyncSettings,
  DEFAULT_SETTINGS,
  GranolaSyncSettingTab,
  SyncDestination,
  TranscriptDestination,
} from "./settings";
import moment from "moment";
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
import { convertProsemirrorToMarkdown } from "./services/prosemirrorMarkdown";
import { formatTranscriptBySpeaker } from "./services/transcriptFormatter";
import { PathResolver } from "./services/pathResolver";
import { log } from "./utils/logger";

export default class GranolaSync extends Plugin {
  settings: GranolaSyncSettings;
  syncIntervalId: number | null = null;
  private granolaIdCache: Map<string, TFile> = new Map();
  private pathResolver!: PathResolver;

  async onload() {
    await this.loadSettings();

    // Initialize services
    this.pathResolver = new PathResolver({
      transcriptDestination: this.settings.transcriptDestination,
      granolaTranscriptsFolder: this.settings.granolaTranscriptsFolder,
    });

    // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    const statusBarItemEl = this.addStatusBarItem();
    statusBarItemEl.setText("Granola sync idle"); // Updated status bar text

    // This adds a simple command that can be triggered anywhere
    this.addCommand({
      id: "sync-granola",
      name: "Sync from Granola",
      callback: async () => {
        new Notice("Granola sync: Starting manual sync.");
        statusBarItemEl.setText("Granola sync: Syncing...");

        await this.sync();
        new Notice("Granola sync: Manual sync complete.");

        if (!this.settings.syncNotes && !this.settings.syncTranscripts) {
          new Notice(
            "Granola sync: No sync options enabled. Please enable either notes or transcripts in settings."
          );
        }

        statusBarItemEl.setText(
          `Granola sync: Last synced ${new Date(
            this.settings.latestSyncTime
          ).toLocaleString()}`
        );
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
        const statusBarItemEl = this.app.workspace.containerEl.querySelector(
          ".status-bar-item .status-bar-item-segment"
        );
        if (statusBarItemEl)
          statusBarItemEl.setText("Granola sync: Auto-syncing...");

        await this.sync();

        if (statusBarItemEl)
          statusBarItemEl.setText(
            `Granola sync: Last synced ${new Date(
              this.settings.latestSyncTime
            ).toLocaleString()}`
          );
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
  private async buildGranolaIdCache(): Promise<void> {
    this.granolaIdCache.clear();
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      try {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.granola_id) {
          const granolaId = cache.frontmatter.granola_id as string;
          this.granolaIdCache.set(granolaId, file);
        }
      } catch (e) {
        console.error(`Error reading frontmatter for ${file.path}:`, e);
      }
    }
  }

  // Find an existing file with the given Granola ID using the cache
  private findFileByGranolaId(granolaId: string): TFile | null {
    return this.granolaIdCache.get(granolaId) || null;
  }

  // Update the Granola ID cache if granolaId is provided
  private updateGranolaIdCache(
    granolaId: string | undefined,
    file: TFile
  ): void {
    if (granolaId) {
      this.granolaIdCache.set(granolaId, file);
    }
  }

  // Compute the folder path for a note based on daily note settings

  // Generic save to disk method
  // Returns: true if a new file was created or an existing file was updated, false if skipped or error
  private async saveToDisk(
    filename: string,
    content: string,
    noteDate: Date,
    isTranscript: boolean = false,
    granolaId?: string
  ): Promise<boolean> {
    try {
      // Determine the folder path based on settings and file type
      let folderPath: string;

      if (isTranscript) {
        // Handle transcript destinations
        switch (this.settings.transcriptDestination) {
          case TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE:
            folderPath = this.pathResolver.computeDailyNoteFolderPath(noteDate);
            break;
          case TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER:
            folderPath = normalizePath(this.settings.granolaTranscriptsFolder);
            break;
        }
      } else {
        // Handle note destinations
        switch (this.settings.syncDestination) {
          case SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE:
            folderPath = this.pathResolver.computeDailyNoteFolderPath(noteDate);
            break;
          case SyncDestination.GRANOLA_FOLDER:
            folderPath = normalizePath(this.settings.granolaFolder);
            break;
          default:
            // This shouldn't happen for individual files
            new Notice(
              `Invalid sync destination for individual files: ${this.settings.syncDestination}`,
              7000
            );
            return false;
        }
      }

      // Ensure the folder exists
      if (!(await this.ensureFolderExists(folderPath))) {
        new Notice(
          `Error creating folder: ${folderPath}. Skipping file: ${filename}`,
          7000
        );
        return false;
      }

      const filePath = normalizePath(`${folderPath}/${filename}`);

      // First, check if a file with this Granola ID already exists anywhere in the vault
      let existingFile: TFile | null = null;
      if (granolaId) {
        existingFile = this.findFileByGranolaId(granolaId);
      }

      // If no file found by Granola ID, check by path
      if (!existingFile) {
        const fileByPath = this.app.vault.getAbstractFileByPath(filePath);
        if (fileByPath instanceof TFile) {
          existingFile = fileByPath;
        }
      }

      if (existingFile) {
        const existingContent = await this.app.vault.read(existingFile);

        if (existingContent !== content) {
          await this.app.vault.modify(existingFile, content);

          // If the file path has changed (title changed), rename the file
          if (existingFile.path !== filePath) {
            try {
              await this.app.vault.rename(existingFile, filePath);
              this.updateGranolaIdCache(granolaId, existingFile);
            } catch (renameError) {
              // If rename fails (e.g., file already exists at new path), just update content
              console.warn(
                `Could not rename file from ${existingFile.path} to ${filePath}:`,
                renameError
              );
            }
          }
          this.updateGranolaIdCache(granolaId, existingFile);
          return true; // Content was updated
        } else {
          this.updateGranolaIdCache(granolaId, existingFile);
          return false; // No change needed
        }
      } else {
        const newFile = await this.app.vault.create(filePath, content);
        this.updateGranolaIdCache(granolaId, newFile);
        return true; // New file created
      }
    } catch (e) {
      new Notice(`Error saving file: ${filename}. Check console.`, 7000);
      console.error("Error saving file to disk:", e);
      return false;
    }
  }

  // Save a note to disk based on the sync destination setting
  private async saveNoteToDisk(
    doc: GranolaDoc,
    markdownContent: string
  ): Promise<boolean> {
    const title = doc.title || "Untitled Granola Note";
    const docId = doc.id || "unknown_id";

    // Prepare frontmatter
    const escapedTitleForYaml = title.replace(/"/g, '\\"');
    const frontmatterLines = [
      "---",
      `granola_id: ${docId}`,
      `title: "${escapedTitleForYaml}"`,
    ];
    if (doc.created_at) frontmatterLines.push(`created_at: ${doc.created_at}`);
    if (doc.updated_at) frontmatterLines.push(`updated_at: ${doc.updated_at}`);
    frontmatterLines.push("---", "");

    let finalMarkdown = frontmatterLines.join("\n");

    // Add transcript link if enabled
    if (
      this.settings.syncTranscripts &&
      this.settings.createLinkFromNoteToTranscript
    ) {
      // Use the date from the note
      let noteDate: Date;
      if (doc.created_at) noteDate = new Date(doc.created_at);
      else if (doc.updated_at) noteDate = new Date(doc.updated_at);
      else noteDate = new Date();

      // Compute transcript path using the helper method
      const transcriptPath = this.pathResolver.computeTranscriptPath(title, noteDate);

      // Add the link
      finalMarkdown += `[Transcript](${transcriptPath})\n\n`;
    }

    // Add the actual note content
    finalMarkdown += markdownContent;

    const filename = sanitizeFilename(title) + ".md";

    // Get the note date
    let noteDate: Date;
    if (doc.created_at) noteDate = new Date(doc.created_at);
    else if (doc.updated_at) noteDate = new Date(doc.updated_at);
    else noteDate = new Date();

    return this.saveToDisk(filename, finalMarkdown, noteDate, false, docId);
  }

  // Save a transcript to disk based on the transcript destination setting
  private async saveTranscriptToDisk(
    doc: GranolaDoc,
    transcriptContent: string
  ): Promise<boolean> {
    const title = doc.title || "Untitled Granola Note";
    const docId = doc.id || "unknown_id";
    const filename = sanitizeFilename(title) + "-transcript.md";

    // Get the note date
    let noteDate: Date;
    if (doc.created_at) noteDate = new Date(doc.created_at);
    else if (doc.updated_at) noteDate = new Date(doc.updated_at);
    else noteDate = new Date();

    // Use a modified ID for transcripts to distinguish them from notes
    const transcriptId = `${docId}-transcript`;
    return this.saveToDisk(
      filename,
      transcriptContent,
      noteDate,
      true,
      transcriptId
    );
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

  private async ensureFolderExists(folderPath: string): Promise<boolean> {
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


  // Filter documents based on syncDaysBack setting
  private filterDocumentsByDate(documents: GranolaDoc[]): GranolaDoc[] {
    // If syncDaysBack is 0, sync all documents (no filtering)
    if (this.settings.syncDaysBack === 0) {
      return documents;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.settings.syncDaysBack);

    return documents.filter((doc) => {
      // Use created_at if available, otherwise fall back to updated_at
      const docDate = doc.created_at
        ? new Date(doc.created_at)
        : doc.updated_at
        ? new Date(doc.updated_at)
        : new Date();

      return docDate >= cutoffDate;
    });
  }

  // Top-level sync function that handles common setup once
  async sync() {
    // Load credentials at the start of each sync
    const { accessToken, error } = await loadGranolaCredentials();
    if (!accessToken || error) {
      console.error("Error loading Granola credentials:", error);
      new Notice(
        `Granola sync error: ${error || "No access token loaded."}`,
        10000
      );
      return;
    }

    // Build the Granola ID cache before syncing
    await this.buildGranolaIdCache();

    // Fetch documents (now handles credentials)
    const documents = await this.fetchDocuments(accessToken);
    if (!documents || documents.length === 0) {
      log.debug("No documents fetched from Granola API");
      return;
    }
    log.debug(`Granola API: Fetched ${documents.length} documents from`);

    // Filter documents based on syncDaysBack setting
    const filteredDocuments = this.filterDocumentsByDate(documents);
    log.debug(`Filtered to ${filteredDocuments.length} documents`);
    if (filteredDocuments.length === 0) {
      new Notice(
        `Granola sync: No documents found within the last ${this.settings.syncDaysBack} days.`,
        5000
      );
      return;
    }

    // Always sync transcripts first if enabled, so notes can link to them
    if (this.settings.syncTranscripts) {
      await this.syncTranscripts(filteredDocuments, accessToken);
    }
    if (this.settings.syncNotes) {
      await this.syncNotes(filteredDocuments);
    }
  }

  private async syncNotes(documents: GranolaDoc[]): Promise<void> {
    const syncedCount =
      this.settings.syncDestination === SyncDestination.DAILY_NOTES
        ? await this.syncNotesToDailyNotes(documents)
        : await this.syncNotesToIndividualFiles(documents);

    this.settings.latestSyncTime = Date.now();
    await this.saveSettings();

    log.debug(`Saved ${syncedCount} note(s)`);

    this.updateSyncStatusBar();
  }

  private async syncNotesToDailyNotes(
    documents: GranolaDoc[]
  ): Promise<number> {
    const dailyNotesMap = this.buildDailyNotesMap(documents);
    const sectionHeadingSetting = this.settings.dailyNoteSectionHeading.trim();

    let syncedCount = 0;

    for (const [dateKey, notesForDay] of dailyNotesMap) {
      const dailyNoteFile = await this.getOrCreateDailyNote(dateKey);
      const sectionContent = this.buildDailyNoteSectionContent(
        notesForDay,
        sectionHeadingSetting,
        dateKey
      );

      await this.updateDailyNoteSection(
        dailyNoteFile,
        sectionHeadingSetting,
        sectionContent
      );

      syncedCount += notesForDay.length;
    }

    return syncedCount;
  }

  private buildDailyNotesMap(documents: GranolaDoc[]): Map<
    string,
    {
      title: string;
      docId: string;
      createdAt?: string;
      updatedAt?: string;
      markdown: string;
    }[]
  > {
    const dailyNotesMap = new Map<
      string,
      {
        title: string;
        docId: string;
        createdAt?: string;
        updatedAt?: string;
        markdown: string;
      }[]
    >();

    for (const doc of documents) {
      const contentToParse = doc.last_viewed_panel?.content;
      if (!contentToParse || contentToParse.type !== "doc") {
        continue;
      }

      const title = doc.title || "Untitled Granola Note";
      const docId = doc.id || "unknown_id";
      const markdownContent = convertProsemirrorToMarkdown(contentToParse);
      const noteDate = getNoteDate(doc);
      const mapKey = moment(noteDate).format("YYYY-MM-DD");

      if (!dailyNotesMap.has(mapKey)) {
        dailyNotesMap.set(mapKey, []);
      }

      dailyNotesMap.get(mapKey)!.push({
        title,
        docId,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        markdown: markdownContent,
      });
    }

    return dailyNotesMap;
  }

  private async getOrCreateDailyNote(dateKey: string): Promise<TFile> {
    const noteMoment = moment(dateKey, "YYYY-MM-DD");
    let dailyNoteFile = getDailyNote(noteMoment, getAllDailyNotes());

    if (!dailyNoteFile) {
      dailyNoteFile = await createDailyNote(noteMoment);
    }

    return dailyNoteFile;
  }

  private buildDailyNoteSectionContent(
    notesForDay: {
      title: string;
      docId: string;
      createdAt?: string;
      updatedAt?: string;
      markdown: string;
    }[],
    sectionHeading: string,
    dateKey: string
  ): string {
    if (notesForDay.length === 0) {
      return sectionHeading;
    }

    let content = sectionHeading;

    for (const note of notesForDay) {
      content += `\n### ${note.title}\n`;
      content += `**Granola ID:** ${note.docId}\n`;

      if (note.createdAt) {
        content += `**Created:** ${note.createdAt}\n`;
      }
      if (note.updatedAt) {
        content += `**Updated:** ${note.updatedAt}\n`;
      }

      if (
        this.settings.syncTranscripts &&
        this.settings.createLinkFromNoteToTranscript
      ) {
        const noteDate = this.getNoteDateFromNote(note, dateKey);
        const transcriptPath = this.pathResolver.computeTranscriptPath(note.title, noteDate);
        content += `**Transcript:** [[${transcriptPath}]]\n`;
      }

      content += `\n${note.markdown}\n`;
    }

    return content.trim() + "\n";
  }

  private getNoteDateFromNote(
    note: {
      createdAt?: string;
      updatedAt?: string;
    },
    fallbackDateKey: string
  ): Date {
    if (note.createdAt) return new Date(note.createdAt);
    if (note.updatedAt) return new Date(note.updatedAt);
    return new Date(fallbackDateKey);
  }

  private async updateDailyNoteSection(
    dailyNoteFile: TFile,
    sectionHeading: string,
    sectionContent: string
  ): Promise<void> {
    try {
      await updateSection(
        this.app,
        dailyNoteFile,
        sectionHeading,
        sectionContent
      );
    } catch (error) {
      new Notice(
        `Error updating section in ${dailyNoteFile.path}. Check console.`,
        7000
      );
      console.error("Error updating daily note section:", error);
    }
  }

  private async syncNotesToIndividualFiles(
    documents: GranolaDoc[]
  ): Promise<number> {
    let syncedCount = 0;

    for (const doc of documents) {
      const contentToParse = doc.last_viewed_panel?.content;
      if (!contentToParse || contentToParse.type !== "doc") {
        continue;
      }

      const markdownContent = convertProsemirrorToMarkdown(contentToParse);

      if (await this.saveNoteToDisk(doc, markdownContent)) {
        syncedCount++;
      }
    }

    return syncedCount;
  }


  private updateSyncStatusBar(): void {
    const statusBarItemEl = this.app.workspace.containerEl.querySelector(
      ".status-bar-item .status-bar-item-segment"
    );
    if (statusBarItemEl) {
      statusBarItemEl.setText(
        `Granola sync: Last synced ${new Date(
          this.settings.latestSyncTime
        ).toLocaleString()}`
      );
    }
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
          docId
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
