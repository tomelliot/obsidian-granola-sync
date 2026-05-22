import {
  getAllDocuments,
  getRecentDocuments,
  fetchGranolaTranscript,
} from "./granolaApi";
import {
  listAllNotes,
  getNote,
  PublicApiError,
} from "./publicGranolaApi";
import {
  adaptPublicNoteToGranolaDoc,
  adaptPublicNoteSummary,
  adaptTranscript,
  extractFoldersFromMembership,
} from "./granolaDocAdapter";
import type { AuthResult } from "./auth";
import type { GranolaSyncSettings } from "../settings";
import type { GranolaDoc, TranscriptEntry } from "./granolaTypes";
import type { PublicFolderMembershipEntry } from "./publicApiSchemas";
import { log } from "../utils/logger";

/**
 * A document ready for the sync pipeline, plus per-doc context the API-key
 * path needs to carry around (legacy ID bridge, folders, transcript).
 *
 * `desktop` mode populates `doc` only; `apiFolders` / `apiTranscript` /
 * `_publicId` are empty / undefined.
 */
export interface FetchedDoc {
  doc: GranolaDoc;
  /** Folder paths derived from the source (Public API or desktop folder map). */
  folders?: string[];
  /**
   * Raw API folder_membership for this note, when in API-key mode. Carries
   * stable folder IDs needed for {@link import("./apiFolderSnapshot").buildApiFolderSnapshot}
   * to detect renames robustly. Undefined for desktop mode.
   */
  folderMembership?: PublicFolderMembershipEntry[];
  /** Pre-fetched transcript entries, available in API-key mode. */
  apiTranscript?: TranscriptEntry[];
  /** Public API `not_*` id when in API-key mode. */
  publicId?: string;
  /** Public API `web_url` when in API-key mode. */
  webUrl?: string | null;
}

export type FetcherMode = "standard" | "full";

export interface FetcherOptions {
  mode: FetcherMode;
  /**
   * If true, the API-key path fetches transcripts in the same Get Note call.
   * Mirrors `settings.syncTranscripts` — separated as a parameter so the
   * orchestrator can override (e.g. dry-run could pass false).
   */
  includeTranscripts?: boolean;
  /**
   * Optional `granolaId → last-known-updated_at` map. When provided, the
   * API-key path uses this to skip `Get Note` calls for unchanged notes —
   * the "gate Get Note behind list updated_at" optimization.
   */
  knownUpdatedAtByGranolaId?: Map<string, string | undefined>;
  /** Latest successful sync timestamp (ms). Used as `updated_after` in API mode. */
  latestSyncTime?: number;
}

/**
 * Reads documents for a sync run from the appropriate Granola endpoint based on
 * `auth.method`. Returns a flat list of {@link FetchedDoc}; the rest of the
 * sync pipeline shouldn't have to know which API the data came from.
 *
 * Performance notes (API-key mode):
 * - Public API is N+1: one list call + one Get Note per note. Rate-limited
 *   at ~4.5 req/s by {@link publicGranolaApi} to stay under Granola's
 *   documented 5 req/s sustained limit.
 * - We pre-gate with the list-level `updated_at`: when the caller supplies
 *   `knownUpdatedAtByGranolaId`, we skip `getNote` for notes whose remote
 *   timestamp matches what we already have on disk.
 */
export async function fetchDocumentsForSync(
  auth: AuthResult,
  settings: GranolaSyncSettings,
  options: FetcherOptions
): Promise<FetchedDoc[]> {
  if (auth.method === "desktop") {
    return fetchDesktop(auth.token, settings, options);
  }
  return fetchApiKey(auth.token, settings, options);
}

async function fetchDesktop(
  token: string,
  settings: GranolaSyncSettings,
  options: FetcherOptions
): Promise<FetchedDoc[]> {
  const includeShared = settings.includeSharedNotes;
  const docs =
    options.mode === "full"
      ? await getAllDocuments(token, 100, includeShared)
      : await getRecentDocuments(token, settings.syncDaysBack, 100, includeShared);
  return docs.map((doc) => ({ doc }));
}

/**
 * Computes the `updated_after` / `created_after` window for the API list call.
 *
 * - `full` mode: no window (paginate everything Granola exposes).
 * - `standard` mode + recent `latestSyncTime`: use `updated_after = latestSyncTime`.
 * - `standard` mode without `latestSyncTime`: use `created_after = now() - syncDaysBack`.
 *
 * Returning an object with at most one bound keeps the API call simple and
 * matches Granola's filter semantics (server treats absent params as "no
 * lower bound").
 */
export function computeApiFetchWindow(
  settings: GranolaSyncSettings,
  options: FetcherOptions
): { createdAfter?: string; updatedAfter?: string } {
  if (options.mode === "full") return {};

  if (options.latestSyncTime && options.latestSyncTime > 0) {
    return { updatedAfter: new Date(options.latestSyncTime).toISOString() };
  }

  const daysBack = settings.syncDaysBack;
  if (!daysBack || daysBack <= 0) return {};

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  return { createdAfter: cutoff.toISOString() };
}

async function fetchApiKey(
  apiKey: string,
  settings: GranolaSyncSettings,
  options: FetcherOptions
): Promise<FetchedDoc[]> {
  const window = computeApiFetchWindow(settings, options);
  log.debug(
    `documentFetcher (api_key) — window=${JSON.stringify(window)}, mode=${options.mode}`
  );

  const summaries = await listAllNotes(apiKey, window);
  log.debug(`documentFetcher (api_key) — list returned ${summaries.length} note(s)`);

  const out: FetchedDoc[] = [];
  const includeTranscripts = options.includeTranscripts ?? settings.syncTranscripts;

  for (const summary of summaries) {
    const summaryDoc = adaptPublicNoteSummary(summary);
    const knownUpdated = options.knownUpdatedAtByGranolaId?.get(summaryDoc.id);

    // List-level gate: when we already have this note locally and the API's
    // updated_at hasn't moved, skip the Get Note call entirely. This is the
    // dominant cost saver on large vaults (N+1 → N).
    if (
      knownUpdated &&
      summary.updated_at &&
      timestampsEqual(summary.updated_at, knownUpdated)
    ) {
      log.debug(
        `documentFetcher gate — skipping Get Note for ${summaryDoc.id} (updated_at unchanged)`
      );
      continue;
    }

    try {
      const full = await getNote(apiKey, summary.id, {
        includeTranscript: includeTranscripts,
      });
      const adapted = adaptPublicNoteToGranolaDoc(full);
      const folders = extractFoldersFromMembership(full);
      const apiTranscript = includeTranscripts
        ? adaptTranscript(adapted.id, full.transcript)
        : undefined;
      out.push({
        doc: adapted,
        folders,
        folderMembership: full.folder_membership,
        apiTranscript,
        publicId: adapted._publicId,
        webUrl: adapted._webUrl,
      });
    } catch (e) {
      if (e instanceof PublicApiError && e.status === 404) {
        log.debug(
          `documentFetcher (api_key) — 404 for note ${summary.id}; treating as missing`
        );
        continue;
      }
      // Propagate so the orchestrator surfaces an error to the user (esp 401).
      throw e;
    }
  }
  return out;
}

/**
 * Tolerant timestamp comparison. Two ISO strings represent the same instant
 * if their parsed dates are equal. We compare by parsed milliseconds so
 * trailing-zero / timezone-offset differences don't cause a spurious miss.
 */
function timestampsEqual(a: string, b: string): boolean {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return a === b;
  return da === db;
}

/**
 * Convenience: in API-key mode the transcript is fetched in the same call as
 * the note. This shim lets callers ask for the transcript by docId without
 * caring whether they're in desktop or API mode.
 *
 * @param fetched - The {@link FetchedDoc} produced by {@link fetchDocumentsForSync}.
 * @param auth - Active auth so we know how to fall back when the API path didn't include the transcript.
 * @param desktopFetcher - Pulled-in callback so this module doesn't drag in the desktop client when it isn't needed. Defaults to {@link fetchGranolaTranscript}.
 */
export async function fetchTranscriptFor(
  fetched: FetchedDoc,
  auth: AuthResult,
  desktopFetcher: (
    token: string,
    docId: string
  ) => Promise<TranscriptEntry[]> = fetchGranolaTranscript
): Promise<TranscriptEntry[]> {
  if (fetched.apiTranscript !== undefined) return fetched.apiTranscript;
  if (auth.method === "desktop") {
    return desktopFetcher(auth.token, fetched.doc.id);
  }
  // API key mode but we didn't request transcripts up front. Caller should
  // have set includeTranscripts; nothing else we can do here.
  return [];
}
