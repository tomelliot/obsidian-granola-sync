import type { GranolaDoc, TranscriptEntry } from "./granolaTypes";
import type {
  PublicNote,
  PublicNoteSummary,
  PublicTranscriptEntry,
  PublicFolderMembershipEntry,
} from "./publicApiSchemas";
import { log } from "../utils/logger";

/**
 * Adapter: maps Granola Public API shapes (`public-api.granola.ai`) into the
 * internal `GranolaDoc` / `TranscriptEntry` shapes the rest of the plugin
 * already speaks.
 *
 * Design notes:
 *
 * - `summary_markdown` becomes `last_viewed_panel.content` as a markdown
 *   string. Downstream code in `documentProcessor` already accepts string
 *   content (used by the desktop API for HTML).
 * - `folder_membership` is normalized to flat `"A/B/C"` slashed paths and
 *   exposed via {@link extractFoldersFromMembership} for the sync pipeline.
 *   Paths are sorted to keep frontmatter writes deterministic (no spurious
 *   diffs).
 * - We never write the `not_*` id into `granola_id`; the `web_url` UUID is
 *   the canonical identity, preserved by extracting it via
 *   {@link extractLegacyIdFromWebUrl}.
 *
 * The adapter is pure (no I/O), so tests can drive it directly from
 * fixture JSON.
 */

/**
 * Extracts the legacy UUID from a Public API `web_url`. The desktop API
 * returns this same UUID as `doc.id` and stores it in vault frontmatter as
 * `granola_id`, so this is the "bridge" that lets API-mode sync update
 * existing files in place.
 *
 * Returns null when the URL is missing or doesn't match the expected shape.
 */
export function extractLegacyIdFromWebUrl(
  webUrl: string | null | undefined
): string | null {
  if (!webUrl) return null;
  const m = webUrl.match(
    /\/d\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return m ? m[1] : null;
}

/**
 * Builds a `parent_id → child` map and walks it to produce slashed paths.
 * If a parent reference is missing or cyclical, the offending node becomes
 * a root.
 */
export function membershipToFolderPaths(
  membership: PublicFolderMembershipEntry[] | undefined
): string[] {
  if (!membership || membership.length === 0) return [];

  const byId = new Map<string, PublicFolderMembershipEntry>();
  for (const entry of membership) byId.set(entry.id, entry);

  const paths: string[] = [];
  for (const entry of membership) {
    const parts: string[] = [];
    let cursor: PublicFolderMembershipEntry | undefined = entry;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      parts.unshift(cursor.name);
      if (!cursor.parent_folder_id) break;
      cursor = byId.get(cursor.parent_folder_id);
    }
    paths.push(parts.join("/"));
  }

  // Dedupe + sort so the frontmatter is byte-stable across syncs.
  return Array.from(new Set(paths)).sort();
}

/**
 * Returns the slashed folder paths for a `PublicNote`. Empty array when the
 * note has no folder membership.
 */
export function extractFoldersFromMembership(note: PublicNote): string[] {
  return membershipToFolderPaths(note.folder_membership);
}

/**
 * Maps a public transcript source value to the internal `source` field used
 * by {@link formatTranscriptBody}, which treats `"microphone"` as "You" and
 * everything else as "Guest".
 */
function mapPublicSpeakerSource(source: string | undefined): string {
  if (source === "me" || source === "microphone") return "microphone";
  return source ?? "guest";
}

/**
 * Maps the Public API transcript array to internal `TranscriptEntry[]`.
 * Discards entries with empty text. Fills in best-effort defaults for the
 * fields internal formatters require (`is_final`, `document_id`, etc.).
 */
export function adaptTranscript(
  documentId: string,
  publicTranscript: PublicTranscriptEntry[] | undefined
): TranscriptEntry[] {
  if (!publicTranscript) return [];
  const out: TranscriptEntry[] = [];
  let droppedEmpty = 0;
  for (let i = 0; i < publicTranscript.length; i++) {
    const entry = publicTranscript[i];
    if (!entry.text || entry.text.trim().length === 0) {
      droppedEmpty++;
      continue;
    }
    out.push({
      id: entry.id ?? `${documentId}-${i}`,
      document_id: documentId,
      start_timestamp: entry.start_time ?? "",
      end_timestamp: entry.end_time ?? "",
      text: entry.text,
      source: mapPublicSpeakerSource(entry.speaker?.source),
      is_final: true,
    });
  }
  if (droppedEmpty > 0) {
    log.debug(
      `adaptTranscript — dropped ${droppedEmpty} empty/whitespace-only transcript entry/entries for doc ${documentId}`
    );
  }
  return out;
}

/**
 * Maps a full {@link PublicNote} to the internal {@link GranolaDoc} shape.
 *
 * The `GranolaDoc.id` is intentionally the legacy UUID extracted from
 * `web_url` when available. This preserves dedup with vault files synced via
 * desktop auth (their `granola_id` is the UUID). When no UUID can be
 * extracted (legacy / unusual notes), we fall back to the `not_*` id — sync
 * will treat that as a new file, which is the safe default.
 *
 * The original `not_*` id is preserved on the returned object as
 * `_publicId` (a non-API extension field) so the sync pipeline can record
 * it on frontmatter and the cache.
 */
export function adaptPublicNoteToGranolaDoc(
  note: PublicNote
): GranolaDoc & { _publicId: string; _webUrl: string | null } {
  const legacyId = extractLegacyIdFromWebUrl(note.web_url ?? null);

  const attendees = note.attendees?.map((a) => ({
    name: a.name,
    email: a.email,
  }));

  // Public API gives us a markdown summary, not ProseMirror. Pass it through
  // as a string — documentProcessor.buildNoteBody already handles strings
  // (used by the desktop API for HTML).
  const body = note.summary_markdown ?? note.summary_text ?? null;

  return {
    id: legacyId ?? note.id,
    title: note.title ?? null,
    created_at: note.created_at ?? undefined,
    updated_at: note.updated_at ?? undefined,
    people: attendees ? { attendees } : undefined,
    last_viewed_panel: body
      ? {
          content: body,
          updated_at: note.updated_at ?? null,
        }
      : null,
    _publicId: note.id,
    _webUrl: note.web_url ?? null,
  };
}

/**
 * Lightweight adaptation from list-endpoint results (no body, no folders).
 * Used when sync only needs metadata for the `isRemoteNewer` gate before
 * deciding whether to fetch the full note.
 *
 * Note: the Public API list endpoint does NOT include `web_url`, so this
 * function always falls back to the `not_*` id for `GranolaDoc.id`. The
 * legacy-UUID bridge runs later via {@link adaptPublicNoteToGranolaDoc} on
 * the Get Note response, which does carry `web_url`.
 */
export function adaptPublicNoteSummary(
  summary: PublicNoteSummary
): GranolaDoc & { _publicId: string; _webUrl: string | null } {
  return {
    id: summary.id,
    title: summary.title ?? null,
    created_at: summary.created_at ?? undefined,
    updated_at: summary.updated_at ?? undefined,
    _publicId: summary.id,
    _webUrl: null,
  };
}
