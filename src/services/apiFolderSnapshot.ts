import type {
  PublicFolderMembershipEntry,
  PublicListFoldersResponse,
  PublicFolder,
} from "./publicApiSchemas";
import { resolveFolderPath, type FolderInfo } from "./folderMapBuilder";

/**
 * Default interval between full `listFolders()` API calls in API-key mode.
 *
 * Per-sync folder list calls would catch renames in folders whose notes
 * didn't appear in the incremental sync window, but the cost adds up
 * (especially with `mode: "standard"` running on a periodic timer). A daily
 * cadence catches the rename within 24h with one extra request per day.
 *
 * Override at the call site (e.g. tests) by passing a different interval to
 * {@link shouldRefetchFolders}; the constant is the default.
 */
export const FOLDERS_REFETCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Persisted snapshot of folder state from Public API syncs.
 *
 * Mirrors the shape of `FolderMapData` (the desktop equivalent) so the same
 * `resolveFolderPath` + diff algorithm can be reused. The difference is the
 * source of data:
 *
 * - Desktop sync gets folder hierarchy from `get-document-lists-metadata` +
 *   `get-document-list`, which always returns *every* folder + membership.
 * - Public API only gives us `folder_membership` inline on each Get Note
 *   response. We only observe folders that have at least one note in the
 *   current sync window. Use {@link mergeApiFolderSnapshots} to preserve
 *   previously-seen folders that a partial sync didn't include.
 *
 * Storing folder IDs (not just slashed paths) is what makes rename detection
 * robust against parent renames, sibling collisions, and incremental fetches.
 */
export interface ApiFolderSnapshot {
  /** Stable folder ID → folder metadata. */
  folders: Record<string, FolderInfo>;
  /** Granola doc ID → array of folder IDs the doc belongs to. */
  docFolders: Record<string, string[]>;
}

export interface SnapshotInput {
  /** Internal granola_id (UUID extracted from web_url) for this doc. */
  granolaId: string;
  membership: PublicFolderMembershipEntry[] | undefined;
}

/**
 * Builds a fresh snapshot from a batch of Get Note responses. The caller is
 * expected to pass *every* doc returned in this sync's window; previously-seen
 * folders not in this batch are merged in via {@link mergeApiFolderSnapshots}.
 */
export function buildApiFolderSnapshot(
  inputs: SnapshotInput[]
): ApiFolderSnapshot {
  const folders: Record<string, FolderInfo> = {};
  const docFolders: Record<string, string[]> = {};

  for (const { granolaId, membership } of inputs) {
    const seen = new Set<string>();
    const ids: string[] = [];
    if (membership) {
      for (const entry of membership) {
        folders[entry.id] = {
          title: entry.name,
          parentId: entry.parent_folder_id ?? null,
        };
        if (!seen.has(entry.id)) {
          seen.add(entry.id);
          ids.push(entry.id);
        }
      }
    }
    docFolders[granolaId] = ids;
  }

  return { folders, docFolders };
}

/**
 * Merges a fresh (possibly partial) snapshot into a previously-persisted one.
 *
 * - `partial.folders` entries override `previous.folders` (folder metadata
 *   can change; the fresh observation wins).
 * - `partial.docFolders` entries override `previous.docFolders` only for the
 *   docs present in `partial`; other docs' previous folder lists are kept.
 *
 * The result is suitable for both writing back to settings as the new
 * snapshot AND for diffing against the previous one — see
 * {@link diffApiFolderSnapshots}.
 */
export function mergeApiFolderSnapshots(
  previous: ApiFolderSnapshot,
  partial: ApiFolderSnapshot
): ApiFolderSnapshot {
  return {
    folders: { ...previous.folders, ...partial.folders },
    docFolders: { ...previous.docFolders, ...partial.docFolders },
  };
}

/**
 * Converts a `listFolders` API response (or just its `folders` array) into
 * the `folders` half of an {@link ApiFolderSnapshot}. The response carries
 * no membership info, so `docFolders` is the caller's responsibility (merge
 * this in alongside a per-note partial snapshot).
 *
 * Accepts either the full response object or a flat folder array — the
 * paginated client returns the flat array via `listAllFolders`.
 */
export function folderListResponseToSnapshotFolders(
  input: PublicListFoldersResponse | PublicFolder[]
): Record<string, FolderInfo> {
  const folders = Array.isArray(input) ? input : input.folders;
  const out: Record<string, FolderInfo> = {};
  for (const f of folders) {
    out[f.id] = { title: f.name, parentId: f.parent_folder_id ?? null };
  }
  return out;
}

/**
 * Returns true when API-mode sync should make an extra `listFolders` call
 * this run. Used to catch renames of folders whose notes didn't appear in
 * any recent incremental sync window.
 *
 * - First sync (no previous timestamp): returns true.
 * - Inside the interval: returns false.
 * - Past the interval: returns true.
 * - Future-dated timestamp (clock skew / corruption): returns false so we
 *   don't get stuck refetching every sync.
 *
 * Pure function (no Date.now() reads) so callers can pass `now` explicitly
 * for testability.
 */
export function shouldRefetchFolders(
  now: number,
  lastFetched: number | undefined,
  intervalMs: number = FOLDERS_REFETCH_INTERVAL_MS
): boolean {
  if (!lastFetched || lastFetched <= 0) return true;
  if (lastFetched > now) return false;
  return now - lastFetched >= intervalMs;
}

/**
 * Compares two snapshots and returns the set of `oldPath → newPath` renames
 * (or moves). A folder is considered renamed when its resolved path (parent
 * chain walked into slashed string) differs between the snapshots.
 *
 * Mirrors the desktop {@link import("./folderMapBuilder").diffFolderMaps}
 * behavior. Pass `previous = null` to indicate first sync — returns an empty
 * map.
 *
 * Caller guarantees: the snapshots must contain only folders observed in
 * either sync; an unobserved folder cannot be diffed.
 */
export function diffApiFolderSnapshots(
  previous: ApiFolderSnapshot | null,
  current: ApiFolderSnapshot
): Map<string, string> {
  const renames = new Map<string, string>();
  if (!previous) return renames;

  for (const folderId of Object.keys(current.folders)) {
    const before = previous.folders[folderId];
    if (!before) continue;
    const oldPath = resolveFolderPath(folderId, previous.folders);
    const newPath = resolveFolderPath(folderId, current.folders);
    if (oldPath !== newPath && oldPath && newPath) {
      // First write wins (don't clobber); a single folder id only has one
      // canonical rename per sync.
      if (!renames.has(oldPath)) {
        renames.set(oldPath, newPath);
      }
    }
  }

  return renames;
}
