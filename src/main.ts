import { Notice, Plugin, normalizePath, TFile } from "obsidian";
import {
  createDailyNote,
  getDailyNote,
  getAllDailyNotes,
  getDailyNoteSettings,
} from "obsidian-daily-notes-interface";
import { updateSection } from "./utils/textUtils";
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

export default class GranolaSync extends Plugin {
  settings: GranolaSyncSettings;
  syncIntervalId: number | null = null;
  private granolaIdCache: Map<string, TFile> = new Map();

  async onload() {
    await this.loadSettings();
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

  private sanitizeFilename(title: string): string {
    const invalidChars = /[<>:"/\\|?*]/g;
    let filename = title.replace(invalidChars, "");
    filename = filename.replace(/\s+/g, "_"); // Replace one or more spaces with a single underscore
    // Truncate filename if too long (e.g., 200 chars, common limit)
    const maxLength = 200;
    if (filename.length > maxLength) {
      filename = filename.substring(0, maxLength);
    }
    return filename;
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

  // Compute the folder path for a note based on daily note settings
  private computeDailyNoteFolderPath(noteDate: Date): string {
    const dailyNoteSettings = getDailyNoteSettings();
    const noteMoment = moment(noteDate);

    // Format the date according to the daily note format
    const formattedPath = noteMoment.format(
      dailyNoteSettings.format || "YYYY-MM-DD"
    );

    // Extract just the folder part (everything except the filename)
    const pathParts = formattedPath.split("/");
    const folderParts = pathParts.slice(0, -1); // Remove the last part (filename)

    // Combine with the base daily notes folder
    const baseFolder = dailyNoteSettings.folder || "";
    if (folderParts.length > 0) {
      return normalizePath(`${baseFolder}/${folderParts.join("/")}`);
    } else {
      return normalizePath(baseFolder);
    }
  }

  // Compute the full path for a transcript file based on settings
  private computeTranscriptPath(title: string, noteDate: Date): string {
    const transcriptFilename = this.sanitizeFilename(title) + "-transcript.md";

    if (
      this.settings.transcriptDestination ===
      TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE
    ) {
      const folderPath = this.computeDailyNoteFolderPath(noteDate);
      return normalizePath(`${folderPath}/${transcriptFilename}`);
    } else {
      // GRANOLA_TRANSCRIPTS_FOLDER
      return normalizePath(
        `${this.settings.granolaTranscriptsFolder}/${transcriptFilename}`
      );
    }
  }

  // Generic save to disk method
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
            folderPath = this.computeDailyNoteFolderPath(noteDate);
            break;
          case TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER:
            folderPath = normalizePath(this.settings.granolaTranscriptsFolder);
            break;
        }
      } else {
        // Handle note destinations
        switch (this.settings.syncDestination) {
          case SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE:
            folderPath = this.computeDailyNoteFolderPath(noteDate);
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
        // Update existing file
        await this.app.vault.modify(existingFile, content);

        // If the file path has changed (title changed), rename the file
        if (existingFile.path !== filePath) {
          try {
            await this.app.vault.rename(existingFile, filePath);
            // Update cache entry if we have a granolaId
            if (granolaId) {
              this.granolaIdCache.set(granolaId, existingFile);
            }
          } catch (renameError) {
            // If rename fails (e.g., file already exists at new path), just update content
            console.warn(
              `Could not rename file from ${existingFile.path} to ${filePath}:`,
              renameError
            );
          }
        }
        // Ensure cache is up to date with the existing file
        if (granolaId) {
          this.granolaIdCache.set(granolaId, existingFile);
        }
      } else {
        // Create new file
        const newFile = await this.app.vault.create(filePath, content);
        // Add to cache if we have a granolaId
        if (granolaId) {
          this.granolaIdCache.set(granolaId, newFile);
        }
      }
      return true;
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
      const transcriptPath = this.computeTranscriptPath(title, noteDate);

      // Add the link
      finalMarkdown += `[Transcript](${transcriptPath})\n\n`;
    }

    // Add the actual note content
    finalMarkdown += markdownContent;

    const filename = this.sanitizeFilename(title) + ".md";

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
    const filename = this.sanitizeFilename(title) + "-transcript.md";

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

  private formatTranscriptBySpeaker(
    transcriptData: TranscriptEntry[],
    title: string,
    granolaId: string
  ): string {
    // Add frontmatter with granola_id for transcript deduplication
    const escapedTitleForYaml = title.replace(/"/g, '\\"');
    let transcriptMd = `---\ngranola_id: ${granolaId}-transcript\ntitle: "${escapedTitleForYaml} - Transcript"\n---\n\n`;

    transcriptMd += `# Transcript for: ${title}\n\n`;
    let currentSpeaker: string | null = null;
    let currentStart: string | null = null;
    let currentText: string[] = [];
    const getSpeaker = (source: string) =>
      source === "microphone" ? "Tom Elliot" : "Guest";

    for (let i = 0; i < transcriptData.length; i++) {
      const entry = transcriptData[i];
      const speaker = getSpeaker(entry.source);

      if (currentSpeaker === null) {
        currentSpeaker = speaker;
        currentStart = entry.start_timestamp;
        currentText = [entry.text];
      } else if (speaker === currentSpeaker) {
        currentText.push(entry.text);
      } else {
        // Write previous block
        transcriptMd += `## ${currentSpeaker} (${currentStart})\n\n`;
        transcriptMd += currentText.join(" ") + "\n\n";
        // Start new block
        currentSpeaker = speaker;
        currentStart = entry.start_timestamp;
        currentText = [entry.text];
      }
    }

    // Write last block
    if (currentSpeaker !== null) {
      transcriptMd += `## ${currentSpeaker} (${currentStart})\n\n`;
      transcriptMd += currentText.join(" ") + "\n\n";
    }

    return transcriptMd;
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
      return;
    }

    // Always sync transcripts first if enabled, so notes can link to them
    if (this.settings.syncTranscripts) {
      await this.syncTranscripts(documents, accessToken);
    }
    if (this.settings.syncNotes) {
      await this.syncNotes(documents);
    }
  }

  private async syncNotes(documents: GranolaDoc[]): Promise<void> {
    let syncedCount = 0;

    if (this.settings.syncDestination === SyncDestination.DAILY_NOTES) {
      // Sync to daily notes
      const dailyNotesMap: Map<
        string,
        {
          title: string;
          docId: string;
          createdAt?: string;
          updatedAt?: string;
          markdown: string;
        }[]
      > = new Map();

      for (const doc of documents) {
        const title = doc.title || "Untitled Granola Note";
        const docId = doc.id || "unknown_id";
        const contentToParse = doc.last_viewed_panel?.content;

        if (!contentToParse || contentToParse.type !== "doc") {
          continue;
        }
        const markdownContent = convertProsemirrorToMarkdown(contentToParse);

        let noteDateSource: Date;
        if (doc.created_at) noteDateSource = new Date(doc.created_at);
        else if (doc.updated_at) noteDateSource = new Date(doc.updated_at);
        else noteDateSource = new Date();

        const noteMoment = moment(noteDateSource);
        const mapKey = noteMoment.format("YYYY-MM-DD"); // Use date string as key

        if (!dailyNotesMap.has(mapKey)) {
          dailyNotesMap.set(mapKey, []);
        }
        dailyNotesMap.get(mapKey)?.push({
          title,
          docId,
          createdAt: doc.created_at,
          updatedAt: doc.updated_at,
          markdown: markdownContent,
        });
      }

      const sectionHeadingSetting =
        this.settings.dailyNoteSectionHeading.trim(); // Trim the setting value

      for (const [dateKey, notesForDay] of dailyNotesMap) {
        const noteMoment = moment(dateKey, "YYYY-MM-DD");
        let dailyNoteFile = getDailyNote(noteMoment, getAllDailyNotes());

        if (!dailyNoteFile) {
          dailyNoteFile = await createDailyNote(noteMoment);
        }

        let fullSectionContent = sectionHeadingSetting; // Use trimmed version here
        if (notesForDay.length > 0) {
          // Only add note content if there are notes
          for (const note of notesForDay) {
            // Each note block starts with a newline, ensuring separation from heading or previous note
            fullSectionContent += `\n### ${note.title}\n`;
            fullSectionContent += `**Granola ID:** ${note.docId}\n`;
            if (note.createdAt)
              fullSectionContent += `**Created:** ${note.createdAt}\n`;
            if (note.updatedAt)
              fullSectionContent += `**Updated:** ${note.updatedAt}\n`;

            // Add transcript link if enabled
            if (
              this.settings.syncTranscripts &&
              this.settings.createLinkFromNoteToTranscript
            ) {
              // Use the date from the note
              let noteDate: Date;
              if (note.createdAt) noteDate = new Date(note.createdAt);
              else if (note.updatedAt) noteDate = new Date(note.updatedAt);
              else noteDate = new Date(dateKey);

              // Compute transcript path using the helper method
              const transcriptPath = this.computeTranscriptPath(
                note.title,
                noteDate
              );

              fullSectionContent += `**Transcript:** [[${transcriptPath}]]\n`;
            }

            fullSectionContent += `\n${note.markdown}\n`;
          }
        } else {
          // If there are no notes for the day, the section will just be the heading.
        }

        // Prepare the final content for the section, ensuring it ends with a single newline.
        const completeSectionText = fullSectionContent.trim() + "\n";

        // Use updateSection from textUtils.ts
        try {
          await updateSection(
            this.app,
            dailyNoteFile,
            sectionHeadingSetting,
            completeSectionText
          );
        } catch (error) {
          new Notice(
            `Error updating section in ${dailyNoteFile.path}. Check console.`,
            7000
          );
        }

        syncedCount += notesForDay.length;
      }
    } else {
      // Sync to individual files (either Granola folder or daily note folder structure)
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
    }

    this.settings.latestSyncTime = Date.now();
    await this.saveSettings(); // Save settings to persist latestSyncTime

    let locationMessage: string;
    switch (this.settings.syncDestination) {
      case SyncDestination.DAILY_NOTES:
        locationMessage = "daily notes";
        break;
      case SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE:
        locationMessage = "daily note folder structure";
        break;
      case SyncDestination.GRANOLA_FOLDER:
        locationMessage = `'${this.settings.granolaFolder}'`;
        break;
    }

    const statusBarItemEl = this.app.workspace.containerEl.querySelector(
      ".status-bar-item .status-bar-item-segment"
    );
    if (statusBarItemEl)
      statusBarItemEl.setText(
        `Granola sync: Last synced ${new Date(
          this.settings.latestSyncTime
        ).toLocaleString()}`
      );
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
        const transcriptMd = this.formatTranscriptBySpeaker(
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
