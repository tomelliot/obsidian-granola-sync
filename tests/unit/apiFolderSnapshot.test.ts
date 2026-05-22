/**
 * Tests for the API-mode folder snapshot + diff.
 *
 * Goal: get the same fidelity as the desktop `diffFolderMaps` (in
 * folderMapBuilder.ts). The Public API gives us stable folder IDs per
 * `folder_membership`; we should persist them in the snapshot instead of
 * just slashed path strings, so diffs survive parent renames and incremental
 * syncs.
 *
 * Each `describe` below documents one behavior we want — TDD-first. Behaviors
 * the current heuristic in `main.ts::computeFolderRenames` fails are
 * specifically called out.
 */

import type {
  PublicFolderMembershipEntry,
  PublicListFoldersResponse,
} from "../../src/services/publicApiSchemas";
import {
  buildApiFolderSnapshot,
  diffApiFolderSnapshots,
  mergeApiFolderSnapshots,
  folderListResponseToSnapshotFolders,
  shouldRefetchFolders,
  FOLDERS_REFETCH_INTERVAL_MS,
  type ApiFolderSnapshot,
} from "../../src/services/apiFolderSnapshot";

// `resolveFolderPath` (used internally by diffApiFolderSnapshots) calls
// log.error when it detects a folder cycle. The cycle test below exercises
// that branch deliberately; we mock the logger so the test output stays
// quiet without altering production behavior.
jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

function membership(
  ...entries: Array<[id: string, name: string, parentId?: string | null]>
): PublicFolderMembershipEntry[] {
  return entries.map(([id, name, parent_folder_id]) => ({
    id,
    name,
    parent_folder_id: parent_folder_id ?? null,
  }));
}

describe("buildApiFolderSnapshot", () => {
  it("collects folder metadata across multiple notes by folder_id", () => {
    const snap = buildApiFolderSnapshot([
      {
        granolaId: "uuid-1",
        membership: membership(
          ["fld-strategy", "Strategy", null],
          ["fld-hopo", "Subteam", "fld-strategy"]
        ),
      },
      {
        granolaId: "uuid-2",
        membership: membership(["fld-strategy", "Strategy", null]),
      },
    ]);

    expect(snap.folders["fld-strategy"]).toEqual({
      title: "Strategy",
      parentId: null,
    });
    expect(snap.folders["fld-hopo"]).toEqual({
      title: "Subteam",
      parentId: "fld-strategy",
    });
    // doc → folder ID associations
    expect(snap.docFolders["uuid-1"]).toEqual(["fld-strategy", "fld-hopo"]);
    expect(snap.docFolders["uuid-2"]).toEqual(["fld-strategy"]);
  });

  it("treats notes with no folders as an empty list (not absent)", () => {
    const snap = buildApiFolderSnapshot([
      { granolaId: "uuid-1", membership: [] },
    ]);
    expect(snap.docFolders["uuid-1"]).toEqual([]);
  });

  it("dedupes folder IDs within a note", () => {
    const snap = buildApiFolderSnapshot([
      {
        granolaId: "uuid-1",
        membership: membership(
          ["fld-a", "A", null],
          ["fld-a", "A", null]
        ),
      },
    ]);
    expect(snap.docFolders["uuid-1"]).toEqual(["fld-a"]);
  });
});

describe("diffApiFolderSnapshots — leaf rename", () => {
  it("emits oldPath → newPath when a leaf folder is renamed", () => {
    const previous: ApiFolderSnapshot = {
      folders: {
        "fld-strategy": { title: "Strategy", parentId: null },
        "fld-hopo": { title: "Subteam", parentId: "fld-strategy" },
      },
      docFolders: { "uuid-1": ["fld-strategy", "fld-hopo"] },
    };
    const current: ApiFolderSnapshot = {
      folders: {
        "fld-strategy": { title: "Strategy", parentId: null },
        // Subteam renamed to "Strategy 2026"
        "fld-hopo": { title: "Strategy 2026", parentId: "fld-strategy" },
      },
      docFolders: { "uuid-1": ["fld-strategy", "fld-hopo"] },
    };

    const renames = diffApiFolderSnapshots(previous, current);
    expect(renames.get("Strategy/Subteam")).toBe("Strategy/Strategy 2026");
    expect(renames.size).toBe(1);
  });
});

describe("diffApiFolderSnapshots — parent rename (CURRENT HEURISTIC MISSES THIS)", () => {
  /**
   * The most important case. When a parent folder is renamed, every
   * descendant's resolved path changes too. The desktop differ handles this
   * by walking parents; the current API heuristic in main.ts only compares
   * leaf names, so it would miss `Strategy/Subteam → Planning/Subteam` when
   * "Strategy" is renamed to "Planning".
   */
  it("propagates a parent rename to all descendants", () => {
    const previous: ApiFolderSnapshot = {
      folders: {
        "fld-strategy": { title: "Strategy", parentId: null },
        "fld-hopo": { title: "Subteam", parentId: "fld-strategy" },
        "fld-q1": { title: "Q1", parentId: "fld-hopo" },
      },
      docFolders: { "uuid-1": ["fld-q1"] },
    };
    const current: ApiFolderSnapshot = {
      folders: {
        // Renamed Strategy → Planning
        "fld-strategy": { title: "Planning", parentId: null },
        "fld-hopo": { title: "Subteam", parentId: "fld-strategy" },
        "fld-q1": { title: "Q1", parentId: "fld-hopo" },
      },
      docFolders: { "uuid-1": ["fld-q1"] },
    };

    const renames = diffApiFolderSnapshots(previous, current);
    expect(renames.get("Strategy")).toBe("Planning");
    expect(renames.get("Strategy/Subteam")).toBe("Planning/Subteam");
    expect(renames.get("Strategy/Subteam/Q1")).toBe("Planning/Subteam/Q1");
  });
});

describe("diffApiFolderSnapshots — move (reparent without leaf rename)", () => {
  it("emits the path change when a folder is reparented", () => {
    const previous: ApiFolderSnapshot = {
      folders: {
        "fld-strategy": { title: "Strategy", parentId: null },
        "fld-archive": { title: "Archive", parentId: null },
        "fld-hopo": { title: "Subteam", parentId: "fld-strategy" },
      },
      docFolders: { "uuid-1": ["fld-hopo"] },
    };
    const current: ApiFolderSnapshot = {
      folders: {
        "fld-strategy": { title: "Strategy", parentId: null },
        "fld-archive": { title: "Archive", parentId: null },
        // Subteam moved under Archive
        "fld-hopo": { title: "Subteam", parentId: "fld-archive" },
      },
      docFolders: { "uuid-1": ["fld-hopo"] },
    };

    const renames = diffApiFolderSnapshots(previous, current);
    expect(renames.get("Strategy/Subteam")).toBe("Archive/Subteam");
  });
});

describe("diffApiFolderSnapshots — sibling folders with same name", () => {
  /**
   * Two folders both named "Standup" but in different parents. Renaming one
   * must not falsely match the other. The current heuristic groups by
   * leaf-name only, which could conflate.
   */
  it("does not conflate siblings with the same leaf name", () => {
    const previous: ApiFolderSnapshot = {
      folders: {
        "fld-team-a": { title: "Team A", parentId: null },
        "fld-team-b": { title: "Team B", parentId: null },
        "fld-standup-a": { title: "Standup", parentId: "fld-team-a" },
        "fld-standup-b": { title: "Standup", parentId: "fld-team-b" },
      },
      docFolders: { "uuid-1": ["fld-standup-a"], "uuid-2": ["fld-standup-b"] },
    };
    const current: ApiFolderSnapshot = {
      folders: {
        "fld-team-a": { title: "Team A", parentId: null },
        "fld-team-b": { title: "Team B", parentId: null },
        // Only the Team A standup gets renamed.
        "fld-standup-a": { title: "Daily Sync", parentId: "fld-team-a" },
        "fld-standup-b": { title: "Standup", parentId: "fld-team-b" },
      },
      docFolders: { "uuid-1": ["fld-standup-a"], "uuid-2": ["fld-standup-b"] },
    };

    const renames = diffApiFolderSnapshots(previous, current);
    expect(renames.get("Team A/Standup")).toBe("Team A/Daily Sync");
    expect(renames.has("Team B/Standup")).toBe(false);
  });
});

describe("diffApiFolderSnapshots — non-renames must not trigger", () => {
  it("returns empty when a doc gains a folder", () => {
    const previous: ApiFolderSnapshot = {
      folders: { "fld-a": { title: "A", parentId: null } },
      docFolders: { "uuid-1": [] },
    };
    const current: ApiFolderSnapshot = {
      folders: { "fld-a": { title: "A", parentId: null } },
      docFolders: { "uuid-1": ["fld-a"] },
    };
    expect(diffApiFolderSnapshots(previous, current).size).toBe(0);
  });

  it("returns empty when a doc moves between unrelated folders", () => {
    const previous: ApiFolderSnapshot = {
      folders: {
        "fld-a": { title: "A", parentId: null },
        "fld-b": { title: "B", parentId: null },
      },
      docFolders: { "uuid-1": ["fld-a"] },
    };
    const current: ApiFolderSnapshot = {
      folders: {
        "fld-a": { title: "A", parentId: null },
        "fld-b": { title: "B", parentId: null },
      },
      docFolders: { "uuid-1": ["fld-b"] },
    };
    expect(diffApiFolderSnapshots(previous, current).size).toBe(0);
  });

  it("returns empty when a new folder appears", () => {
    const previous: ApiFolderSnapshot = {
      folders: {},
      docFolders: {},
    };
    const current: ApiFolderSnapshot = {
      folders: { "fld-a": { title: "A", parentId: null } },
      docFolders: { "uuid-1": ["fld-a"] },
    };
    expect(diffApiFolderSnapshots(previous, current).size).toBe(0);
  });

  it("returns empty when a folder disappears (we can't tell rename vs delete without a new id)", () => {
    const previous: ApiFolderSnapshot = {
      folders: { "fld-a": { title: "A", parentId: null } },
      docFolders: { "uuid-1": ["fld-a"] },
    };
    const current: ApiFolderSnapshot = {
      folders: {},
      docFolders: { "uuid-1": [] },
    };
    expect(diffApiFolderSnapshots(previous, current).size).toBe(0);
  });

  it("returns empty when previous is null/empty (first sync)", () => {
    expect(
      diffApiFolderSnapshots(null, {
        folders: { "fld-a": { title: "A", parentId: null } },
        docFolders: { "uuid-1": ["fld-a"] },
      }).size
    ).toBe(0);
  });
});

describe("diffApiFolderSnapshots — defensive", () => {
  it("does not loop on cycles", () => {
    const previous: ApiFolderSnapshot = {
      folders: {
        "fld-a": { title: "A", parentId: "fld-b" },
        "fld-b": { title: "B", parentId: "fld-a" },
      },
      docFolders: { "uuid-1": ["fld-a"] },
    };
    const current: ApiFolderSnapshot = {
      folders: {
        "fld-a": { title: "A renamed", parentId: "fld-b" },
        "fld-b": { title: "B", parentId: "fld-a" },
      },
      docFolders: { "uuid-1": ["fld-a"] },
    };

    const renames = diffApiFolderSnapshots(previous, current);
    // It just needs to terminate and emit *something* for the renamed folder.
    expect([...renames.keys()].length).toBeGreaterThan(0);
  });
});

describe("mergeApiFolderSnapshots — incremental sync preservation", () => {
  /**
   * Incremental syncs only fetch a window of notes. The fresh API call only
   * reports `folder_membership` for the notes in that window. If we replace
   * the snapshot wholesale, we lose folder info for the 200 other notes in
   * the vault. The merge keeps previous entries the partial didn't override.
   */
  it("preserves previous folder entries the partial did not include", () => {
    const previous: ApiFolderSnapshot = {
      folders: {
        "fld-a": { title: "A", parentId: null },
        "fld-b": { title: "B", parentId: null },
      },
      docFolders: { "uuid-1": ["fld-a"], "uuid-2": ["fld-b"] },
    };
    const partial: ApiFolderSnapshot = {
      folders: {
        // fresh sync only saw a different folder + reconfirmed fld-a's name
        "fld-a": { title: "A renamed", parentId: null },
        "fld-c": { title: "C", parentId: null },
      },
      docFolders: { "uuid-1": ["fld-a"], "uuid-3": ["fld-c"] },
    };

    const merged = mergeApiFolderSnapshots(previous, partial);
    // partial overrides where present
    expect(merged.folders["fld-a"].title).toBe("A renamed");
    expect(merged.folders["fld-c"].title).toBe("C");
    // previous preserved where partial didn't touch
    expect(merged.folders["fld-b"].title).toBe("B");
    // doc associations: partial overrides per-doc, previous fills in untouched docs
    expect(merged.docFolders["uuid-1"]).toEqual(["fld-a"]);
    expect(merged.docFolders["uuid-2"]).toEqual(["fld-b"]);
    expect(merged.docFolders["uuid-3"]).toEqual(["fld-c"]);
  });

  it("merging an empty partial returns the previous snapshot unchanged", () => {
    const previous: ApiFolderSnapshot = {
      folders: { "fld-a": { title: "A", parentId: null } },
      docFolders: { "uuid-1": ["fld-a"] },
    };
    const merged = mergeApiFolderSnapshots(previous, {
      folders: {},
      docFolders: {},
    });
    expect(merged).toEqual(previous);
  });
});

describe("folderListResponseToSnapshotFolders", () => {
  it("converts the list-folders response into a folders map keyed by id", () => {
    const response: PublicListFoldersResponse = {
      folders: [
        { id: "fol-strategy", object: "folder", name: "Strategy", parent_folder_id: null },
        { id: "fol-hopo", object: "folder", name: "Subteam", parent_folder_id: "fol-strategy" },
      ],
      cursor: null,
      hasMore: false,
    };
    expect(folderListResponseToSnapshotFolders(response)).toEqual({
      "fol-strategy": { title: "Strategy", parentId: null },
      "fol-hopo": { title: "Subteam", parentId: "fol-strategy" },
    });
  });

  it("returns empty when the response has no folders", () => {
    expect(
      folderListResponseToSnapshotFolders({
        folders: [],
        cursor: null,
        hasMore: false,
      })
    ).toEqual({});
  });
});

describe("shouldRefetchFolders — daily cadence", () => {
  /**
   * The behavior we want: an extra listFolders() call only once per
   * FOLDERS_REFETCH_INTERVAL_MS (default 24h). This avoids the per-sync
   * cost (one full folder list per sync) while still catching renames of
   * folders whose notes didn't appear in any recent incremental window
   * within ~24h.
   */
  it("returns true on the very first sync (no previous timestamp)", () => {
    expect(shouldRefetchFolders(Date.now(), undefined)).toBe(true);
    expect(shouldRefetchFolders(Date.now(), 0)).toBe(true);
  });

  it("returns false when the last fetch was inside the interval", () => {
    const now = Date.UTC(2026, 4, 22, 12, 0, 0);
    const recent = now - 60 * 60 * 1000; // 1h ago
    expect(shouldRefetchFolders(now, recent)).toBe(false);
  });

  it("returns true when the last fetch was past the interval", () => {
    const now = Date.UTC(2026, 4, 22, 12, 0, 0);
    const stale = now - (FOLDERS_REFETCH_INTERVAL_MS + 60_000);
    expect(shouldRefetchFolders(now, stale)).toBe(true);
  });

  it("treats a future-dated last-fetched timestamp as fresh (clock-skew defense)", () => {
    // If something corrupted lastFetched into the future, we should not
    // panic-refetch on every sync; just wait until clock time catches up.
    const now = Date.UTC(2026, 4, 22, 12, 0, 0);
    expect(shouldRefetchFolders(now, now + 60_000)).toBe(false);
  });
});

describe("integration: listFolders catches a rename that didn't appear in a sync window", () => {
  /**
   * Concrete scenario this enables:
   * - Previous sync persisted folder "Strategy" (fld-strategy).
   * - User renames Strategy → Planning in Granola.
   * - No notes in Strategy were touched in the next sync window, so
   *   no `folder_membership` from Get Note reflects the rename.
   * - The periodic listFolders call DOES see the new name; merging it in
   *   then diffing against the previous snapshot produces the rename.
   */
  it("emits a rename for a folder no note in the current sync touched", () => {
    const previous: ApiFolderSnapshot = {
      folders: {
        "fld-strategy": { title: "Strategy", parentId: null },
        "fld-hopo": { title: "Subteam", parentId: "fld-strategy" },
      },
      docFolders: { "uuid-1": ["fld-strategy", "fld-hopo"] },
    };

    // Simulated: zero notes in the incremental window touched Strategy,
    // so the per-note membership snapshot is empty. But listFolders returned
    // the freshly renamed hierarchy.
    const perNotePartial = buildApiFolderSnapshot([]);
    const freshFoldersOnly: ApiFolderSnapshot = {
      folders: folderListResponseToSnapshotFolders({
        folders: [
          { id: "fld-strategy", object: "folder", name: "Planning", parent_folder_id: null },
          { id: "fld-hopo", object: "folder", name: "Subteam", parent_folder_id: "fld-strategy" },
        ],
        cursor: null,
        hasMore: false,
      }),
      docFolders: {}, // listFolders does not return memberships
    };

    const merged = mergeApiFolderSnapshots(
      mergeApiFolderSnapshots(previous, perNotePartial),
      freshFoldersOnly
    );
    const renames = diffApiFolderSnapshots(previous, merged);

    expect(renames.get("Strategy")).toBe("Planning");
    expect(renames.get("Strategy/Subteam")).toBe("Planning/Subteam");
  });
});

describe("diffApiFolderSnapshots — determinism", () => {
  it("produces the same output for identical inputs", () => {
    const snap: ApiFolderSnapshot = {
      folders: {
        "fld-1": { title: "Zeta", parentId: null },
        "fld-2": { title: "Alpha", parentId: null },
      },
      docFolders: { "uuid-1": ["fld-1", "fld-2"] },
    };
    const a = diffApiFolderSnapshots(snap, {
      ...snap,
      folders: { ...snap.folders, "fld-1": { title: "Zeta renamed", parentId: null } },
    });
    const b = diffApiFolderSnapshots(snap, {
      ...snap,
      folders: { ...snap.folders, "fld-1": { title: "Zeta renamed", parentId: null } },
    });
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});
