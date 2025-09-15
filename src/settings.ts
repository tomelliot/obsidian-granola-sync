import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type GranolaSync from "./main";

export enum SyncDestination {
  GRANOLA_FOLDER = "granola_folder",
  DAILY_NOTES = "daily_notes",
  DAILY_NOTE_FOLDER_STRUCTURE = "daily_note_folder_structure",
}

export enum TranscriptDestination {
  GRANOLA_TRANSCRIPTS_FOLDER = "granola_transcripts_folder",
  DAILY_NOTE_FOLDER_STRUCTURE = "daily_note_folder_structure",
}

export interface NoteSettings {
  syncNotes: boolean;
  syncDestination: SyncDestination;
  dailyNoteSectionHeading: string;
  granolaFolder: string;
}

export interface TranscriptSettings {
  syncTranscripts: boolean;
  transcriptDestination: TranscriptDestination;
  granolaTranscriptsFolder: string;
  createLinkFromNoteToTranscript: boolean;
}

export interface AutomaticSyncSettings {
  isSyncEnabled: boolean;
  syncInterval: number;
  tokenPath: string;
  latestSyncTime: number;
}

export type GranolaSyncSettings = NoteSettings &
  TranscriptSettings &
  AutomaticSyncSettings;

export const DEFAULT_SETTINGS: GranolaSyncSettings = {
  // AutomaticSyncSettings
  tokenPath: "configs/supabase.json",
  latestSyncTime: 0,
  isSyncEnabled: false,
  syncInterval: 30 * 60, // every 30 minutes
  // NoteSettings
  syncNotes: true,
  syncDestination: SyncDestination.DAILY_NOTES,
  dailyNoteSectionHeading: "## Granola Notes",
  granolaFolder: "Granola",
  // TranscriptSettings
  syncTranscripts: false,
  transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
  granolaTranscriptsFolder: "Granola/Transcripts",
  createLinkFromNoteToTranscript: false,
};

export class GranolaSyncSettingTab extends PluginSettingTab {
  plugin: GranolaSync;

  constructor(app: App, plugin: GranolaSync) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl("h3", { text: "Granola Sync Settings" });

    new Setting(containerEl)
      .setName("Path to Granola access token file")
      .setDesc(
        'Path to the JSON file containing your Granola authentication token, relative to your vault root (e.g., "configs/supabase.json"). On macOS, copy this file from ~/Library/Application Support/Granola/supabase.json.'
      )
      .addText((text) =>
        text
          .setPlaceholder("Enter the path to the Granola token file")
          .setValue(this.plugin.settings.tokenPath)
          .onChange(async (value) => {
            this.plugin.settings.tokenPath = value;
            await this.plugin.saveSettings();
          })
      );

    // Notes Section
    containerEl.createEl("h4", { text: "Notes" });

    new Setting(containerEl)
      .setName("Sync Notes")
      .setDesc(
        "Enable syncing of meeting notes from Granola. Turn this off if you only want to sync transcripts."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncNotes)
          .onChange(async (value) => {
            this.plugin.settings.syncNotes = value;
            await this.plugin.saveSettings();
            // Refresh display to show/hide note-related settings
            this.display();
          })
      );

    // Only show note-related settings when sync notes is enabled
    if (this.plugin.settings.syncNotes) {
      new Setting(containerEl)
        .setName("Notes sync destination")
        .setDesc("Choose where to save your Granola notes")
        .addDropdown((dropdown) =>
          dropdown
            .addOption(SyncDestination.DAILY_NOTES, "Append to Daily Notes")
            .addOption(SyncDestination.GRANOLA_FOLDER, "Save to Granola folder")
            .addOption(
              SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE,
              "Use Daily Note Folder Structure"
            )
            .setValue(this.plugin.settings.syncDestination)
            .onChange(async (value) => {
              this.plugin.settings.syncDestination = value as SyncDestination;
              await this.plugin.saveSettings();
              // Refresh the settings display to show/hide relevant fields
              this.display();
            })
        );

      // Add explanation for each sync destination option
      const explanationEl = containerEl.createEl("div", {
        cls: "setting-item-description",
      });
      switch (this.plugin.settings.syncDestination) {
        case SyncDestination.DAILY_NOTES:
          explanationEl.setText(
            "Notes will be added as sections within your existing daily notes. Perfect for keeping meeting notes alongside your daily journal."
          );
          break;
        case SyncDestination.GRANOLA_FOLDER:
          explanationEl.setText(
            "All notes will be saved as individual files in a single folder. Simple and straightforward organization."
          );
          break;
        case SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE:
          explanationEl.setText(
            "Notes will be saved as individual files but organized in the same date-based folder structure as your daily notes. Best of both worlds - individual files with chronological organization."
          );
          break;
      }

      // Show relevant settings based on sync destination
      if (
        this.plugin.settings.syncDestination === SyncDestination.DAILY_NOTES
      ) {
        new Setting(containerEl)
          .setName("Daily note section heading")
          .setDesc(
            'The markdown heading that will be used to mark the Granola notes section in your daily notes. Include the heading markers (e.g., "## Meeting Notes").'
          )
          .addText((text) =>
            text
              .setPlaceholder("Enter section heading")
              .setValue(this.plugin.settings.dailyNoteSectionHeading)
              .onChange(async (value) => {
                this.plugin.settings.dailyNoteSectionHeading = value;
                await this.plugin.saveSettings();
              })
          );
      } else if (
        this.plugin.settings.syncDestination === SyncDestination.GRANOLA_FOLDER
      ) {
        new Setting(containerEl)
          .setName("Granola folder")
          .setDesc(
            "The folder where all your Granola notes will be saved. The folder will be created if it doesn't exist."
          )
          .addText((text) =>
            text
              .setPlaceholder("Name of the folder to write notes to")
              .setValue(this.plugin.settings.granolaFolder)
              .onChange(async (value) => {
                this.plugin.settings.granolaFolder = value;
                await this.plugin.saveSettings();
              })
          );
      }
      // For DAILY_NOTE_FOLDER_STRUCTURE, no additional settings are needed
    }

    // Transcripts Section
    containerEl.createEl("h4", { text: "Transcripts" });

    new Setting(containerEl)
      .setName("Sync Transcripts")
      .setDesc(
        "Enable syncing of meeting transcripts from Granola. Transcripts are saved as separate files with speaker-by-speaker formatting."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncTranscripts)
          .onChange(async (value) => {
            this.plugin.settings.syncTranscripts = value;
            await this.plugin.saveSettings();
            // Refresh display to show/hide transcript-related settings
            this.display();
          })
      );

    // Only show transcript-related settings when sync transcripts is enabled
    if (this.plugin.settings.syncTranscripts) {
      new Setting(containerEl)
        .setName("Transcripts sync destination")
        .setDesc("Choose where to save your Granola transcripts")
        .addDropdown((dropdown) =>
          dropdown
            .addOption(
              TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
              "Save to Transcripts Folder"
            )
            .addOption(
              TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE,
              "Use Daily Note Folder Structure"
            )
            .setValue(this.plugin.settings.transcriptDestination)
            .onChange(async (value) => {
              this.plugin.settings.transcriptDestination =
                value as TranscriptDestination;
              await this.plugin.saveSettings();
              // Refresh the settings display to show/hide relevant fields
              this.display();
            })
        );

      // Add explanation for transcript destination
      const transcriptExplanationEl = containerEl.createEl("div", {
        cls: "setting-item-description",
      });
      switch (this.plugin.settings.transcriptDestination) {
        case TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER:
          transcriptExplanationEl.setText(
            "All transcripts will be saved as individual files in a dedicated folder."
          );
          break;
        case TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE:
          transcriptExplanationEl.setText(
            "Transcripts will be saved in the same date-based folder structure as your daily notes."
          );
          break;
      }

      // Show folder setting for transcripts folder option
      if (
        this.plugin.settings.transcriptDestination ===
        TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER
      ) {
        new Setting(containerEl)
          .setName("Granola transcripts folder")
          .setDesc(
            "The folder where all your Granola transcripts will be saved. The folder will be created if it doesn't exist."
          )
          .addText((text) =>
            text
              .setPlaceholder("Name of the folder for transcripts")
              .setValue(this.plugin.settings.granolaTranscriptsFolder)
              .onChange(async (value) => {
                this.plugin.settings.granolaTranscriptsFolder = value;
                await this.plugin.saveSettings();
              })
          );
      }

      // Add link creation setting - only show when both notes and transcripts are enabled
      if (this.plugin.settings.syncNotes) {
        new Setting(containerEl)
          .setName("Create link from Granola note to transcript")
          .setDesc(
            "Automatically add a link to the transcript file at the top of each Granola note. This requires both notes and transcripts to be synced."
          )
          .addToggle((toggle) =>
            toggle
              .setValue(this.plugin.settings.createLinkFromNoteToTranscript)
              .onChange(async (value) => {
                this.plugin.settings.createLinkFromNoteToTranscript = value;
                await this.plugin.saveSettings();
              })
          );
      }
    }

    // Automatic Sync Section
    containerEl.createEl("h4", { text: "Automatic Sync" });

    new Setting(containerEl)
      .setName("Periodic sync enabled")
      .setDesc(
        "Automatically sync your Granola notes at regular intervals. When disabled, you'll need to manually run the sync command."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.isSyncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.isSyncEnabled = value;
            await this.plugin.saveSettings();
            // Refresh the display to show/hide sync interval
            this.display();
          })
      );

    // Only show sync interval when periodic sync is enabled
    if (this.plugin.settings.isSyncEnabled) {
      new Setting(containerEl)
        .setName("Sync interval")
        .setDesc(
          "How often to automatically sync notes when periodic sync is enabled. Enter value in seconds (default: 1800 = 30 minutes)."
        )
        .addText((text) =>
          text
            .setPlaceholder("Enter the interval in seconds")
            .setValue(this.plugin.settings.syncInterval.toString())
            .onChange(async (value) => {
              const numValue = parseInt(value);
              if (!isNaN(numValue) && numValue >= 0) {
                this.plugin.settings.syncInterval = numValue;
                await this.plugin.saveSettings();
              } else {
                new Notice("Please enter a valid number for sync interval.");
              }
            })
        );
    }
  }
}
