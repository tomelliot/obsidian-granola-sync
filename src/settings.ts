import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type GranolaSync from "./main";

/**
 * @deprecated These enums will be removed in version 3.0.0.
 * They are kept for migration purposes only.
 * Use the new settings structure instead.
 */
export enum SyncDestination {
  GRANOLA_FOLDER = "granola_folder",
  DAILY_NOTES = "daily_notes",
  DAILY_NOTE_FOLDER_STRUCTURE = "daily_note_folder_structure",
}

/**
 * @deprecated This enum will be removed in version 3.0.0.
 * It is kept for migration purposes only.
 * Use the new settings structure instead.
 */
export enum TranscriptDestination {
  GRANOLA_TRANSCRIPTS_FOLDER = "granola_transcripts_folder",
  DAILY_NOTE_FOLDER_STRUCTURE = "daily_note_folder_structure",
  COMBINED_WITH_NOTE = "combined_with_note",
}

export interface NoteSettings {
  syncNotes: boolean;
  includePrivateNotes: boolean;
  saveAsIndividualFiles: boolean; // true = files, false = sections

  // Only if saveAsIndividualFiles = true:
  baseFolderType: "custom" | "daily-notes"; // custom folder vs Daily Notes location
  customBaseFolder?: string; // only if baseFolderType = 'custom'
  subfolderPattern:
    | "none"
    | "day"
    | "month"
    | "year-month"
    | "year-quarter"
    | "custom";
  customSubfolderPattern?: string; // only if subfolderPattern = 'custom'
  filenamePattern: string; // default "{title}", supports variables

  // Only if saveAsIndividualFiles = true:
  // Option to add links to daily notes pointing to individual note files
  linkFromDailyNotes: boolean;
  dailyNoteLinkHeading?: string; // heading for links section, default "# Meetings"

  // Only if saveAsIndividualFiles = false:
  dailyNoteSectionHeading?: string;
}

export interface TranscriptSettings {
  syncTranscripts: boolean;
  transcriptHandling: "combined" | "same-location" | "custom-location";

  // Only if transcriptHandling = 'custom-location':
  customTranscriptBaseFolder?: string;
  transcriptSubfolderPattern?:
    | "none"
    | "day"
    | "month"
    | "year-month"
    | "year-quarter"
    | "custom";
  customTranscriptSubfolderPattern?: string;
  transcriptFilenamePattern?: string;
}

export interface AutomaticSyncSettings {
  isSyncEnabled: boolean;
  syncInterval: number;
  latestSyncTime: number;
  syncDaysBack: number;
}

export type GranolaSyncSettings = NoteSettings &
  TranscriptSettings &
  AutomaticSyncSettings & {
    // Legacy settings preserved for potential rollback
    _legacySettings?: {
      syncDestination?: SyncDestination;
      transcriptDestination?: TranscriptDestination;
      granolaFolder?: string;
      granolaTranscriptsFolder?: string;
      dailyNoteSectionHeading?: string;
    };
  };

export const DEFAULT_SETTINGS: GranolaSyncSettings = {
  // AutomaticSyncSettings
  latestSyncTime: 0,
  isSyncEnabled: false,
  syncInterval: 30 * 60, // every 30 minutes
  syncDaysBack: 7, // sync notes from last 7 days
  // NoteSettings
  syncNotes: true,
  includePrivateNotes: false,
  saveAsIndividualFiles: false, // Default to daily notes (sections)
  baseFolderType: "custom",
  customBaseFolder: "Granola",
  subfolderPattern: "none",
  filenamePattern: "{title}",
  linkFromDailyNotes: false,
  dailyNoteLinkHeading: "# Meetings",
  dailyNoteSectionHeading: "# Granola Notes",
  // TranscriptSettings
  syncTranscripts: false,
  transcriptHandling: "custom-location",
  customTranscriptBaseFolder: "Granola/Transcripts",
  transcriptSubfolderPattern: "none",
  transcriptFilenamePattern: "{title}-transcript",
};

/**
 * Migrates old settings format to new format.
 * Detects old format by checking for presence of syncDestination enum.
 *
 * @param oldSettings - The settings object to migrate
 * @returns Migrated settings in new format
 */
export function migrateSettingsToNewFormat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oldSettings: any
): GranolaSyncSettings {
  // Check if migration is needed (old format has syncDestination)
  if (!oldSettings.syncDestination) {
    // Already in new format or fresh install
    return Object.assign({}, DEFAULT_SETTINGS, oldSettings);
  }

  // Preserve old settings for potential rollback
  const legacySettings = {
    _legacySettings: {
      syncDestination: oldSettings.syncDestination,
      transcriptDestination: oldSettings.transcriptDestination,
      granolaFolder: oldSettings.granolaFolder,
      granolaTranscriptsFolder: oldSettings.granolaTranscriptsFolder,
      dailyNoteSectionHeading: oldSettings.dailyNoteSectionHeading,
    },
  };

  // Build new settings structure
  const newSettings: Partial<GranolaSyncSettings> = {
    ...oldSettings, // Preserve automatic sync settings and other unchanged fields
    ...legacySettings,
  };

  // Migrate note settings
  if (oldSettings.syncDestination === SyncDestination.DAILY_NOTES) {
    newSettings.saveAsIndividualFiles = false;
    newSettings.dailyNoteSectionHeading =
      oldSettings.dailyNoteSectionHeading ||
      DEFAULT_SETTINGS.dailyNoteSectionHeading;
  } else {
    newSettings.saveAsIndividualFiles = true;
    newSettings.filenamePattern = "{title}"; // Default pattern

    if (oldSettings.syncDestination === SyncDestination.GRANOLA_FOLDER) {
      newSettings.baseFolderType = "custom";
      newSettings.customBaseFolder =
        oldSettings.granolaFolder || DEFAULT_SETTINGS.customBaseFolder;
      newSettings.subfolderPattern = "none";
    } else if (
      oldSettings.syncDestination === SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE
    ) {
      // User wanted date-based organization, but unclear if they wanted custom folder or Daily Notes folder
      // Default to custom folder with day-based subfolders (preserves existing behavior)
      newSettings.baseFolderType = "custom";
      newSettings.customBaseFolder =
        oldSettings.granolaFolder || DEFAULT_SETTINGS.customBaseFolder;
      newSettings.subfolderPattern = "day";
    }
  }

  // Migrate transcript settings
  if (
    oldSettings.transcriptDestination ===
    TranscriptDestination.COMBINED_WITH_NOTE
  ) {
    newSettings.transcriptHandling = "combined";
  } else if (
    oldSettings.transcriptDestination ===
    TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE
  ) {
    newSettings.transcriptHandling = "same-location";
    // Will use same organization as notes
  } else {
    newSettings.transcriptHandling = "custom-location";
    newSettings.customTranscriptBaseFolder =
      oldSettings.granolaTranscriptsFolder ||
      DEFAULT_SETTINGS.customTranscriptBaseFolder;
    newSettings.transcriptSubfolderPattern = "none";
    newSettings.transcriptFilenamePattern = "{title}-transcript";
  }

  // Remove old enum fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (newSettings as any).syncDestination;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (newSettings as any).transcriptDestination;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (newSettings as any).granolaFolder;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (newSettings as any).granolaTranscriptsFolder;

  return Object.assign({}, DEFAULT_SETTINGS, newSettings);
}

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
        .setName("Include Private Notes")
        .setDesc(
          "Include your raw private notes at the top of each synced note. Private notes appear in a '## Private Notes' section above the '## Enhanced Notes' section."
        )
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.includePrivateNotes)
            .onChange(async (value) => {
              this.plugin.settings.includePrivateNotes = value;
              await this.plugin.saveSettings();
            })
        );
      // How to package notes: individual files or sections in daily notes
      new Setting(containerEl)
        .setName("Save notes as")
        .setDesc("Choose how to package your Granola notes")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("sections", "Sections in daily notes")
            .addOption("files", "Individual files")
            .setValue(
              this.plugin.settings.saveAsIndividualFiles ? "files" : "sections"
            )
            .onChange(async (value) => {
              this.plugin.settings.saveAsIndividualFiles = value === "files";
              await this.plugin.saveSettings();
              this.display();
            })
        );

      if (this.plugin.settings.saveAsIndividualFiles) {
        // Individual files mode
        new Setting(containerEl)
          .setName("Base folder")
          .setDesc("Choose where to save your note files")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("custom", "Custom folder")
              .addOption("daily-notes", "Daily Notes folder")
              .setValue(this.plugin.settings.baseFolderType)
              .onChange(async (value) => {
                this.plugin.settings.baseFolderType = value as
                  | "custom"
                  | "daily-notes";
                await this.plugin.saveSettings();
                this.display();
              })
          );

        if (this.plugin.settings.baseFolderType === "custom") {
          new Setting(containerEl)
            .setName("Custom base folder")
            .setDesc("The folder where your Granola notes will be saved")
            .addText((text) =>
              text
                .setPlaceholder("Granola")
                .setValue(this.plugin.settings.customBaseFolder || "Granola")
                .onChange(async (value) => {
                  this.plugin.settings.customBaseFolder = value;
                  await this.plugin.saveSettings();
                })
            );
        }

        new Setting(containerEl)
          .setName("Subfolder organization")
          .setDesc("Choose how to organize notes in subfolders")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("none", "No subfolders (flat)")
              .addOption("day", "By day (YYYY-MM-DD)")
              .addOption("month", "By month (YYYY-MM)")
              .addOption("year-month", "By year/month (YYYY/MM)")
              .addOption("year-quarter", "By year/quarter (YYYY/Q1)")
              .addOption("custom", "Custom pattern")
              .setValue(this.plugin.settings.subfolderPattern)
              .onChange(async (value) => {
                this.plugin.settings.subfolderPattern = value as
                  | "none"
                  | "day"
                  | "month"
                  | "year-month"
                  | "year-quarter"
                  | "custom";
                await this.plugin.saveSettings();
                this.display();
              })
          );

        if (this.plugin.settings.subfolderPattern === "custom") {
          new Setting(containerEl)
            .setName("Custom subfolder pattern")
            .setDesc(
              "Use variables: {year}, {month}, {day}, {quarter}. Example: {year}/{month}"
            )
            .addText((text) =>
              text
                .setPlaceholder("{year}/{month}")
                .setValue(this.plugin.settings.customSubfolderPattern || "")
                .onChange(async (value) => {
                  this.plugin.settings.customSubfolderPattern = value;
                  await this.plugin.saveSettings();
                })
            );
        }

        new Setting(containerEl)
          .setName("Filename pattern")
          .setDesc(
            "Customize note filenames. Variables: {title}, {date}, {time}, {year}, {month}, {day}"
          )
          .addText((text) =>
            text
              .setPlaceholder("{title}")
              .setValue(this.plugin.settings.filenamePattern)
              .onChange(async (value) => {
                this.plugin.settings.filenamePattern = value || "{title}";
                await this.plugin.saveSettings();
              })
          );

        // Daily note linking option (only for individual files mode)
        new Setting(containerEl)
          .setName("Link from daily notes")
          .setDesc(
            "Add links to your individual note files from the corresponding daily notes. This creates a section in each daily note with links to meetings from that day."
          )
          .addToggle((toggle) =>
            toggle
              .setValue(this.plugin.settings.linkFromDailyNotes)
              .onChange(async (value) => {
                this.plugin.settings.linkFromDailyNotes = value;
                await this.plugin.saveSettings();
                this.display();
              })
          );

        if (this.plugin.settings.linkFromDailyNotes) {
          new Setting(containerEl)
            .setName("Daily note link heading")
            .setDesc(
              'The markdown heading for the meeting links section in daily notes. Include heading markers (e.g., "# Meetings").\n\n' +
              '**Important:** The plugin replaces the entire section from this heading until the next heading at the same or higher level. Any content you manually add under this heading will be overwritten during sync. To preserve your content, place it under a new heading.'
            )
            .addText((text) =>
              text
                .setPlaceholder("# Meetings")
                .setValue(
                  this.plugin.settings.dailyNoteLinkHeading || "# Meetings"
                )
                .onChange(async (value) => {
                  this.plugin.settings.dailyNoteLinkHeading = value;
                  await this.plugin.saveSettings();
                })
            );
        }
      } else {
        // Sections in daily notes mode
        new Setting(containerEl)
          .setName("Daily note section heading")
          .setDesc(
            'The markdown heading for the Granola notes section. Include heading markers (e.g., "# Meeting Notes").'
          )
          .addText((text) =>
            text
              .setPlaceholder("# Granola Notes")
              .setValue(
                this.plugin.settings.dailyNoteSectionHeading ||
                  "# Granola Notes"
              )
              .onChange(async (value) => {
                this.plugin.settings.dailyNoteSectionHeading = value;
                await this.plugin.saveSettings();
              })
          );
      }
    }

    // Transcripts Section
    new Setting(containerEl).setName("Transcripts").setHeading();

    new Setting(containerEl)
      .setName("Sync transcripts")
      .setDesc(
        "Enable syncing of meeting transcripts from Granola. Transcripts are saved with speaker-by-speaker formatting."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncTranscripts)
          .onChange(async (value) => {
            this.plugin.settings.syncTranscripts = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.syncTranscripts) {
      new Setting(containerEl)
        .setName("Transcript handling")
        .setDesc("Choose how to save transcripts")
        .addDropdown((dropdown) => {
          dropdown
            .addOption("custom-location", "Custom location")
            .addOption("same-location", "Same location as notes");
          // Only show combined option when notes are also being synced as individual files
          if (
            this.plugin.settings.syncNotes &&
            this.plugin.settings.saveAsIndividualFiles
          ) {
            dropdown.addOption("combined", "Combined with notes");
          }
          dropdown
            .setValue(this.plugin.settings.transcriptHandling)
            .onChange(async (value) => {
              this.plugin.settings.transcriptHandling = value as
                | "combined"
                | "same-location"
                | "custom-location";
              await this.plugin.saveSettings();
              this.display();
            });
        });

      if (this.plugin.settings.transcriptHandling === "custom-location") {
        new Setting(containerEl)
          .setName("Transcript base folder")
          .setDesc("The folder where transcripts will be saved")
          .addText((text) =>
            text
              .setPlaceholder("Granola/Transcripts")
              .setValue(
                this.plugin.settings.customTranscriptBaseFolder ||
                  "Granola/Transcripts"
              )
              .onChange(async (value) => {
                this.plugin.settings.customTranscriptBaseFolder = value;
                await this.plugin.saveSettings();
              })
          );

        new Setting(containerEl)
          .setName("Transcript subfolder organization")
          .setDesc("Choose how to organize transcripts in subfolders")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("none", "No subfolders (flat)")
              .addOption("day", "By day (YYYY-MM-DD)")
              .addOption("month", "By month (YYYY-MM)")
              .addOption("year-month", "By year/month (YYYY/MM)")
              .addOption("year-quarter", "By year/quarter (YYYY/Q1)")
              .addOption("custom", "Custom pattern")
              .setValue(
                this.plugin.settings.transcriptSubfolderPattern || "none"
              )
              .onChange(async (value) => {
                this.plugin.settings.transcriptSubfolderPattern = value as
                  | "none"
                  | "day"
                  | "month"
                  | "year-month"
                  | "year-quarter"
                  | "custom";
                await this.plugin.saveSettings();
                this.display();
              })
          );

        if (this.plugin.settings.transcriptSubfolderPattern === "custom") {
          new Setting(containerEl)
            .setName("Custom transcript subfolder pattern")
            .setDesc(
              "Use variables: {year}, {month}, {day}, {quarter}. Example: {year}/{month}"
            )
            .addText((text) =>
              text
                .setPlaceholder("{year}/{month}")
                .setValue(
                  this.plugin.settings.customTranscriptSubfolderPattern || ""
                )
                .onChange(async (value) => {
                  this.plugin.settings.customTranscriptSubfolderPattern = value;
                  await this.plugin.saveSettings();
                })
            );
        }

        new Setting(containerEl)
          .setName("Transcript filename pattern")
          .setDesc(
            "Customize transcript filenames. Variables: {title}, {date}, {time}, {year}, {month}, {day}"
          )
          .addText((text) =>
            text
              .setPlaceholder("{title}-transcript")
              .setValue(
                this.plugin.settings.transcriptFilenamePattern ||
                  "{title}-transcript"
              )
              .onChange(async (value) => {
                this.plugin.settings.transcriptFilenamePattern =
                  value || "{title}-transcript";
                await this.plugin.saveSettings();
              })
          );
      }
    }

    // Advanced Section (Full sync + Export settings)
    new Setting(containerEl).setName("Advanced").setHeading();

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

    new Setting(containerEl)
      .setName("Export settings as JSON")
      .setDesc(
        "Copy the current plugin settings as formatted JSON to the clipboard."
      )
      .addButton((button) =>
        button.setButtonText("Export").onClick(async () => {
          try {
            const json = JSON.stringify(this.plugin.settings, null, 2);
            await navigator.clipboard.writeText(json);
            new Notice("Settings copied to clipboard");
          } catch (err) {
            new Notice(
              "Failed to copy settings: " +
                (err instanceof Error ? err.message : String(err))
            );
          }
        })
      );
  }
}
