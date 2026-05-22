import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import fs from "fs";
import path from "path";
import { moment } from "./utils/moment";
import { getDailyNote, getAllDailyNotes } from "obsidian-daily-notes-interface";
import { getTitleOrDefault } from "./utils/filenameUtils";
import { getNoteDate, getEffectiveUpdatedAt } from "./utils/dateUtils";
import {
  GranolaSyncSettings,
  LegacySettings,
  DEFAULT_SETTINGS,
  GranolaSyncSettingTab,
  migrateSettingsToNewFormat,
} from "./settings";
import {
  fetchGranolaTranscript,
  GranolaDoc,
  TranscriptEntry,
} from "./services/granolaApi";
import {
  buildFolderMap,
  diffFolderMaps,
} from "./services/folderMapBuilder";
import { resolveAuth, AuthResult } from "./services/auth";
import { presentCredentialsError } from "./services/credentialsErrorPresenter";
import { setPluginDirectory } from "./services/granolaCredentialsCrypto";
import { KeychainPermissionModal } from "./ui/keychainPermissionModal";
import {
  fetchDocumentsForSync,
  FetchedDoc,
} from "./services/documentFetcher";
import { PublicApiError, listAllFolders } from "./services/publicGranolaApi";
import { DryRunRecorder } from "./services/dryRun";
import { DryRunReportModal } from "./services/dryRunModal";
import {
  buildApiFolderSnapshot,
  diffApiFolderSnapshots,
  mergeApiFolderSnapshots,
  folderListResponseToSnapshotFolders,
  shouldRefetchFolders,
} from "./services/apiFolderSnapshot";
import {
  formatTranscriptBySpeaker,
  formatTranscriptBody,
} from "./services/transcriptFormatter";
import { PathResolver } from "./services/pathResolver";
import { FileSyncService } from "./services/fileSyncService";
import { DocumentProcessor } from "./services/documentProcessor";
import { DailyNoteBuilder } from "./services/dailyNoteBuilder";
import { filterDocumentsByTitle } from "./utils/documentFilter";
import { configureLogger, log } from "./utils/logger";
import { formatStringListAsYaml } from "./utils/yamlUtils";
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
  /**
   * Active dry-run recorder for the current sync, if any. The orchestrator
   * helpers consult this to short-circuit `vault.modify` /
   * `processFrontMatter` / `saveData(settings)` calls that bypass the
   * `FileSyncService` interception. Set in {@link sync} and cleared in the
   * matching `finally`.
   */
  private dryRunRecorder: DryRunRecorder | null = null;
  statusBarItemEl: HTMLElement | null = null;
  statusBarTimeoutId: number | null = null;

  async onload() {
    await this.loadSettings();

    this.initializeLogger();

    // Tell the credentials crypto module where the plugin lives so it can
    // resolve its bundled native dependency by absolute path. Obsidian's
    // plugin require doesn't search the plugin's own node_modules.
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter && this.manifest.dir) {
      setPluginDirectory(path.join(adapter.getBasePath(), this.manifest.dir));
    }

    // Initialize services
    this.initializeServices();

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

    this.addCommand({
      id: "dry-run-granola",
      name: "Dry-run sync (no writes)",
      callback: async () => {
        await this.runDryRun();
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

  onunload() {
    // Clean up status bar (includes clearing timeout)
    hideStatusBar(this);
  }

  async loadSettings() {
    const loadedData = (await this.loadData()) as
      | (Partial<GranolaSyncSettings> & LegacySettings)
      | null;
    const mergedSettings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

    // Check if migration is needed
    if (mergedSettings.syncDestination) {
      // Migrate old settings to new format
      this.settings = migrateSettingsToNewFormat(mergedSettings);
      // Save migrated settings immediately
      await this.saveData(this.settings);
      log.info("Migrated settings from old format to new format");
    } else {
      // Already in new format
      this.settings = mergedSettings;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateServices();
    this.setupPeriodicSync();
  }

  /**
   * Initializes all services with current settings.
   * Called during plugin load and when settings change.
   */
  private initializeServices(): void {
    // Initialize PathResolver with current settings
    this.pathResolver = new PathResolver(this.settings);

    // Initialize FileSyncService with PathResolver
    // FileSyncService uses getter function for settings, so it will automatically
    // pick up the latest settings values
    this.fileSyncService = new FileSyncService(
      this.app,
      this.pathResolver,
      () => this.settings
    );

    // Initialize DocumentProcessor with current settings
    this.documentProcessor = new DocumentProcessor(
      {
        syncTranscripts: this.settings.syncTranscripts,
        includePrivateNotes: this.settings.includePrivateNotes,
      },
      this.pathResolver
    );

    // Initialize DailyNoteBuilder with DocumentProcessor
    this.dailyNoteBuilder = new DailyNoteBuilder(
      this.app,
      this.documentProcessor
    );
  }

  /**
   * Updates services when settings change during plugin runtime.
   * Recreates services that depend on settings to ensure they use the latest values.
   */
  private updateServices(): void {
    this.initializeServices();
  }

  setupPeriodicSync() {
    this.clearPeriodicSync(); // Clear any existing interval first
    if (this.settings.isSyncEnabled && this.settings.syncInterval > 0) {
      this.syncIntervalId = window.setInterval(() => {
        void this.sync();
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

  private debugLogFilePath: string | null = null;

  private getPluginDirPath(): string | null {
    const adapter = this.app.vault.adapter;

    if (adapter instanceof FileSystemAdapter) {
      const basePath = adapter.getBasePath();
      const configDir = this.app.vault.configDir;
      return path.join(basePath, configDir, "plugins", this.manifest.id);
    }

    return null;
  }

  private initializeLogger(): void {
    const pluginDir = this.getPluginDirPath();

    if (!pluginDir) {
      configureLogger(null);
      return;
    }

    // Generate a timestamped log filename once per session
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\.\d{3}Z$/, "");
    this.debugLogFilePath = path.join(
      pluginDir,
      "logs",
      `${timestamp}.log`
    );

    configureLogger({
      isDebugEnabled: () => this.settings.enableDebugLogging,
      appendLine: async (line: string) => {
        if (!this.debugLogFilePath) return;
        try {
          await fs.promises.mkdir(path.dirname(this.debugLogFilePath), {
            recursive: true,
          });
          await fs.promises.appendFile(this.debugLogFilePath, line, "utf-8");
        } catch {
          // Swallow all errors to avoid affecting plugin behavior
        }
      },
    });
  }

  async copyDebugLogsToClipboard(): Promise<void> {
    const debugLogPath = this.debugLogFilePath;

    if (!debugLogPath) {
      new Notice(
        "Copying debug logs is not available in this environment."
      );
      return;
    }

    try {
      const contents = await fs.promises.readFile(debugLogPath, "utf-8");

      if (!contents) {
        new Notice("Debug log file is empty.");
        return;
      }

      await navigator.clipboard.writeText(contents);
      new Notice("Debug logs copied to clipboard.");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        new Notice(
          "Debug log file not found. Enable debug logging and try again."
        );
      } else {
        new Notice(
          "Failed to copy debug logs: " +
            (error instanceof Error ? error.message : String(error))
        );
      }
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

  /**
   * Updates frontmatter on all vault notes affected by folder renames.
   * Scans all markdown files for folders entries matching old paths
   * and replaces them with new paths.
   */
  private async updateRenamedFolders(
    renamedPaths: Map<string, string>
  ): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    let updatedCount = 0;

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const folders = cache?.frontmatter?.folders as
        | string[]
        | undefined;
      if (!folders || !Array.isArray(folders)) continue;

      let changed = false;
      const updatedFolders = folders.map((folder) => {
        const newPath = renamedPaths.get(folder);
        if (newPath) {
          changed = true;
          return newPath;
        }
        return folder;
      });

      if (changed) {
        const content = await this.app.vault.read(file);
        const updatedContent = this.replaceFrontmatterFolders(
          content,
          updatedFolders
        );
        if (updatedContent !== content) {
          if (this.dryRunRecorder) {
            this.dryRunRecorder.record({
              outcome: "would-modify-frontmatter",
              path: file.path,
              reason: "folder rename",
            });
          } else {
            await this.app.vault.modify(file, updatedContent);
          }
          updatedCount++;
        }
      }
    }

    if (updatedCount > 0) {
      log.debug(
        `${this.dryRunRecorder ? "Dry-run: would update" : "Updated"} folders in ${updatedCount} file(s) due to folder renames`
      );
    }
  }

  /**
   * Replaces the folders list in YAML frontmatter with updated values.
   */
  private replaceFrontmatterFolders(
    content: string,
    newFolders: string[]
  ): string {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return content;

    const frontmatter = frontmatterMatch[1];

    const folderBlockRegex =
      /folders:\s*\n((?:\s+-\s+.*\n?)*)/;
    const match = frontmatter.match(folderBlockRegex);
    if (!match) return content;

    const newBlock =
      "folders:\n" +
      newFolders.map((f) => `  - "${f}"`).join("\n") +
      "\n";
    const updatedFrontmatter = frontmatter.replace(folderBlockRegex, newBlock);

    return content.replace(
      /^---\n[\s\S]*?\n---/,
      `---\n${updatedFrontmatter}\n---`
    );
  }

  /**
   * Backfills the `folders` frontmatter field on existing vault notes that have
   * a `granola_id` but are missing folder metadata. This ensures previously
   * synced documents get folder paths added when the feature is first enabled.
   */
  private async backfillFolderMetadata(
    docFolders: Record<string, string[]>
  ): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    let updatedCount = 0;
    let scannedCount = 0;
    let alreadyHasFoldersCount = 0;
    let noFolderDataCount = 0;
    let noFrontmatterCount = 0;

    log.debug(`backfillFolderMetadata — scanning ${files.length} markdown file(s), docFolders has ${Object.keys(docFolders).length} mapping(s)`);

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter?.granola_id) continue;

      scannedCount++;

      // Skip files that already have a folders field
      if (cache.frontmatter.folders !== undefined) {
        alreadyHasFoldersCount++;
        continue;
      }

      const granolaId = cache.frontmatter.granola_id as string;
      const folders = docFolders[granolaId];
      if (!folders || folders.length === 0) {
        noFolderDataCount++;
        log.debug(`backfill skip — no folder data for granolaId=${granolaId} (${file.path})`);
        continue;
      }

      const content = await this.app.vault.read(file);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        noFrontmatterCount++;
        log.debug(`backfill skip — no parseable frontmatter in ${file.path}`);
        continue;
      }

      const frontmatter = frontmatterMatch[1];
      const foldersYaml = `folders: ${formatStringListAsYaml(folders)}`;
      const updatedFrontmatter = frontmatter + "\n" + foldersYaml;
      const updatedContent = content.replace(
        /^---\n[\s\S]*?\n---/,
        `---\n${updatedFrontmatter}\n---`
      );

      if (updatedContent !== content) {
        if (this.dryRunRecorder) {
          this.dryRunRecorder.record({
            outcome: "would-modify-frontmatter",
            path: file.path,
            granolaId,
            reason: `backfill folders ${JSON.stringify(folders)}`,
          });
        } else {
          await this.app.vault.modify(file, updatedContent);
        }
        updatedCount++;
        log.debug(`backfill ${this.dryRunRecorder ? "would update" : "updated"} — ${file.path} (granolaId=${granolaId}, folders=${JSON.stringify(folders)})`);
      }
    }

    log.debug(`backfillFolderMetadata — scanned=${scannedCount} granola files, ${this.dryRunRecorder ? "would-update" : "updated"}=${updatedCount}, alreadyHasFolders=${alreadyHasFoldersCount}, noFolderData=${noFolderDataCount}, noFrontmatter=${noFrontmatterCount}`);
  }

  /**
   * Refreshes the API-mode folder snapshot and applies any detected renames.
   *
   * Runs in API-key mode regardless of whether this sync's window returned
   * any notes — folder renames need to be detected even on empty incremental
   * syncs. The work has three parts:
   *
   * 1. Merge this sync's per-note `folder_membership` into the persisted
   *    snapshot.
   * 2. Once per `FOLDERS_REFETCH_INTERVAL_MS` (or always on `mode: "full"`),
   *    call `listFolders()` for the full hierarchy and merge it in. Catches
   *    renames of folders whose notes didn't appear in this sync window.
   * 3. Diff the previous snapshot against the merged one and dispatch any
   *    renames to {@link updateRenamedFolders}.
   *
   * Failures of `listFolders` are soft — we log and continue so a transient
   * network blip doesn't block the rest of sync.
   */
  private async refreshApiFolderState(
    apiKey: string,
    fetched: FetchedDoc[],
    mode: "standard" | "full"
  ): Promise<void> {
    const partial = buildApiFolderSnapshot(
      fetched
        .filter((f) => f.folderMembership !== undefined)
        .map((f) => ({ granolaId: f.doc.id, membership: f.folderMembership }))
    );
    const previousSnapshot =
      this.settings._apiFolderSnapshot ?? { folders: {}, docFolders: {} };
    let mergedSnapshot = mergeApiFolderSnapshots(previousSnapshot, partial);

    const shouldFetchFullList =
      mode === "full" ||
      shouldRefetchFolders(Date.now(), this.settings._apiFoldersLastFetched);
    if (shouldFetchFullList) {
      try {
        const allFolders = await listAllFolders(apiKey);
        const fullFolders = folderListResponseToSnapshotFolders(allFolders);
        mergedSnapshot = mergeApiFolderSnapshots(mergedSnapshot, {
          folders: fullFolders,
          docFolders: {},
        });
        this.settings._apiFoldersLastFetched = Date.now();
        log.debug(
          `Periodic listFolders refresh — ${Object.keys(fullFolders).length} folder(s)`
        );
      } catch (e) {
        log.warn(
          "Periodic listFolders call failed; continuing without full-hierarchy refresh",
          e
        );
      }
    }

    const renamedPaths = diffApiFolderSnapshots(
      previousSnapshot,
      mergedSnapshot
    );
    if (renamedPaths.size > 0) {
      log.debug(
        `Detected ${renamedPaths.size} folder rename(s) (api_key mode)`
      );
      await this.updateRenamedFolders(renamedPaths);
    }
    this.settings._apiFolderSnapshot = mergedSnapshot;
    await this.persistSettingsDuringSync();
  }

  /**
   * Wrapper around `saveData(this.settings)` used by sync helpers. Skips the
   * write entirely in dry-run mode so the user's `data.json` is left
   * untouched. Live sync persists as before.
   *
   * This is intentionally a separate helper (rather than inlining the guard
   * everywhere) so future settings persistence inside the sync run can't
   * regress the dry-run contract — there's exactly one path.
   */
  private async persistSettingsDuringSync(): Promise<void> {
    if (this.dryRunRecorder) {
      log.debug(
        "Dry-run: skipping saveData(settings) — settings persistence is read-only during dry-run"
      );
      return;
    }
    await this.saveData(this.settings);
  }

  /**
   * Builds a `granolaId → updated_at` map from existing vault files. Used by
   * the API-key fetcher to skip Get Note calls for notes whose remote
   * `updated_at` hasn't moved since the last sync.
   *
   * Reads from `metadataCache.frontmatter` so this is O(n) over vault notes
   * with no I/O — it relies on the already-populated cache populated by
   * `fileSyncService.buildCache()`.
   */
  private buildKnownUpdatedAtMap(): Map<string, string | undefined> {
    const out = new Map<string, string | undefined>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const granolaId = cache?.frontmatter?.granola_id as string | undefined;
      if (!granolaId) continue;
      const updated = cache?.frontmatter?.updated as string | undefined;
      out.set(granolaId, updated);
    }
    return out;
  }

  /**
   * Surfaces a user-facing Notice for fetch failures. API-key 401s set the
   * settings flag so the settings tab can show a "key revoked" badge until
   * the next successful sync clears it.
   */
  /**
   * Note on dry-run: this helper deliberately does NOT route its
   * `saveData(...)` calls through {@link persistSettingsDuringSync}. The
   * `_lastApiAuthError` flag is diagnostic — a 401 detected during a
   * dry-run is real (the key really was rejected), and surfacing the badge
   * in settings UI helps the user fix it without needing to run a live sync
   * first. The only persistence side-effect here is that one boolean.
   */
  private async handleFetchError(
    error: unknown,
    auth: AuthResult
  ): Promise<void> {
    if (error instanceof PublicApiError) {
      if (error.status === 401) {
        new Notice(
          "Granola API key invalid or revoked — open settings to fix.",
          10000
        );
        this.settings._lastApiAuthError = true;
        await this.saveData(this.settings);
      } else if (error.status === 429) {
        new Notice(
          "Granola sync error: rate limited by the Granola API. Try again in a minute.",
          10000
        );
      } else if (error.status >= 500) {
        new Notice(
          "Granola sync error: Granola API server error. Please try again later.",
          10000
        );
      } else {
        new Notice(
          `Granola sync error: ${error.message}` +
            (error.requestId ? ` (request-id ${error.requestId})` : ""),
          10000
        );
      }
      log.error(
        `Public API error during fetch — status=${error.status}, requestId=${error.requestId ?? "<none>"}`,
        error
      );
      return;
    }
    const errorStatus = (error as { status?: number })?.status;
    if (errorStatus === 401) {
      new Notice(
        auth.method === "api_key"
          ? "Granola API key invalid or revoked — open settings to fix."
          : "Granola sync error: Authentication failed. Your access token may have expired. Please reload Granola to update your credentials file.",
        10000
      );
      if (auth.method === "api_key") {
        this.settings._lastApiAuthError = true;
        await this.saveData(this.settings);
      }
    } else if (errorStatus === 403) {
      new Notice("Granola sync error: Access forbidden.", 10000);
    } else if (errorStatus === 404) {
      new Notice("Granola sync error: API endpoint not found.", 10000);
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
  }

  // Top-level sync function that handles common setup once
  async sync(
    options: { mode?: "standard" | "full"; dryRun?: DryRunRecorder } = {}
  ) {
    const mode = options.mode ?? "standard";
    log.debug(`Sync started — mode=${mode}, daysBack=${this.settings.syncDaysBack}, dryRun=${options.dryRun ? "yes" : "no"}`);
    showStatusBar(
      this,
      options.dryRun ? "Granola dry-run: Syncing..." : "Granola sync: Syncing..."
    );
    // Wire dry-run interception into both the FileSyncService write paths
    // AND the orchestrator-level write paths (backfill, cross-links,
    // rename-application, settings persistence) for the duration of this
    // sync. The orchestrator helpers consult `this.dryRunRecorder` directly.
    //
    // In-memory settings snapshot: even though we skip writing settings to
    // disk during dry-run, individual code paths still mutate `this.settings`
    // in place (e.g. `this.settings.latestSyncTime = Date.now()`). Without
    // a snapshot, two back-to-back dry-runs in the same Obsidian session see
    // different state because the first run advanced the in-memory clock.
    // We snapshot before the run and restore after, with one documented
    // exception: `_lastApiAuthError = true` (a 401 surfaced by dry-run is
    // real and we want the settings UI badge to show until the user fixes
    // the key — that mutation is allowed through).
    this.dryRunRecorder = options.dryRun ?? null;
    this.fileSyncService.setDryRunRecorder(options.dryRun ?? null);
    this.dailyNoteBuilder.setDryRunRecorder(options.dryRun ?? null);
    const settingsSnapshot = options.dryRun
      ? this.snapshotSettings()
      : null;
    try {
      return await this._sync(mode, options.dryRun ?? null);
    } finally {
      if (settingsSnapshot) {
        const lastApiAuthError = this.settings._lastApiAuthError;
        this.restoreSettingsSnapshot(settingsSnapshot);
        // Preserve the 401 flag from this dry-run (documented exception)
        if (lastApiAuthError) {
          this.settings._lastApiAuthError = lastApiAuthError;
        }
      }
      this.dryRunRecorder = null;
      this.fileSyncService.setDryRunRecorder(null);
      this.dailyNoteBuilder.setDryRunRecorder(null);
    }
  }

  /**
   * Runs a dry-run sync and shows the report inline via {@link DryRunReportModal}.
   *
   * Single entry point for both the command palette command and the settings
   * "Dry-run sync" button — keeps the UX consistent and the recorder lifecycle
   * in one place.
   */
  async runDryRun(): Promise<void> {
    new Notice("Granola dry-run: Starting (no files will be modified).");
    const recorder = new DryRunRecorder();
    const startedAt = new Date();
    try {
      await this.sync({ dryRun: recorder });
    } catch (e) {
      // sync() catches and surfaces its own errors via Notice + log.error,
      // so we expect to be told via the recorder + Notice rather than via a
      // thrown error. If something escaped, surface it so the modal still
      // opens with the partial state captured up to the failure.
      log.error("Dry-run threw unexpectedly; opening modal with partial state.", e);
    }
    const finishedAt = new Date();
    log.info(recorder.summarize());
    new DryRunReportModal(this.app, recorder, startedAt, finishedAt).open();
  }

  /**
   * Captures the current settings state for restoration after a dry-run.
   *
   * Uses `structuredClone` to deep-copy nested fields like `_folderMapCache`
   * and `_apiFolderSnapshot` so in-place mutations inside the sync don't
   * surface in the snapshot. Falls back to a JSON round-trip for older
   * runtimes that lack `structuredClone` (none of Obsidian's supported
   * platforms, but safer to guard).
   */
  private snapshotSettings(): GranolaSyncSettings {
    if (typeof structuredClone === "function") {
      return structuredClone(this.settings);
    }
    return JSON.parse(JSON.stringify(this.settings)) as GranolaSyncSettings;
  }

  /**
   * Restores settings to the snapshot taken at the start of a dry-run.
   *
   * Mutates `this.settings` in place (not reassign) so the closure-captured
   * `getSettings` reference in {@link FileSyncService} keeps pointing at
   * the same object. Replacing keys, not the object identity.
   */
  private restoreSettingsSnapshot(snapshot: GranolaSyncSettings): void {
    // Delete keys that were added during the dry-run but aren't in the
    // snapshot, then re-apply snapshot values. This handles the case where
    // a sync added a new field (e.g. `_apiFoldersLastFetched` on first ever
    // API sync).
    for (const k of Object.keys(this.settings) as Array<keyof GranolaSyncSettings>) {
      if (!(k in snapshot)) {
        delete this.settings[k];
      }
    }
    Object.assign(this.settings, snapshot);
  }

  private async _sync(
    mode: "standard" | "full",
    dryRun: DryRunRecorder | null
  ): Promise<void> {

    // Resolve auth (desktop credentials or API key) at the start of each sync.
    // The desktop path returns the full `credentialsResult` so we can route
    // keychain-denied / decrypt-error states through the dedicated modal that
    // ships with the desktop credential decryption work (PR #130).
    const { auth, error, credentialsResult } = await resolveAuth(this.settings);
    if (!auth || error) {
      log.error("Error resolving Granola auth:", error);
      if (credentialsResult) {
        // Desktop path failure — `presentCredentialsError` routes
        // `errorKind === "keychain"` to the modal and everything else to a
        // Notice. Keeps the UX consistent with the desktop-only sync flow.
        presentCredentialsError(
          {
            ...credentialsResult,
            error: credentialsResult.error ?? "No access token loaded.",
          },
          {
            onKeychainDenied: () =>
              new KeychainPermissionModal(this.app).open(),
            onOtherError: (message) =>
              new Notice(`Granola sync error: ${message}`, 10000),
          }
        );
      } else {
        // API key path failure (no credentials file involved) — simple Notice.
        new Notice(
          `Granola sync error: ${error || "No credentials available."}`,
          10000
        );
      }
      hideStatusBar(this);
      return;
    }

    // Build the Granola ID cache before syncing
    await this.fileSyncService.buildCache();

    // Build the list-level updated_at gate for API-key mode. This lets the
    // fetcher skip Get Note calls for notes whose remote timestamp hasn't
    // moved since the last sync — the dominant cost saver on large vaults.
    let knownUpdatedAtByGranolaId: Map<string, string | undefined> | undefined;
    if (auth.method === "api_key") {
      knownUpdatedAtByGranolaId = this.buildKnownUpdatedAtMap();
    }

    // Fetch documents via the appropriate API for this auth method
    let fetched: FetchedDoc[];
    try {
      fetched = await fetchDocumentsForSync(auth, this.settings, {
        mode,
        includeTranscripts: this.settings.syncTranscripts,
        knownUpdatedAtByGranolaId,
        latestSyncTime: this.settings.latestSyncTime,
      });
    } catch (error: unknown) {
      await this.handleFetchError(error, auth);
      hideStatusBar(this);
      return;
    }

    // Clear any "last sync was 401" flag — we got past the fetch.
    if (this.settings._lastApiAuthError) {
      this.settings._lastApiAuthError = false;
      await this.persistSettingsDuringSync();
    }

    // For API-key mode we already have folder data inline on each FetchedDoc
    // and pre-fetched transcripts. The desktop path still uses the legacy
    // accessToken for the folder-map builder and transcript endpoint.
    const accessToken = auth.method === "desktop" ? auth.token : "";
    let documents: GranolaDoc[] = fetched.map((f) => f.doc);
    const apiFoldersByDocId = new Map<string, string[]>();
    const apiTranscriptsByDocId = new Map<string, TranscriptEntry[]>();
    const publicIdByDocId = new Map<string, string>();
    for (const f of fetched) {
      if (f.folders) apiFoldersByDocId.set(f.doc.id, f.folders);
      if (f.apiTranscript) apiTranscriptsByDocId.set(f.doc.id, f.apiTranscript);
      if (f.publicId) publicIdByDocId.set(f.doc.id, f.publicId);
    }

    // Record ID bridge alias entries so updateExistingFile and isRemoteNewer
    // can resolve by either the legacy UUID or the public `not_*` id.
    for (const [docId, publicId] of publicIdByDocId) {
      this.fileSyncService.recordPublicIdBridge(publicId, docId, "note");
      this.fileSyncService.recordPublicIdBridge(publicId, docId, "transcript");
      this.fileSyncService.recordPublicIdBridge(publicId, docId, "combined");
    }

    // Apply title filter
    documents = filterDocumentsByTitle(
      documents,
      this.settings.titleFilterMode,
      this.settings.titleFilterKeyword
    );

    // API-mode folder housekeeping runs BEFORE the empty-docs early-return.
    // An incremental sync window may return zero notes while a folder rename
    // still needs to be detected via the periodic listFolders() refresh.
    if (auth.method === "api_key") {
      await this.refreshApiFolderState(auth.token, fetched, mode);
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

    // Build folder map (document → folder paths)
    let docFolders: Record<string, string[]> = {};
    if (auth.method === "desktop") {
      try {
        showStatusBar(this, "Granola sync: Fetching folders...");
        const freshFolderMap = await buildFolderMap(accessToken);
        const previousFolderMap = this.settings._folderMapCache ?? null;

        // Detect folder renames and update affected notes
        const diff = diffFolderMaps(previousFolderMap, freshFolderMap);
        if (diff.renamedPaths.size > 0) {
          log.debug(`Detected ${diff.renamedPaths.size} folder rename(s)`);
          await this.updateRenamedFolders(diff.renamedPaths);
        }

        // Persist the fresh folder map
        this.settings._folderMapCache = freshFolderMap;
        await this.persistSettingsDuringSync();

        docFolders = freshFolderMap.docFolders;
        log.debug(`Folder map built — ${Object.keys(freshFolderMap.folders).length} folder(s), ${Object.keys(docFolders).length} document(s) with folder data`);

        // Backfill folders on existing notes that don't have the field yet
        await this.backfillFolderMetadata(docFolders);
      } catch (error) {
        log.error("Failed to build folder map, continuing sync without folder data:", error);
        // Use previously cached data if available
        if (this.settings._folderMapCache) {
          docFolders = this.settings._folderMapCache.docFolders;
          log.debug("Using cached folder map from previous sync");
        }
      }
    } else {
      // API-key mode: folder snapshot / rename detection already ran via
      // refreshApiFolderState() above the empty-docs early-return. Here we
      // only need to thread the per-doc folder paths through to backfill.
      docFolders = Object.fromEntries(apiFoldersByDocId.entries());
      await this.backfillFolderMetadata(docFolders);
    }

    const forceOverwrite = mode === "full";
    let transcriptDataMap: Map<string, TranscriptEntry[]> | null = null;
    if (this.settings.syncTranscripts) {
      const transcriptResult = await this.syncTranscripts(
        documents,
        auth,
        forceOverwrite,
        apiTranscriptsByDocId
      );
      transcriptDataMap = transcriptResult.transcriptDataMap;
    }
    if (this.settings.syncNotes) {
      // API-key mode body-write policy:
      // - `refresh-transcripts-only` (default): preserve note bodies on
      //   EXISTING files (don't overwrite the desktop-rendered ProseMirror
      //   body the user already has), but still CREATE missing notes. This
      //   resolves "orphan" cases where desktop sync wrote a transcript
      //   before Granola finished the AI summary and the matching note
      //   never landed.
      // - `force-refresh-all`: write everything (one-shot, auto-reverts).
      // - `normal`: write when remote is newer (desktop-equivalent behavior).
      // - Desktop auth: pass through with `skipExistingBodies = false`.
      //
      // Daily-notes mode in `refresh-transcripts-only` is not yet covered by
      // per-doc orphan-fix; see `syncNotesToDailyNotes` for why.
      const apiBodyMode =
        auth.method === "api_key" ? this.settings.apiSyncBodyMode : "normal";
      const skipExistingBodies = apiBodyMode === "refresh-transcripts-only";
      await this.syncNotes(
        documents,
        forceOverwrite || apiBodyMode === "force-refresh-all",
        transcriptDataMap,
        docFolders,
        { skipExistingBodies }
      );
      // force-refresh-all is a one-shot: auto-revert so users don't permanently
      // run in body-rewriting mode after a single corrective sync.
      if (apiBodyMode === "force-refresh-all") {
        log.debug(
          "Auto-reverting apiSyncBodyMode from force-refresh-all to refresh-transcripts-only after a completed sync"
        );
        this.settings.apiSyncBodyMode = "refresh-transcripts-only";
        await this.persistSettingsDuringSync();
      }
    }

    // Update frontmatter cross-links between notes and transcripts using
    // actual on-disk paths (after collision resolution).
    await this.updateCrossLinks(documents);

    // Show success message
    showStatusBarTemporary(this, "Granola sync: Complete");
  }

  private async syncNotes(
    documents: GranolaDoc[],
    forceOverwrite: boolean = false,
    transcriptDataMap: Map<string, TranscriptEntry[]> | null = null,
    docFolders: Record<string, string[]> = {},
    options: { skipExistingBodies?: boolean } = {}
  ): Promise<void> {
    let syncedCount: number;
    const skipExistingBodies = options.skipExistingBodies ?? false;
    log.debug(`syncNotes — mode=${this.settings.saveAsIndividualFiles ? "individual" : "daily-notes"}, docs=${documents.length}, skipExistingBodies=${skipExistingBodies}`);

    if (!this.settings.saveAsIndividualFiles) {
      syncedCount = await this.syncNotesToDailyNotes(
        documents,
        forceOverwrite,
        transcriptDataMap,
        docFolders,
        { skipExistingBodies }
      );
    } else {
      const result = await this.syncNotesToIndividualFiles(
        documents,
        forceOverwrite,
        transcriptDataMap,
        docFolders,
        { skipExistingBodies }
      );
      syncedCount = result.syncedCount;

      // Add links to daily notes if enabled.
      // Sync order: buildCache() runs before sync; each save updates the cache. So when we merge
      // existing links here, every link we wrote in a prior sync either resolves (note still in
      // vault) or is dropped (note deleted).
      if (this.settings.linkFromDailyNotes && result.syncedNotes.length > 0) {
        const linkHeading =
          this.settings.dailyNoteLinkHeading ||
          DEFAULT_SETTINGS.dailyNoteLinkHeading!;
        await this.dailyNoteBuilder.addLinksToDailyNotes(
          result.syncedNotes,
          linkHeading,
          forceOverwrite,
          (path) => this.fileSyncService.getGranolaIdByPath(path)
        );
      }
    }

    this.settings.latestSyncTime = Date.now();
    // Persist directly: saveSettings() rebuilds services and would clear the
    // FileSyncService cache mid-sync, breaking updateCrossLinks().
    await this.persistSettingsDuringSync();

    log.debug(`Saved ${syncedCount} note(s)`);
  }

  private async syncNotesToDailyNotes(
    documents: GranolaDoc[],
    forceOverwrite: boolean = false,
    transcriptDataMap: Map<string, TranscriptEntry[]> | null = null,
    docFolders: Record<string, string[]> = {},
    options: { skipExistingBodies?: boolean } = {}
  ): Promise<number> {
    // Daily-notes mode + skipExistingBodies (API-key refresh-transcripts-only):
    // sections live INSIDE daily-note files and the existing updater replaces
    // the entire heading-to-next-heading block as a unit. Implementing a
    // per-doc "only fill missing sections, never overwrite existing ones"
    // requires refactoring `updateDailyNoteSection` to splice sections rather
    // than rewrite. Until that's done, the safe fallback is to skip the whole
    // method — preserving existing daily notes. The cost: orphan notes in
    // daily-notes mode won't auto-resolve on API sync until this lands. Track
    // as a follow-up; out of scope for the orphan-fix in PR-current.
    if (options.skipExistingBodies) {
      log.warn(
        "syncNotesToDailyNotes — skipExistingBodies requested but per-doc " +
          "orphan-fix is not yet implemented for daily-notes mode. Skipping all " +
          "note writes for this sync. (Transcripts and folder housekeeping still ran.)"
      );
      if (this.dryRunRecorder) {
        for (const doc of documents) {
          this.dryRunRecorder.record({
            outcome: "skip-body-write-disabled",
            path: this.pathResolver.computeNotePath(doc),
            granolaId: doc.id,
            type: "note",
            reason:
              "apiSyncBodyMode=refresh-transcripts-only (daily-notes mode — per-doc orphan-fix not yet supported)",
          });
        }
      }
      return 0;
    }
    const dailyNotesMap = this.dailyNoteBuilder.buildDailyNotesMap(documents, docFolders);
    const sectionHeadingSetting = (
      this.settings.dailyNoteSectionHeading ||
      DEFAULT_SETTINGS.dailyNoteSectionHeading!
    ).trim();
    const isCombinedMode =
      this.settings.syncTranscripts &&
      this.settings.transcriptHandling === "combined";
    let processedCount = 0;
    let syncedCount = 0;

    for (const [dateKey, notesWithDocs] of dailyNotesMap) {
      const dailyNoteFile = await this.dailyNoteBuilder.getOrCreateDailyNote(
        dateKey
      );
      if (!dailyNoteFile) {
        // Dry-run + daily note does not exist on disk yet.
        // `getOrCreateDailyNote` already recorded a would-create event;
        // we record the intended write and skip the section-update step
        // (there's no file to read or modify).
        if (this.dryRunRecorder) {
          this.dryRunRecorder.record({
            outcome: "would-modify",
            path: `(daily note for ${dateKey})`,
            reason: `would write ${notesWithDocs.length} note section(s) into new daily note`,
          });
        }
        processedCount += notesWithDocs.length;
        this.updateSyncStatus("Note", processedCount, documents.length);
        continue;
      }

      // Extract just the note data for comparison
      const notesForDay = notesWithDocs.map((item) => item.noteData);

      // Check if all notes for this date are already up-to-date (unless forceOverwrite is true)
      if (!forceOverwrite) {
        const fileContent = await this.app.vault.read(dailyNoteFile);
        const existingNotes = this.dailyNoteBuilder.extractExistingNotes(
          fileContent,
          sectionHeadingSetting
        );

        // Check if all notes are present and up-to-date
        const allNotesUpToDate = notesForDay.every((note) => {
          const existingUpdatedAt = existingNotes.get(note.docId);
          // Note is up-to-date if it exists and has the same or newer updated_at timestamp
          return existingUpdatedAt !== undefined && existingUpdatedAt === note.updatedAt;
        });

        if (allNotesUpToDate && existingNotes.size === notesForDay.length) {
          log.debug(`Daily notes for ${dateKey} — all ${notesForDay.length} note(s) up-to-date, skipping`);
          processedCount += notesForDay.length;
          this.updateSyncStatus("Note", processedCount, documents.length);
          continue;
        }
      }

      // Process image attachments and transcripts for each note
      const notesWithImages = await Promise.all(
        notesWithDocs.map(async ({ noteData, doc }) => {
          // Append image embeds to the note's markdown
          let markdownWithImages =
            await this.fileSyncService.appendImageEmbedsForAttachments(
              doc,
              noteData.markdown,
              dailyNoteFile.path
            );

          // If combined mode and transcript available, append transcript content
          if (isCombinedMode && transcriptDataMap) {
            const transcriptData = transcriptDataMap.get(doc.id || "");
            if (transcriptData && transcriptData.length > 0) {
              const transcriptBody = formatTranscriptBody(transcriptData);
              markdownWithImages += "\n\n### Transcript\n\n" + transcriptBody;
              // Set transcript link to heading within the same section
              return {
                ...noteData,
                markdown: markdownWithImages,
                transcript: "[[#Transcript]]",
              };
            }
          }

          return {
            ...noteData,
            markdown: markdownWithImages,
          };
        })
      );

      const sectionContent = this.dailyNoteBuilder.buildDailyNoteSectionContent(
        notesWithImages,
        sectionHeadingSetting
      );

      await this.dailyNoteBuilder.updateDailyNoteSection(
        dailyNoteFile,
        sectionHeadingSetting,
        sectionContent,
        forceOverwrite
      );
      processedCount += notesForDay.length;
      this.updateSyncStatus("Note", processedCount, documents.length);

      syncedCount += notesForDay.length;
    }

    return syncedCount;
  }

  private async syncNotesToIndividualFiles(
    documents: GranolaDoc[],
    forceOverwrite: boolean = false,
    transcriptDataMap: Map<string, TranscriptEntry[]> | null = null,
    docFolders: Record<string, string[]> = {},
    options: { skipExistingBodies?: boolean } = {}
  ): Promise<{
    syncedCount: number;
    syncedNotes: Array<{ doc: GranolaDoc; notePath: string }>;
  }> {
    let processedCount = 0;
    let syncedCount = 0;
    const syncedNotes: Array<{
      doc: GranolaDoc;
      notePath: string;
    }> = [];
    const isCombinedMode =
      this.settings.syncTranscripts &&
      this.settings.transcriptHandling === "combined";
    const skipExistingBodies = options.skipExistingBodies ?? false;

    for (const doc of documents) {
      const notePath = this.pathResolver.computeNotePath(doc);
      const fileType: "note" | "combined" = isCombinedMode ? "combined" : "note";
      const existingNote = this.fileSyncService.findByGranolaId(doc.id, fileType);

      // refresh-transcripts-only: preserve the body on EXISTING files but
      // still create missing ones. Resolves orphans without clobbering the
      // user's desktop-rendered ProseMirror body when present. Subsequent
      // syncs see the created note as "existing" and preserve it from then
      // on (user-edit safety).
      if (skipExistingBodies && existingNote) {
        log.debug(
          `Skipping body write for ${doc.id} — file exists at ${existingNote.path} (skipExistingBodies)`
        );
        if (this.dryRunRecorder) {
          this.dryRunRecorder.record({
            outcome: "skip-body-write-disabled",
            path: existingNote.path,
            granolaId: doc.id,
            type: fileType,
            reason: "apiSyncBodyMode=refresh-transcripts-only",
          });
        }
        continue;
      }

      // Skip processing if note already exists locally and is up-to-date (unless forceOverwrite is true)
      if (!forceOverwrite) {
        if (existingNote) {
          // Check if remote is newer than local
          if (
            !this.fileSyncService.isRemoteNewer(
              doc.id,
              getEffectiveUpdatedAt(doc),
              fileType
            )
          ) {
            log.debug(`Skipping doc ${doc.id} — local copy is up-to-date`);
            continue;
          }
        }
      }

      processedCount++;
      this.updateSyncStatus("Note", processedCount, documents.length);

      const folders = docFolders[doc.id];
      log.debug(`Syncing doc ${doc.id} — folders=${folders ? JSON.stringify(folders) : "none"}`);

      // Handle combined mode: save note and transcript together
      if (isCombinedMode && transcriptDataMap) {
        const transcriptData = transcriptDataMap.get(doc.id || "");
        if (transcriptData && transcriptData.length > 0) {
          const transcriptBody = formatTranscriptBody(transcriptData);
          const result = await this.fileSyncService.saveCombinedNoteToDisk(
            doc,
            this.documentProcessor,
            transcriptBody,
            forceOverwrite,
            folders
          );
          if (result.saved) {
            syncedCount++;
            // Use the actual on-disk path to handle collision-resolved filenames
            // (recurring meetings share a title, so later saves get a date suffix).
            syncedNotes.push({ doc, notePath: result.path ?? notePath });
          }
        } else {
          // No transcript available, save as regular note
          const result = await this.fileSyncService.saveNoteToDisk(
            doc,
            this.documentProcessor,
            forceOverwrite,
            undefined,
            folders
          );
          if (result.saved) {
            syncedCount++;
            syncedNotes.push({ doc, notePath: result.path ?? notePath });
          }
        }
      } else {
        // Save note without cross-links; frontmatter linking is done
        // in updateCrossLinks() after both notes and transcripts are saved.
        const result = await this.fileSyncService.saveNoteToDisk(
          doc,
          this.documentProcessor,
          forceOverwrite,
          undefined,
          folders
        );
        if (result.saved) {
          syncedCount++;
          syncedNotes.push({ doc, notePath: result.path ?? notePath });
        }
      }
    }

    log.debug(
      `syncNotesToIndividualFiles - Completed: ${syncedCount} saved out of ${processedCount} processed`
    );
    return { syncedCount, syncedNotes };
  }

  /**
   * After both notes and transcripts are saved, update frontmatter cross-links
   * using the actual on-disk paths (which may differ from computed paths due to
   * collision resolution with date suffixes).
   */
  private async updateCrossLinks(documents: GranolaDoc[]): Promise<void> {
    // Cross-links only apply when both notes and transcripts are synced, and
    // transcripts are saved as separate files (not combined mode).
    if (
      !this.settings.syncNotes ||
      !this.settings.syncTranscripts ||
      this.settings.transcriptHandling === "combined"
    ) {
      return;
    }

    let updatedCount = 0;
    for (const doc of documents) {
      try {
        const transcriptFile = this.fileSyncService.findByGranolaId(doc.id, "transcript");
        if (!transcriptFile) continue;

        // Resolve the note path for transcript→note linking
        let noteLinkPath: string | null = null;
        if (this.settings.saveAsIndividualFiles) {
          // Individual files: use actual on-disk path from cache
          const noteFile = this.fileSyncService.findByGranolaId(doc.id, "note");
          if (noteFile) {
            noteLinkPath = noteFile.path;
            if (this.dryRunRecorder) {
              this.dryRunRecorder.record({
                outcome: "would-modify-frontmatter",
                path: noteFile.path,
                granolaId: doc.id,
                reason: `cross-link transcript=[[${transcriptFile.path}]]`,
              });
            } else {
              await this.app.fileManager.processFrontMatter(
                noteFile,
                (fm: Record<string, unknown>) => {
                  fm.transcript = `[[${transcriptFile.path}]]`;
                }
              );
            }
          }
        } else {
          // Daily notes mode: link to the daily note heading
          const noteDate = getNoteDate(doc);
          const noteMoment = moment(noteDate);
          const dailyNoteFile = getDailyNote(noteMoment, getAllDailyNotes());
          if (dailyNoteFile) {
            const title = getTitleOrDefault(doc);
            noteLinkPath = `${dailyNoteFile.basename}#${title}`;
          }
        }

        if (noteLinkPath) {
          if (this.dryRunRecorder) {
            this.dryRunRecorder.record({
              outcome: "would-modify-frontmatter",
              path: transcriptFile.path,
              granolaId: doc.id,
              reason: `cross-link note=[[${noteLinkPath}]]`,
            });
          } else {
            await this.app.fileManager.processFrontMatter(
              transcriptFile,
              (fm: Record<string, unknown>) => {
                fm.note = `[[${noteLinkPath}]]`;
              }
            );
          }
          // Only count a "pair" when we actually had both sides to link. If
          // the matching note file didn't exist locally (`noteLinkPath` was
          // never set), there's nothing to record — and bumping the counter
          // would produce a misleading "Updated cross-links in N pair(s)"
          // log line.
          updatedCount++;
        }
      } catch (e) {
        log.error(`updateCrossLinks: failed for doc ${doc.id}:`, e);
      }
    }

    if (updatedCount > 0) {
      log.debug(
        `${this.dryRunRecorder ? "Dry-run: would update" : "Updated"} cross-links in ${updatedCount} note/transcript pair(s)`
      );
    }
  }

  private async syncTranscripts(
    documents: GranolaDoc[],
    auth: AuthResult,
    forceOverwrite: boolean = false,
    apiTranscriptsByDocId?: Map<string, TranscriptEntry[]>
  ): Promise<{ transcriptDataMap: Map<string, TranscriptEntry[]> }> {
    const transcriptDataMap = new Map<string, TranscriptEntry[]>();
    const isCombinedMode = this.settings.transcriptHandling === "combined";

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
                getEffectiveUpdatedAt(doc),
                isCombinedMode ? "combined" : "transcript"
              )
            ) {
              log.debug(`Skipping transcript for doc ${docId} — local copy is up-to-date`);
              continue;
            }
          }
        }

        // In API-key mode, the transcript was already fetched inline with the
        // note. The desktop path still hits /v1/get-document-transcript.
        const transcriptData: TranscriptEntry[] =
          apiTranscriptsByDocId?.get(docId) ??
          (auth.method === "desktop"
            ? await fetchGranolaTranscript(auth.token, docId)
            : []);
        if (transcriptData.length === 0) {
          log.debug(`Skipping transcript for doc ${docId} — API returned empty transcript`);
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

        // Save transcript without cross-links; frontmatter linking is done
        // in updateCrossLinks() after both notes and transcripts are saved,
        // so the paths reflect any collision-resolved filenames.
        const transcriptMd = formatTranscriptBySpeaker(
          transcriptData,
          title,
          docId,
          doc.created_at,
          getEffectiveUpdatedAt(doc),
          doc.people?.attendees
            ?.map((attendee) => attendee.name || attendee.email || "Unknown")
            .filter((name) => name !== "Unknown"),
          undefined
        );
        processedCount++;
        this.updateSyncStatus("Transcript", processedCount, documents.length);
        const transcriptResult = await this.fileSyncService.saveTranscriptToDisk(
          doc,
          transcriptMd,
          this.documentProcessor,
          forceOverwrite
        );
        if (transcriptResult.saved) {
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
    return { transcriptDataMap };
  }
}

