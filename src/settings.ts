import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type GranolaSync from "./main";
import type { FolderMapData } from "./services/folderMapBuilder";
import {
  verifyCustomCredentials,
  extractTokensFromImport,
  getStoredAccountEmail,
  CUSTOM_CREDENTIALS_SECRET_ID,
  type WorkosTokens,
} from "./services/credentials";
import { fetchGranolaDocuments } from "./services/granolaApi";
import bmcButtonSvg from "../assets/bmc-button.svg";
import githubLogoSvg from "../assets/github-logo.svg";

function appendSvg(target: HTMLElement, svgMarkup: string): void {
  const doc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() === "svg") {
    target.appendChild(svg);
  }
}

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

export interface FilterSettings {
  syncDaysBack: number;
  includeSharedNotes: boolean;
  titleFilterMode: "disabled" | "include" | "exclude";
  titleFilterKeyword: string;
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
}

type LegacySyncDestination =
  | "granola_folder"
  | "daily_notes"
  | "daily_note_folder_structure";

type LegacyTranscriptDestination =
  | "granola_transcripts_folder"
  | "daily_note_folder_structure"
  | "combined_with_note";

export interface LegacySettings {
  syncDestination?: LegacySyncDestination;
  transcriptDestination?: LegacyTranscriptDestination;
  granolaFolder?: string;
  granolaTranscriptsFolder?: string;
  dailyNoteSectionHeading?: string;
}

export type GranolaSyncSettings = NoteSettings &
  TranscriptSettings &
  AutomaticSyncSettings &
  FilterSettings & {
    enableDebugLogging: boolean;
    // When true, the plugin uses credentials stored in Obsidian Keychain
    // instead of reading the Granola app's credentials file.
    useCustomCredentials: boolean;
    // Persisted folder map for detecting renames across syncs
    _folderMapCache?: FolderMapData;
    // Legacy settings preserved for potential rollback
    _legacySettings?: LegacySettings;
  };

export const DEFAULT_SETTINGS: GranolaSyncSettings = {
  // AutomaticSyncSettings
  latestSyncTime: 0,
  isSyncEnabled: false,
  syncInterval: 30 * 60, // every 30 minutes
  // FilterSettings
  syncDaysBack: 7, // sync notes from last 7 days
  includeSharedNotes: true,
  titleFilterMode: "disabled",
  titleFilterKeyword: "",
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
  dailyNoteSectionHeading: "# Granola notes",
  // TranscriptSettings
  syncTranscripts: false,
  transcriptHandling: "custom-location",
  customTranscriptBaseFolder: "Granola/Transcripts",
  transcriptSubfolderPattern: "none",
  transcriptFilenamePattern: "{title}-transcript",
  // Debug / diagnostics
  enableDebugLogging: false,
  // Custom credentials (off by default)
  useCustomCredentials: false,
};

/**
 * Migrates old settings format to new format.
 * Detects old format by checking for presence of syncDestination enum.
 *
 * @param oldSettings - The settings object to migrate
 * @returns Migrated settings in new format
 */
export function migrateSettingsToNewFormat(
  oldSettings: Partial<GranolaSyncSettings> & LegacySettings
): GranolaSyncSettings {
  // Check if migration is needed (old format has syncDestination)
  if (!oldSettings.syncDestination) {
    // Already in new format or fresh install
    return Object.assign({}, DEFAULT_SETTINGS, oldSettings);
  }

  // Preserve old settings for potential rollback
  const legacySettings: { _legacySettings: LegacySettings } = {
    _legacySettings: {
      syncDestination: oldSettings.syncDestination,
      transcriptDestination: oldSettings.transcriptDestination,
      granolaFolder: oldSettings.granolaFolder,
      granolaTranscriptsFolder: oldSettings.granolaTranscriptsFolder,
      dailyNoteSectionHeading: oldSettings.dailyNoteSectionHeading,
    },
  };

  // Build new settings structure
  const newSettings: Partial<GranolaSyncSettings> & LegacySettings = {
    ...oldSettings, // Preserve automatic sync settings and other unchanged fields
    ...legacySettings,
  };

  // Migrate note settings
  if (oldSettings.syncDestination === "daily_notes") {
    newSettings.saveAsIndividualFiles = false;
    newSettings.dailyNoteSectionHeading =
      oldSettings.dailyNoteSectionHeading ||
      DEFAULT_SETTINGS.dailyNoteSectionHeading;
  } else {
    newSettings.saveAsIndividualFiles = true;
    newSettings.filenamePattern = "{title}"; // Default pattern

    if (oldSettings.syncDestination === "granola_folder") {
      newSettings.baseFolderType = "custom";
      newSettings.customBaseFolder =
        oldSettings.granolaFolder || DEFAULT_SETTINGS.customBaseFolder;
      newSettings.subfolderPattern = "none";
    } else if (oldSettings.syncDestination === "daily_note_folder_structure") {
      // User wanted date-based organization, but unclear if they wanted custom folder or Daily Notes folder
      // Default to custom folder with day-based subfolders (preserves existing behavior)
      newSettings.baseFolderType = "custom";
      newSettings.customBaseFolder =
        oldSettings.granolaFolder || DEFAULT_SETTINGS.customBaseFolder;
      newSettings.subfolderPattern = "day";
    }
  }

  // Migrate transcript settings
  if (oldSettings.transcriptDestination === "combined_with_note") {
    newSettings.transcriptHandling = "combined";
  } else if (
    oldSettings.transcriptDestination === "daily_note_folder_structure"
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
  delete newSettings.syncDestination;
  delete newSettings.transcriptDestination;
  delete newSettings.granolaFolder;
  delete newSettings.granolaTranscriptsFolder;

  return Object.assign({}, DEFAULT_SETTINGS, newSettings);
}

export class GranolaSyncSettingTab extends PluginSettingTab {
  plugin: GranolaSync;
  private showAdvanced = false;

  constructor(app: App, plugin: GranolaSync) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Finds the scrollable ancestor of an element by walking up the DOM until
   * one is found whose computed `overflow-y` allows scrolling. Used to
   * preserve scroll position across `display()` re-renders.
   */
  private findScrollContainer(el: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const overflowY = activeWindow.getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Parses imported credential text, saves the resulting token pair to
   * Obsidian Keychain, and shows a notice. Called from the file-picker's
   * onchange handler so the import flow stays a single user gesture.
   */
  private saveImportedCredentials(text: string): void {
    const extracted = extractTokensFromImport(text);
    if (!extracted) {
      new Notice(
        "Couldn't read credentials from that file. Please pick a valid stored-accounts.json."
      );
      return;
    }
    // obtained_at: 0, expires_in: 1 forces an immediate refresh on first use,
    // avoiding any assumption about the token's remaining lifetime.
    const tokens: WorkosTokens = {
      access_token: extracted.access_token,
      refresh_token: extracted.refresh_token,
      expires_in: 1,
      token_type: "Bearer",
      obtained_at: 0,
      account_email: extracted.account_email,
    };
    this.plugin.app.secretStorage.setSecret(
      CUSTOM_CREDENTIALS_SECRET_ID,
      JSON.stringify(tokens)
    );
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Obsidian Keychain" is a feature name
    new Notice("Credentials saved to Obsidian Keychain.");
    this.display();
  }

  display(): void {
    const { containerEl } = this;

    // Preserve scroll position so toggling settings doesn't jump the view.
    const scrollContainer = this.findScrollContainer(containerEl);
    const scrollTop = scrollContainer?.scrollTop ?? 0;

    containerEl.empty();

    // General settings (no heading per Obsidian conventions)
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
            this.display();
          })
      );

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
            this.display();
          })
      );

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

    // Notes Section
    if (this.plugin.settings.syncNotes) {
      new Setting(containerEl).setName("Notes").setHeading();

      new Setting(containerEl)
        .setName("Include private notes")
        .setDesc(
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- '## Private Notes' / '## Enhanced Notes' are literal heading labels written into the output
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
        new Setting(containerEl)
          .setName("Base folder")
          .setDesc("Choose where to save your note files")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("custom", "Custom folder")
              .addOption("daily-notes", "Daily notes folder")
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
        new Setting(containerEl)
          .setName("Daily note section heading")
          .setDesc(
            'The markdown heading for the Granola notes section. Include heading markers (e.g., "# meeting notes").'
          )
          .addText((text) =>
            text
              .setPlaceholder("# Granola notes")
              .setValue(
                this.plugin.settings.dailyNoteSectionHeading ||
                  "# Granola notes"
              )
              .onChange(async (value) => {
                this.plugin.settings.dailyNoteSectionHeading = value;
                await this.plugin.saveSettings();
              })
          );
      }
    }

    // Transcripts Section
    if (this.plugin.settings.syncTranscripts) {
      new Setting(containerEl).setName("Transcripts").setHeading();

      new Setting(containerEl)
        .setName("Transcript handling")
        .setDesc("Choose how to save transcripts")
        .addDropdown((dropdown) => {
          dropdown
            .addOption("custom-location", "Custom location")
            .addOption("same-location", "Same location as notes");
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
              // eslint-disable-next-line obsidianmd/ui/sentence-case -- folder path default, not display text
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

    // Advanced Section (toggle to show/hide contents)
    new Setting(containerEl).setName("Advanced").setHeading().addToggle(
      (toggle) =>
        toggle.setValue(this.showAdvanced).onChange((value) => {
          this.showAdvanced = value;
          this.display();
        })
    );

    new Setting(containerEl).setDesc(
      "Full sync, custom credentials, filtering, and debugging options."
    );

    if (this.showAdvanced) {
      // Full sync
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

      // Sign in without Granola installed
      new Setting(containerEl).setName("Sign in without Granola").setHeading();

      const hasStoredCredentials = !!this.plugin.app.secretStorage.getSecret(
        CUSTOM_CREDENTIALS_SECRET_ID
      );
      const accountIdentity = hasStoredCredentials
        ? getStoredAccountEmail(this.plugin)
        : null;

      // Status line only renders when custom credentials are active — outside
      // that state, the plugin is reading from the Granola app and a "Signed
      // in as X" would be misleading.
      const customCredentialsActive = this.plugin.settings.useCustomCredentials;
      const statusText = !customCredentialsActive
        ? null
        : accountIdentity
          ? `Signed in as ${accountIdentity}.`
          : hasStoredCredentials
            ? "Custom credentials saved (no email captured during import)."
            : "No credentials saved yet.";

      new Setting(containerEl)
        .setName("Use custom credentials")
        .setDesc(
          createFragment((frag) => {
            frag.appendText(
              "Use credentials you've imported instead of reading them from the Granola app. " +
              "Useful when Granola isn't installed on this device. " +
              "Credentials are stored in Obsidian Keychain."
            );
            if (statusText) {
              frag.createEl("br");
              frag.createEl("br");
              frag.createEl("strong", { text: statusText });
            }
          })
        )
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.useCustomCredentials)
            .onChange(async (v) => {
              this.plugin.settings.useCustomCredentials = v;
              await this.plugin.saveSettings();
              this.display();
            })
        );

      new Setting(containerEl)
        .setName("Import credentials")
        .setDesc(
          createFragment((frag) => {
            frag.appendText(
              "Pick a copy of stored-accounts.json from a device where Granola is installed. Granola writes this file to:"
            );
            const list = frag.createEl("ul");
            const paths: Array<[string, string]> = [
              ["macOS", "~/Library/Application Support/Granola/stored-accounts.json"],
              ["Windows", "%APPDATA%\\Granola\\stored-accounts.json"],
              ["Linux", "~/.config/Granola/stored-accounts.json"],
            ];
            for (const [os, p] of paths) {
              const li = list.createEl("li");
              li.createEl("strong", { text: `${os}: ` });
              li.createEl("code", { text: p });
            }
            frag.appendText(
              "The plugin saves the credentials to Obsidian Keychain — never your vault."
            );
          })
        )
        .addButton((btn) =>
          btn
            .setButtonText("Choose file…")
            .setCta()
            .onClick(() => {
              const input = activeDocument.createElement("input");
              input.type = "file";
              input.accept = "application/json,.json";
              input.onchange = () => {
                const file = input.files?.[0];
                if (!file) return;
                file.text()
                  .then((text) => { this.saveImportedCredentials(text); })
                  .catch((e: unknown) => {
                    const msg = e instanceof Error ? e.message : String(e);
                    new Notice(`Couldn't read that file: ${msg}`);
                  });
              };
              input.click();
            })
        );

      new Setting(containerEl)
        .setName("Test connection")
        .setDesc("Check that your saved credentials still work with Granola.")
        .addButton((btn) => {
          btn
            .setButtonText("Test")
            .setDisabled(!hasStoredCredentials)
            .onClick(async () => {
              btn.setDisabled(true);
              btn.setButtonText("Testing…");
              try {
                const { accessToken, error } = await verifyCustomCredentials(
                  this.plugin
                );
                if (error || !accessToken) {
                  new Notice(`Couldn't connect: ${error ?? "no response"}`, 10000);
                  return;
                }
                // Probe API call: fetch up to 1 document to confirm the new access token works.
                await fetchGranolaDocuments(accessToken, 1, 0);
                new Notice("Connected to Granola successfully.", 5000);
                this.display();
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                new Notice(`Couldn't connect: ${msg}`, 10000);
              } finally {
                btn.setDisabled(false);
                btn.setButtonText("Test");
              }
            });
        });

      new Setting(containerEl)
        .setName("Clear credentials")
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- "OS" is an acronym
        .setDesc("Remove saved credentials from Obsidian Keychain.")
        .addButton((btn) =>
          btn
            .setButtonText("Clear")
            .setWarning()
            .setDisabled(!hasStoredCredentials)
            .onClick(() => {
              this.plugin.app.secretStorage.setSecret(
                CUSTOM_CREDENTIALS_SECRET_ID,
                ""
              );
              new Notice("Credentials cleared.");
              this.display();
            })
        );

      // Filtering
      new Setting(containerEl).setName("Filtering").setHeading();

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

      new Setting(containerEl)
        .setName("Include shared notes")
        .setDesc(
          "Include notes that have been shared with you by others. When disabled, only notes you own will be synced."
        )
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.includeSharedNotes)
            .onChange(async (value) => {
              this.plugin.settings.includeSharedNotes = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Title filter")
        .setDesc(
          "Filter which notes are synced based on their title."
        )
        .addDropdown((dropdown) =>
          dropdown
            .addOption("disabled", "Disabled")
            .addOption("include", "Only sync notes where the title includes...")
            .addOption("exclude", "Never sync notes where the title includes...")
            .setValue(this.plugin.settings.titleFilterMode)
            .onChange(async (value) => {
              this.plugin.settings.titleFilterMode = value as
                | "disabled"
                | "include"
                | "exclude";
              await this.plugin.saveSettings();
              this.display();
            })
        );

      if (this.plugin.settings.titleFilterMode !== "disabled") {
        new Setting(containerEl)
          .setName("Title filter keyword")
          .setDesc(
            "Documents will be filtered based on whether their title contains this text (case-insensitive)."
          )
          .addText((text) =>
            text
              .setPlaceholder("Enter keyword...")
              .setValue(this.plugin.settings.titleFilterKeyword)
              .onChange(async (value) => {
                this.plugin.settings.titleFilterKeyword = value;
                await this.plugin.saveSettings();
              })
          );
      }

      // Debugging
      new Setting(containerEl).setName("Debugging").setHeading();

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

      new Setting(containerEl)
        .setName("Enable debug logging")
        .setDesc(
          "When enabled, writes detailed plugin logs to a granola-sync-debug.log file in the plugin folder. Disable when not needed."
        )
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.enableDebugLogging)
            .onChange(async (value) => {
              this.plugin.settings.enableDebugLogging = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Copy logs to clipboard")
        .setDesc(
          "Copy the current contents of the debug log file to your clipboard for debugging or bug reports."
        )
        .addButton((button) =>
          button
            .setButtonText("Copy logs to clipboard")
            .onClick(async () => {
              await this.plugin.copyDebugLogsToClipboard();
            })
        );
    }

    // Support Section
    new Setting(containerEl).setName("Support").setHeading();

    new Setting(containerEl)
      .setName("Need support?")
      .setDesc("File an issue on GitHub. Pull requests are even better.")
      .addButton((button) => {
        button.buttonEl.empty();
        button.buttonEl.addClass("granola-sync-support-icon");
        appendSvg(button.buttonEl, githubLogoSvg);
        button.onClick(() => {
          window.open("https://github.com/tomelliot/obsidian-granola-sync/");
        });
      });

    new Setting(containerEl)
      .setName("Show your support")
      .addButton((button) => {
      button.buttonEl.addClass("mod-cta");
      button.buttonEl.addClass("granola-sync-bmc-icon");
      button.buttonEl.empty();
      appendSvg(button.buttonEl, bmcButtonSvg);
      button.onClick(() => {
        window.open("https://buymeacoffee.com/tomelliot");
      });
    });

    // Restore scroll position captured at the start of this render.
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollTop;
    }
  }
}
