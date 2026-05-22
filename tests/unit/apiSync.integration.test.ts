/**
 * Integration-shaped tests for API-key mode sync.
 *
 * Scope: exercises the real `GranolaSync.sync()` orchestration to verify the
 * periodic `listFolders()` refresh wires up correctly. Mocks the document
 * fetcher (so we can hand-feed canned FetchedDoc[] without hitting the
 * network) and the public API client (to assert listFolders call counts and
 * propagate folder renames). The folder-snapshot module is real — these
 * tests would catch wiring mistakes between sync, the fetcher, and the
 * snapshot/diff code.
 *
 * If you're looking for the pure algorithm tests, see
 * `apiFolderSnapshot.test.ts`.
 */

import GranolaSync from "../../src/main";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { FileSyncService } from "../../src/services/fileSyncService";
import { DocumentProcessor } from "../../src/services/documentProcessor";
import { DailyNoteBuilder } from "../../src/services/dailyNoteBuilder";
import { PathResolver } from "../../src/services/pathResolver";
import { fetchDocumentsForSync } from "../../src/services/documentFetcher";
import { listAllFolders } from "../../src/services/publicGranolaApi";
import { DryRunRecorder } from "../../src/services/dryRun";
import { FOLDERS_REFETCH_INTERVAL_MS } from "../../src/services/apiFolderSnapshot";
import { showStatusBar, hideStatusBar, showStatusBarTemporary } from "../../src/utils/statusBar";
import { Notice, App, TFile } from "obsidian";

jest.mock("../../src/services/fileSyncService");
jest.mock("../../src/services/documentProcessor");
jest.mock("../../src/services/dailyNoteBuilder");
jest.mock("../../src/services/pathResolver");
jest.mock("../../src/services/documentFetcher", () => ({
  fetchDocumentsForSync: jest.fn(),
}));
jest.mock("../../src/services/publicGranolaApi", () => ({
  listAllFolders: jest.fn(),
  PublicApiError: class PublicApiError extends Error {
    constructor(message: string, public status: number, public requestId?: string) {
      super(message);
      this.name = "PublicApiError";
    }
  },
}));
jest.mock("../../src/services/credentials", () => ({
  loadCredentials: jest.fn(),
  encryptedCredentialsIsNewerThanPlaintext: jest.fn().mockResolvedValue(false),
}));
jest.mock("../../src/utils/statusBar");

jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  configureLogger: jest.fn(),
}));

const mockFetchDocumentsForSync = fetchDocumentsForSync as jest.MockedFunction<
  typeof fetchDocumentsForSync
>;
const mockListAllFolders = listAllFolders as jest.MockedFunction<
  typeof listAllFolders
>;

function makeFetchedDoc(opts: {
  granolaId: string;
  publicId: string;
  membership?: Array<{ id: string; name: string; parent?: string | null }>;
}) {
  const membership = opts.membership?.map((m) => ({
    id: m.id,
    name: m.name,
    parent_folder_id: m.parent ?? null,
  }));
  // Mirror what the real fetcher does — derive slashed folder paths from
  // membership via the adapter. Tests that pass membership expect folders to
  // be populated too.
  const byId = new Map(membership?.map((m) => [m.id, m]) ?? []);
  const folders = membership
    ? Array.from(
        new Set(
          membership.map((entry) => {
            const parts: string[] = [];
            let cursor: typeof entry | undefined = entry;
            const seen = new Set<string>();
            while (cursor && !seen.has(cursor.id)) {
              seen.add(cursor.id);
              parts.unshift(cursor.name);
              if (!cursor.parent_folder_id) break;
              cursor = byId.get(cursor.parent_folder_id);
            }
            return parts.join("/");
          })
        )
      ).sort()
    : [];
  return {
    doc: {
      id: opts.granolaId,
      title: "Test",
      created_at: "2026-05-21T15:00:00.000Z",
      updated_at: "2026-05-21T15:42:13.000Z",
    },
    folders,
    folderMembership: membership,
    apiTranscript: undefined,
    publicId: opts.publicId,
    webUrl: null,
  };
}

describe("API-key sync — listFolders periodic refresh integration", () => {
  let plugin: GranolaSync;
  let mockApp: jest.Mocked<App>;
  let mockFileSyncService: jest.Mocked<FileSyncService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        read: jest.fn(),
        modify: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
      workspace: { iterateAllLeaves: jest.fn() },
      fileManager: { processFrontMatter: jest.fn() },
    } as any;

    mockFileSyncService = {
      buildCache: jest.fn().mockResolvedValue(undefined),
      findByGranolaId: jest.fn().mockReturnValue(null),
      isRemoteNewer: jest.fn().mockReturnValue(true),
      saveNoteToDisk: jest.fn().mockResolvedValue({ saved: false, path: null }),
      saveTranscriptToDisk: jest
        .fn()
        .mockResolvedValue({ saved: false, path: null }),
      saveCombinedNoteToDisk: jest
        .fn()
        .mockResolvedValue({ saved: false, path: null }),
      setDryRunRecorder: jest.fn(),
      recordPublicIdBridge: jest.fn(),
    } as any;

    (FileSyncService as any).mockImplementation(() => mockFileSyncService);
    (DocumentProcessor as any).mockImplementation(() => ({} as any));
    (DailyNoteBuilder as any).mockImplementation(
      () => ({ setDryRunRecorder: jest.fn() } as any)
    );
    (PathResolver as any).mockImplementation(() => ({
      computeNotePath: jest.fn().mockReturnValue("Notes/Test.md"),
    } as any));

    plugin = new GranolaSync(mockApp, { id: "test", name: "test" } as any);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      authMethod: "api_key",
      apiKey: "grn_test",
      // Default test posture: notes off so we don't have to mock all the
      // downstream pipeline. Tests that need notes write enable it explicitly.
      syncNotes: false,
      syncTranscripts: false,
    };
    plugin.registerInterval = jest.fn();
    plugin.saveData = jest.fn().mockResolvedValue(undefined);
    (plugin as any).initializeServices();

    (Notice as jest.Mock).mockImplementation(() => ({}));
    (showStatusBar as jest.Mock).mockImplementation(() => {});
    (hideStatusBar as jest.Mock).mockImplementation(() => {});
    (showStatusBarTemporary as jest.Mock).mockImplementation(() => {});

    // Default: no docs returned, no folders. Each test overrides as needed.
    mockFetchDocumentsForSync.mockResolvedValue([]);
    mockListAllFolders.mockResolvedValue([]);
  });

  it("calls listFolders on the very first api_key sync (no _apiFoldersLastFetched)", async () => {
    await plugin.sync();
    expect(mockListAllFolders).toHaveBeenCalledTimes(1);
    expect(mockListAllFolders).toHaveBeenCalledWith("grn_test");
  });

  it("does NOT call listFolders when the timer is fresh (<24h)", async () => {
    plugin.settings._apiFoldersLastFetched = Date.now() - 60 * 60 * 1000; // 1h ago
    await plugin.sync();
    expect(mockListAllFolders).not.toHaveBeenCalled();
  });

  it("calls listFolders when the timer is stale (>24h)", async () => {
    plugin.settings._apiFoldersLastFetched =
      Date.now() - (FOLDERS_REFETCH_INTERVAL_MS + 5 * 60 * 1000);
    await plugin.sync();
    expect(mockListAllFolders).toHaveBeenCalledTimes(1);
  });

  it("calls listFolders on full sync regardless of timer freshness", async () => {
    plugin.settings._apiFoldersLastFetched = Date.now() - 60 * 1000; // 60s ago — fresh
    await plugin.sync({ mode: "full" });
    expect(mockListAllFolders).toHaveBeenCalledTimes(1);
  });

  it("does NOT call listFolders in desktop mode", async () => {
    plugin.settings.authMethod = "desktop";
    const { loadCredentials } = await import("../../src/services/credentials");
    (loadCredentials as jest.Mock).mockResolvedValue({
      accessToken: "desktop-token",
      error: null,
    });
    // Desktop folder map builder lives in a separate module — we don't mock
    // it here. Since we have zero docs, the desktop folder-map branch will
    // run but no notes are affected. We only care that listFolders (public
    // API) is never called.
    await plugin.sync();
    expect(mockListAllFolders).not.toHaveBeenCalled();
  });

  it("updates _apiFoldersLastFetched after a successful call", async () => {
    const before = Date.now();
    await plugin.sync();
    const fetched = plugin.settings._apiFoldersLastFetched ?? 0;
    expect(fetched).toBeGreaterThanOrEqual(before);
    expect(fetched).toBeLessThanOrEqual(Date.now());
  });

  it("does NOT update _apiFoldersLastFetched when listFolders throws (gives next sync a chance to retry)", async () => {
    mockListAllFolders.mockRejectedValue(new Error("network down"));
    await plugin.sync();
    expect(plugin.settings._apiFoldersLastFetched).toBeUndefined();
  });

  it("continues sync gracefully when listFolders throws", async () => {
    // Hand sync a non-empty document set so it runs through to completion
    // rather than bailing on the "no documents found" branch.
    mockFetchDocumentsForSync.mockResolvedValue([
      makeFetchedDoc({
        granolaId: "uuid-1",
        publicId: "not_X",
        membership: [{ id: "fld-a", name: "A", parent: null }],
      }),
    ]);
    mockListAllFolders.mockRejectedValue(new Error("network down"));

    await expect(plugin.sync()).resolves.toBeUndefined();
    expect(showStatusBarTemporary).toHaveBeenCalledWith(
      plugin,
      "Granola sync: Complete"
    );
  });

  it("detects and applies a rename found only via listFolders (no note in the window touched the folder)", async () => {
    // Previous snapshot: Strategy + a child note.
    plugin.settings._apiFolderSnapshot = {
      folders: {
        "fld-strategy": { title: "Strategy", parentId: null },
        "fld-hopo": { title: "Subteam", parentId: "fld-strategy" },
      },
      docFolders: { "uuid-1": ["fld-strategy", "fld-hopo"] },
    };

    // This sync's docs returned NO membership covering Strategy — we'll
    // synthesize zero docs.
    mockFetchDocumentsForSync.mockResolvedValue([]);

    // listFolders sees the rename.
    mockListAllFolders.mockResolvedValue([
      { id: "fld-strategy", object: "folder", name: "Planning", parent_folder_id: null },
      { id: "fld-hopo", object: "folder", name: "Subteam", parent_folder_id: "fld-strategy" },
    ]);

    // Spy on the (private) rename application — going through metadataCache
    // is overkill here, so we directly observe the updateRenamedFolders
    // call. Cast via any to access private method.
    const renameSpy = jest
      .spyOn(plugin as any, "updateRenamedFolders")
      .mockResolvedValue(undefined);

    await plugin.sync();

    expect(renameSpy).toHaveBeenCalledTimes(1);
    const renames: Map<string, string> = renameSpy.mock.calls[0][0];
    expect(renames.get("Strategy")).toBe("Planning");
    expect(renames.get("Strategy/Subteam")).toBe("Planning/Subteam");
  });

  it("persists the merged snapshot (including listFolders results) back to settings", async () => {
    plugin.settings._apiFolderSnapshot = {
      folders: { "fld-existing": { title: "Existing", parentId: null } },
      docFolders: { "uuid-old": ["fld-existing"] },
    };
    mockListAllFolders.mockResolvedValue([
      { id: "fld-existing", object: "folder", name: "Existing", parent_folder_id: null },
      { id: "fld-new", object: "folder", name: "New", parent_folder_id: null },
    ]);

    await plugin.sync();

    const merged = plugin.settings._apiFolderSnapshot!;
    expect(merged.folders["fld-existing"]).toBeDefined();
    expect(merged.folders["fld-new"]).toEqual({
      title: "New",
      parentId: null,
    });
    // Previous docFolders entry must survive (not be wiped by partial sync)
    expect(merged.docFolders["uuid-old"]).toEqual(["fld-existing"]);
  });

  describe("refresh-transcripts-only — fills missing notes, preserves existing", () => {
    /**
     * The user's Subteam orphan case: transcript exists in vault (from a
     * desktop sync that won the race against AI summary generation) but no
     * matching note file. `refresh-transcripts-only` mode should
     * automatically create the missing note (using the API summary as the
     * body, since there's nothing to preserve) without overwriting any
     * notes that DO exist.
     *
     * On subsequent syncs after the orphan is filled, the now-existing
     * note is preserved — covering the "user might edit it locally,
     * don't clobber" concern.
     */

    beforeEach(() => {
      plugin.settings.syncNotes = true;
      plugin.settings.syncTranscripts = false;
      plugin.settings.saveAsIndividualFiles = true;
      plugin.settings.apiSyncBodyMode = "refresh-transcripts-only";
    });

    it("creates a note when the file is missing locally (orphan-fix)", async () => {
      const missingId = "uuid-missing";
      const existingId = "uuid-existing";
      const existingFile = new TFile("Notes/Existing.md", "md");

      mockFileSyncService.findByGranolaId.mockImplementation(
        (id: string) => (id === existingId ? existingFile : null)
      );

      mockFetchDocumentsForSync.mockResolvedValue([
        makeFetchedDoc({ granolaId: missingId, publicId: "not_missing" }),
        makeFetchedDoc({ granolaId: existingId, publicId: "not_existing" }),
      ]);

      const recorder = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder });

      const skips = recorder
        .all()
        .filter((r) => r.outcome === "skip-body-write-disabled");
      // Only the existing file gets skipped — the missing one falls through
      // to the normal create path.
      expect(skips).toHaveLength(1);
      expect(skips[0].granolaId).toBe(existingId);

      // Save was called for the missing doc (creating the orphan-fix note).
      // The existing one was NOT saved.
      const savedIds = (mockFileSyncService.saveNoteToDisk as jest.Mock).mock
        .calls.map((call) => call[0].id);
      expect(savedIds).toEqual([missingId]);
    });

    it("skips body writes for all docs when every match already exists locally", async () => {
      const file1 = new TFile("Notes/A.md", "md");
      const file2 = new TFile("Notes/B.md", "md");
      mockFileSyncService.findByGranolaId.mockImplementation((id: string) =>
        id === "a" ? file1 : id === "b" ? file2 : null
      );
      mockFetchDocumentsForSync.mockResolvedValue([
        makeFetchedDoc({ granolaId: "a", publicId: "not_a" }),
        makeFetchedDoc({ granolaId: "b", publicId: "not_b" }),
      ]);

      const recorder = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder });

      expect(mockFileSyncService.saveNoteToDisk).not.toHaveBeenCalled();
      const skips = recorder
        .all()
        .filter((r) => r.outcome === "skip-body-write-disabled");
      expect(skips.map((r) => r.granolaId).sort()).toEqual(["a", "b"]);
    });

    it("daily-notes mode in refresh-transcripts-only stays all-or-nothing (documented gap)", async () => {
      // We deliberately do NOT implement the per-doc orphan-fix for daily
      // notes mode in this iteration — the section-based update semantics
      // are more invasive to change safely. Lock the existing behavior so
      // we don't silently regress when this gets revisited.
      plugin.settings.saveAsIndividualFiles = false;
      mockFetchDocumentsForSync.mockResolvedValue([
        makeFetchedDoc({ granolaId: "uuid-1", publicId: "not_X" }),
      ]);

      const recorder = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder });

      // No saves at all (current behavior — daily-notes skip stays
      // all-or-nothing in this mode).
      expect(mockFileSyncService.saveNoteToDisk).not.toHaveBeenCalled();
      expect(mockFileSyncService.saveCombinedNoteToDisk).not.toHaveBeenCalled();
    });
  });

  describe("dry-run contract — no live writes via orchestrator side-channels", () => {
    /**
     * Regression for a real bug surfaced during my own dry-run testing
     * (2026-05-22): three orchestrator helpers (`backfillFolderMetadata`,
     * `updateCrossLinks`, `updateRenamedFolders`) bypassed the
     * `FileSyncService`-level dry-run interception and wrote to disk during
     * a command labeled "no writes." These tests lock the contract that
     * those side-channels record-and-skip in dry-run mode.
     */

    function vaultFile(path: string, frontmatter: Record<string, unknown>) {
      return {
        file: new TFile(path, "md"),
        frontmatter,
      };
    }

    function setVaultFiles(
      entries: Array<{ file: TFile; frontmatter: Record<string, unknown> }>
    ) {
      mockApp.vault.getMarkdownFiles.mockReturnValue(entries.map((e) => e.file));
      mockApp.metadataCache.getFileCache.mockImplementation((file: TFile) => {
        const match = entries.find((e) => e.file.path === file.path);
        return match ? ({ frontmatter: match.frontmatter } as any) : null;
      });
    }

    it("does not call vault.modify from backfillFolderMetadata in dry-run", async () => {
      // One vault note matches a fetched doc and is missing folders frontmatter
      const granolaId = "uuid-1";
      setVaultFiles([
        vaultFile("Notes/Existing.md", { granola_id: granolaId }),
      ]);
      mockApp.vault.read = jest.fn().mockResolvedValue("---\ngranola_id: uuid-1\n---\nbody");

      mockFetchDocumentsForSync.mockResolvedValue([
        makeFetchedDoc({
          granolaId,
          publicId: "not_X",
          membership: [{ id: "fol_a", name: "Strategy", parent: null }],
        }),
      ]);

      const recorder = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder });

      expect(mockApp.vault.modify).not.toHaveBeenCalled();
      const fmRecords = recorder
        .all()
        .filter((r) => r.outcome === "would-modify-frontmatter");
      // The backfill helper records this as a "would-modify-frontmatter"
      // (folders backfill). Cross-link path is gated separately.
      expect(fmRecords.some((r) => r.reason?.includes("backfill"))).toBe(true);
    });

    it("does not produce phantom cross-link 'updates' when the matching note file is missing", async () => {
      // Regression for misleading log diagnosed during a real dry-run on
      // 2026-05-22: when an existing transcript file has no matching note
      // file in the vault, updateCrossLinks would log "Updated cross-links
      // in 1 pair" despite no record being created and no write being
      // performed. The counter now only increments on a real link.
      plugin.settings.syncNotes = true;
      plugin.settings.syncTranscripts = true;
      plugin.settings.saveAsIndividualFiles = true;
      plugin.settings.transcriptHandling = "custom-location";

      const granolaId = "uuid-1";
      const transcriptFile = new TFile("Transcripts/orphan-transcript.md", "md");
      // Transcript present, NOTE MISSING.
      mockFileSyncService.findByGranolaId.mockImplementation(
        (id: string, type: "note" | "transcript" | "combined") => {
          if (id !== granolaId) return null;
          if (type === "transcript") return transcriptFile;
          return null; // no matching note file
        }
      );
      mockFetchDocumentsForSync.mockResolvedValue([
        makeFetchedDoc({ granolaId, publicId: "not_X" }),
      ]);

      const recorder = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder });

      // No cross-link record should have been emitted — there was no pair.
      const crossLinkRecords = recorder
        .all()
        .filter(
          (r) =>
            r.outcome === "would-modify-frontmatter" &&
            r.reason?.startsWith("cross-link")
        );
      expect(crossLinkRecords).toEqual([]);
      // And no live write either.
      expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it("does not call processFrontMatter from updateCrossLinks in dry-run", async () => {
      // Enable note + transcript sync so updateCrossLinks would run.
      plugin.settings.syncNotes = true;
      plugin.settings.syncTranscripts = true;
      plugin.settings.saveAsIndividualFiles = true;
      plugin.settings.transcriptHandling = "custom-location";

      const granolaId = "uuid-1";
      const noteFile = new TFile("Notes/Note.md", "md");
      const transcriptFile = new TFile("Transcripts/Note-transcript.md", "md");

      // FileSyncService.findByGranolaId returns the right files per type
      mockFileSyncService.findByGranolaId.mockImplementation(
        (id: string, type: "note" | "transcript" | "combined") => {
          if (id !== granolaId) return null;
          if (type === "note") return noteFile;
          if (type === "transcript") return transcriptFile;
          return null;
        }
      );

      mockFetchDocumentsForSync.mockResolvedValue([
        makeFetchedDoc({ granolaId, publicId: "not_X" }),
      ]);

      const recorder = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder });

      expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
      const crossLinkRecords = recorder
        .all()
        .filter(
          (r) =>
            r.outcome === "would-modify-frontmatter" &&
            r.reason?.startsWith("cross-link")
        );
      expect(crossLinkRecords.length).toBeGreaterThan(0);
    });

    it("does not call saveData during the sync run in dry-run mode", async () => {
      // Force the snapshot-write path to execute by providing a fetched doc
      // with membership and a stale folders-last-fetched (so listFolders runs).
      mockFetchDocumentsForSync.mockResolvedValue([
        makeFetchedDoc({
          granolaId: "uuid-1",
          publicId: "not_X",
          membership: [{ id: "fol_a", name: "A", parent: null }],
        }),
      ]);
      mockListAllFolders.mockResolvedValue([]);

      const saveDataSpy = jest.spyOn(plugin, "saveData");

      const recorder = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder });

      // The only allowed saveData during sync is the 401 path (diagnostic
      // setting). No 401 occurred here.
      expect(saveDataSpy).not.toHaveBeenCalled();
    });

    it("does not mutate in-memory settings during dry-run (settings snapshot restored)", async () => {
      // Regression for a real bug surfaced on 2026-05-22: a dry-run set
      // `this.settings.latestSyncTime = Date.now()` in memory, so a second
      // back-to-back dry-run in the same Obsidian session saw the advanced
      // clock and returned 0 notes (window started after the first run's
      // completion). The fix: snapshot settings on dry-run start, restore on
      // finish. This test locks the contract.
      const before = {
        latestSyncTime: 1779000000000,
        apiFoldersLastFetched: 1779000000000,
        apiSyncBodyMode: "refresh-transcripts-only" as const,
        apiFolderSnapshot: {
          folders: { "fol_a": { title: "A", parentId: null } },
          docFolders: { "uuid-1": ["fol_a"] },
        },
      };
      plugin.settings.latestSyncTime = before.latestSyncTime;
      plugin.settings._apiFoldersLastFetched = before.apiFoldersLastFetched;
      plugin.settings.apiSyncBodyMode = before.apiSyncBodyMode;
      plugin.settings._apiFolderSnapshot = before.apiFolderSnapshot;

      // Force the listFolders path to run (stale timer) so the snapshot
      // gets mutated mid-run. Provide a fetched doc so other settings
      // mutations have a chance to fire.
      mockFetchDocumentsForSync.mockResolvedValue([
        makeFetchedDoc({
          granolaId: "uuid-1",
          publicId: "not_X",
          membership: [{ id: "fol_b", name: "B", parent: null }],
        }),
      ]);
      mockListAllFolders.mockResolvedValue([
        { id: "fol_b", object: "folder", name: "B", parent_folder_id: null },
      ]);

      const recorder = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder });

      // Every settings field that the sync code mutates in-memory should
      // be restored to its pre-dry-run value.
      expect(plugin.settings.latestSyncTime).toBe(before.latestSyncTime);
      expect(plugin.settings._apiFoldersLastFetched).toBe(
        before.apiFoldersLastFetched
      );
      expect(plugin.settings.apiSyncBodyMode).toBe(before.apiSyncBodyMode);
      expect(plugin.settings._apiFolderSnapshot).toEqual(
        before.apiFolderSnapshot
      );
    });

    it("does not advance latestSyncTime between back-to-back dry-runs", async () => {
      // Concrete repro of the scenario from production: two dry-runs in a
      // row should both see the SAME `updated_after` window (the original
      // production timestamp), not a window shifted by the first run.
      plugin.settings.latestSyncTime = 1779000000000;

      mockFetchDocumentsForSync.mockResolvedValue([]);

      const recorder1 = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder1 });
      const fetcherCallArgsFirst =
        mockFetchDocumentsForSync.mock.calls[0]?.[2];

      mockFetchDocumentsForSync.mockClear();

      const recorder2 = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder2 });
      const fetcherCallArgsSecond =
        mockFetchDocumentsForSync.mock.calls[0]?.[2];

      expect(fetcherCallArgsFirst?.latestSyncTime).toBe(1779000000000);
      expect(fetcherCallArgsSecond?.latestSyncTime).toBe(1779000000000);
      expect(plugin.settings.latestSyncTime).toBe(1779000000000);
    });

    it("preserves the 401 _lastApiAuthError flag even after dry-run snapshot restore", async () => {
      // 401 detected by dry-run is real; the badge in settings should
      // surface so the user knows to fix the key. This is the one
      // documented exception to the "no settings mutation" contract.
      plugin.settings._lastApiAuthError = false;

      const PublicApiError = (require("../../src/services/publicGranolaApi") as any)
        .PublicApiError;
      mockFetchDocumentsForSync.mockRejectedValueOnce(
        new PublicApiError("Unauthorized", 401, "req_test")
      );

      const recorder = new DryRunRecorder();
      await plugin.sync({ dryRun: recorder });

      expect(plugin.settings._lastApiAuthError).toBe(true);
    });

    it("still calls saveData on 401 (diagnostic _lastApiAuthError flag) even in dry-run", async () => {
      // PublicApiError with status 401 should set _lastApiAuthError so the
      // settings badge appears regardless of whether we were in dry-run.
      const PublicApiError = (require("../../src/services/publicGranolaApi") as any)
        .PublicApiError;
      const err = new PublicApiError("Unauthorized", 401, "req_test");
      mockFetchDocumentsForSync.mockRejectedValueOnce(err);

      const saveDataSpy = jest.spyOn(plugin, "saveData");
      const recorder = new DryRunRecorder();

      await plugin.sync({ dryRun: recorder });

      expect(saveDataSpy).toHaveBeenCalled();
      expect(plugin.settings._lastApiAuthError).toBe(true);
    });
  });

  it("merges per-note membership and listFolders results into a single snapshot", async () => {
    // No previous snapshot.
    plugin.settings._apiFolderSnapshot = undefined;
    plugin.settings._apiFoldersLastFetched = undefined;

    // Per-note membership: one doc in Strategy/Subteam.
    mockFetchDocumentsForSync.mockResolvedValue([
      makeFetchedDoc({
        granolaId: "uuid-1",
        publicId: "not_X",
        membership: [
          { id: "fld-strategy", name: "Strategy", parent: null },
          { id: "fld-hopo", name: "Subteam", parent: "fld-strategy" },
        ],
      }),
    ]);

    // listFolders adds one more folder.
    mockListAllFolders.mockResolvedValue([
      { id: "fld-strategy", object: "folder", name: "Strategy", parent_folder_id: null },
      { id: "fld-hopo", object: "folder", name: "Subteam", parent_folder_id: "fld-strategy" },
      { id: "fld-archive", object: "folder", name: "Archive", parent_folder_id: null },
    ]);

    await plugin.sync();

    const merged = plugin.settings._apiFolderSnapshot!;
    expect(Object.keys(merged.folders).sort()).toEqual([
      "fld-archive",
      "fld-hopo",
      "fld-strategy",
    ]);
    expect(merged.docFolders["uuid-1"]).toEqual(["fld-strategy", "fld-hopo"]);
  });
});
