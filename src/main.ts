import { Notice, Plugin, requestUrl, normalizePath } from "obsidian";
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
} from "./services/granolaApi";
import {
  loadCredentials as loadGranolaCredentials,
  stopCredentialsServer,
} from "./services/credentials";

// Helper interfaces for ProseMirror and API responses
interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  attrs?: { [key: string]: any };
}

interface ProseMirrorDoc {
  type: "doc";
  content: ProseMirrorNode[];
}

export default class GranolaSync extends Plugin {
  settings: GranolaSyncSettings;
  syncIntervalId: number | null = null;
  accessToken: string;

  async onload() {
    await this.loadSettings();
    const { accessToken, error } = await loadGranolaCredentials();
    if (!accessToken || error) {
      new Notice(
        `Granola Sync Error: ${error || "No access token loaded."}`,
        10000
      );
      return;
    }
    this.accessToken = accessToken;

    // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    const statusBarItemEl = this.addStatusBarItem();
    statusBarItemEl.setText("Granola Sync Idle"); // Updated status bar text

    // This adds a simple command that can be triggered anywhere
    this.addCommand({
      id: "sync-granola",
      name: "Sync from Granola", // Updated command name
      callback: async () => {
        new Notice("Granola Sync: Starting manual sync.");
        statusBarItemEl.setText("Granola Sync: Syncing...");

        // Always sync transcripts first if enabled, so notes can link to them
        if (this.settings.syncTranscripts) {
          await this.syncTranscripts();
        }
        if (this.settings.syncNotes) {
          await this.syncNotes();
        }
        new Notice("Granola Sync: Manual sync complete.");

        if (!this.settings.syncNotes && !this.settings.syncTranscripts) {
          new Notice(
            "Granola Sync: No sync options enabled. Please enable either notes or transcripts in settings."
          );
        }

        statusBarItemEl.setText(
          `Granola Sync: Last synced ${new Date(
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
    this.clearPeriodicSync();
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
          statusBarItemEl.setText("Granola Sync: Auto-syncing...");

        // Always sync transcripts first if enabled, so notes can link to them
        if (this.settings.syncTranscripts) {
          await this.syncTranscripts();
        }
        if (this.settings.syncNotes) {
          await this.syncNotes();
        }

        if (statusBarItemEl)
          statusBarItemEl.setText(
            `Granola Sync: Last synced ${new Date(
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
    isTranscript: boolean = false
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
      await this.app.vault.adapter.write(filePath, content);
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

    return this.saveToDisk(filename, finalMarkdown, noteDate, false);
  }

  // Save a transcript to disk based on the transcript destination setting
  private async saveTranscriptToDisk(
    doc: GranolaDoc,
    transcriptContent: string
  ): Promise<boolean> {
    const title = doc.title || "Untitled Granola Note";
    const filename = this.sanitizeFilename(title) + "-transcript.md";

    // Get the note date
    let noteDate: Date;
    if (doc.created_at) noteDate = new Date(doc.created_at);
    else if (doc.updated_at) noteDate = new Date(doc.updated_at);
    else noteDate = new Date();

    return this.saveToDisk(filename, transcriptContent, noteDate, true);
  }

  private convertProsemirrorToMarkdown(
    doc: ProseMirrorDoc | null | undefined
  ): string {
    if (!doc || doc.type !== "doc" || !doc.content) {
      return "";
    }

    let markdownOutput: string[] = [];

    const processNode = (node: ProseMirrorNode): string => {
      if (!node || typeof node !== "object") return "";

      let textContent = "";
      if (node.content && Array.isArray(node.content)) {
        textContent = node.content.map(processNode).join("");
      } else if (node.text) {
        textContent = node.text;
      }

      switch (node.type) {
        case "heading":
          const level = node.attrs?.level || 1;
          return `${"#".repeat(level)} ${textContent.trim()}\n\n`;
        case "paragraph":
          // Ensure paragraphs are separated by exactly one blank line from previous content
          // unless they are empty.
          const trimmedContent = textContent.trim();
          return trimmedContent ? `${trimmedContent}\n\n` : "";
        case "bulletList":
          if (!node.content) return "";
          const items = node.content
            .map((itemNode) => {
              if (itemNode.type === "listItem") {
                const listItemContent = (itemNode.content || [])
                  .map(processNode)
                  .join("")
                  .trim();
                return `- ${listItemContent}`;
              }
              return "";
            })
            .filter((item) => item.length > 0);
          return items.join("\n") + (items.length > 0 ? "\n\n" : "");
        case "text":
          return node.text || "";
        default:
          return textContent;
      }
    };

    doc.content.forEach((node) => {
      markdownOutput.push(processNode(node));
    });

    // Post-processing: Remove excessive newlines, ensure at most two newlines between blocks
    return markdownOutput
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private async fetchDocuments(): Promise<GranolaDoc[] | null> {
    try {
      return await fetchGranolaDocuments(this.accessToken);
    } catch (error: any) {
      if (error.status === 401) {
        new Notice(
          "Granola Sync Error: Authentication failed. Your access token may have expired. Please update your credentials file.",
          10000
        );
      } else if (error.status === 403) {
        new Notice(
          "Granola Sync Error: Access forbidden. Please check your permissions.",
          10000
        );
      } else if (error.status === 404) {
        new Notice(
          "Granola Sync Error: API endpoint not found. Please check for updates.",
          10000
        );
      } else if (error.status >= 500) {
        new Notice(
          "Granola Sync Error: Granola API server error. Please try again later.",
          10000
        );
      } else {
        new Notice(
          "Granola Sync Error: Failed to fetch documents from Granola API. Please check your internet connection.",
          10000
        );
      }
      console.error("API request error:", error);
      return null;
    }
  }

  private async ensureFolderExists(folderPath: string): Promise<boolean> {
    try {
      if (!(await this.app.vault.adapter.exists(folderPath))) {
        await this.app.vault.createFolder(folderPath);
      }
      return true;
    } catch (error) {
      new Notice(
        `Granola Sync Error: Could not create folder '${folderPath}'. Check console.`,
        10000
      );
      console.error("Folder creation error:", error);
      return false;
    }
  }

  private formatTranscriptBySpeaker(
    transcriptData: Array<{
      document_id: string;
      start_timestamp: string;
      text: string;
      source: string;
      id: string;
      is_final: boolean;
      end_timestamp: string;
    }>,
    title: string
  ): string {
    let transcriptMd = `# Transcript for: ${title}\n\n`;
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

  async syncNotes() {
    // Check if note syncing is enabled
    if (!this.settings.syncNotes) {
      return;
    }

    // Fetch documents (now handles credentials)
    const documents = await this.fetchDocuments();
    if (!documents) return;

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
        const markdownContent =
          this.convertProsemirrorToMarkdown(contentToParse);

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
        let dailyNoteFile = getDailyNote(noteMoment as any, getAllDailyNotes());

        if (!dailyNoteFile) {
          dailyNoteFile = await createDailyNote(noteMoment as any);
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

        const markdownContent =
          this.convertProsemirrorToMarkdown(contentToParse);

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
        `Granola Sync: Last synced ${new Date(
          this.settings.latestSyncTime
        ).toLocaleString()}`
      );
  }

  async syncTranscripts() {
    // Check if transcript syncing is enabled
    if (!this.settings.syncTranscripts) {
      return;
    }

    // Fetch documents (now handles credentials)
    const documents = await this.fetchDocuments();
    if (!documents) return;

    let syncedCount = 0;
    for (const doc of documents) {
      const docId = doc.id;
      const title = doc.title || "Untitled Granola Note";
      try {
        const transcriptData = await fetchGranolaTranscript(
          this.accessToken,
          docId
        );
        if (!Array.isArray(transcriptData) || transcriptData.length === 0) {
          continue;
        }
        // Use the extracted formatting function
        const transcriptMd = this.formatTranscriptBySpeaker(
          transcriptData,
          title
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
