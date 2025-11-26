import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type GranolaSync from "./main";

export enum SyncDestination {
  GRANOLA_FOLDER = "granola_folder",
  DAILY_NOTES = "daily_notes",
  DAILY_NOTE_FOLDER_STRUCTURE = "daily_note_folder_structure",
  VAULT_ROOT = "vault_root",
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
}

export interface AutomaticSyncSettings {
  isSyncEnabled: boolean;
  syncInterval: number;
  latestSyncTime: number;
  syncDaysBack: number;
}

export type GranolaSyncSettings = NoteSettings &
  TranscriptSettings &
  AutomaticSyncSettings;

export const DEFAULT_SETTINGS: GranolaSyncSettings = {
  // AutomaticSyncSettings
  latestSyncTime: 0,
  isSyncEnabled: false,
  syncInterval: 30 * 60, // every 30 minutes
  syncDaysBack: 7, // sync notes from last 7 days
  // NoteSettings
  syncNotes: true,
  syncDestination: SyncDestination.DAILY_NOTES,
  dailyNoteSectionHeading: "## Granola Notes",
  granolaFolder: "Granola",
  // TranscriptSettings
  syncTranscripts: false,
  transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
  granolaTranscriptsFolder: "Granola/Transcripts",
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

    // Automatic Sync Section
    new Setting(containerEl).setName("Automatic sync").setHeading();

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

    new Setting(containerEl)
      .setName("Sync history (days)")
      .setDesc(
        "How far back to sync notes and transcripts from Granola, in days. For example, setting this to 7 will only sync notes from the last 7 days. Set to 0 to sync all notes (max 100 notes)."
      )
      .addText((text) =>
        text
          .setPlaceholder("Enter number of days")
          .setValue(this.plugin.settings.syncDaysBack.toString())
          .onChange(async (value) => {
            const numValue = parseInt(value);
            if (!isNaN(numValue) && numValue >= 0) {
              this.plugin.settings.syncDaysBack = numValue;
              await this.plugin.saveSettings();
            } else {
              new Notice("Please enter a valid number for sync days.");
            }
          })
      );

    // Notes Section
    new Setting(containerEl).setName("Notes").setHeading();

    new Setting(containerEl)
      .setName("Sync notes")
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
            .addOption(SyncDestination.DAILY_NOTES, "Append to daily notes")
            .addOption(SyncDestination.GRANOLA_FOLDER, "Save to Granola folder")
            .addOption(
              SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE,
              "Use daily note folder structure"
            )
            .addOption(SyncDestination.VAULT_ROOT, "Save to vault root")
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
        case SyncDestination.VAULT_ROOT:
          explanationEl.setText(
            "Notes will be saved as individual files directly in the root of your vault. Useful when you prefer to manually organize files or rely on metadata-driven views."
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
    new Setting(containerEl).setName("Transcripts").setHeading();

    new Setting(containerEl)
      .setName("Sync transcripts")
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
      const transcriptDestSetting = new Setting(containerEl)
        .setName("Transcripts sync destination")
        .setDesc("Choose where to save your Granola transcripts")
        .addDropdown((dropdown) =>
          dropdown
            .addOption(
              TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
              "Save to transcripts folder"
            )
            .addOption(
              TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE,
              "Use daily note folder structure"
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
      const transcriptExplanationEl = transcriptDestSetting.settingEl
        .querySelector(".setting-item-info")
        ?.createEl("div", {
          cls: "setting-item-description",
        });
      if (transcriptExplanationEl) {
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
    }

    new Setting(containerEl)
      .setName("Full sync")
      .setDesc(
        "Re-syncs all files from Granola 🚨 overwriting any local modifications 🚨. Use this to force refresh your notes and transcripts."
      )
      .addButton((button) =>
        button
          .setButtonText("Full sync")
          .setCta()
          .onClick(async () => {
            new Notice("Granola sync: Starting full sync.");
            await this.plugin.sync({ mode: "full" });
            new Notice("Granola sync: Full sync complete.");
          })
      );
  }
}
