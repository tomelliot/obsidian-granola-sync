import * as v from "valibot";

/**
 * Valibot schemas for Granola's Public API (public-api.granola.ai).
 *
 * These intentionally accept a superset of fields the plugin uses (via
 * `v.looseObject`) so future API additions don't break sync. The plugin
 * still asserts on the fields it depends on.
 *
 * Source: https://docs.granola.ai/api-reference/list-notes
 *         https://docs.granola.ai/api-reference/get-note
 *         https://docs.granola.ai/api-reference/list-folders
 */

const OwnerSchema = v.looseObject({
  id: v.optional(v.string()),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
});

const AttendeeSchema = v.looseObject({
  name: v.optional(v.string()),
  email: v.optional(v.string()),
});

/**
 * Public folder membership entry. Field names confirmed against live API:
 * - `id` (e.g. `fol_EcATHi5XhKY6nr`)
 * - `name` (the folder title)
 * - `parent_folder_id` (nullable)
 * - `object: "folder"` discriminator (Granola includes this on most objects)
 */
const FolderMembershipEntrySchema = v.looseObject({
  id: v.string(),
  name: v.string(),
  parent_folder_id: v.nullish(v.string()),
  object: v.optional(v.string()),
});

/**
 * Public transcript entry shape. Field names confirmed against live API:
 * `start_time` / `end_time` (ISO datetimes), `speaker.source` values include
 * `"microphone"` (user's own audio) and `"speaker"` (other parties via the
 * device speakers). Diarization label is optional. The adapter normalizes
 * this into the internal `TranscriptEntry` shape used by the formatter.
 */
const PublicTranscriptEntrySchema = v.looseObject({
  id: v.optional(v.string()),
  start_time: v.optional(v.string()),
  end_time: v.optional(v.string()),
  text: v.string(),
  speaker: v.optional(
    v.looseObject({
      source: v.optional(v.string()),
      diarization_label: v.optional(v.string()),
    })
  ),
});

/**
 * Note summary as returned by `GET /v1/notes` (list endpoint). The list
 * endpoint omits `summary_markdown`, `transcript`, `folder_membership`, and
 * `web_url` — those require a follow-up `GET /v1/notes/{id}` call. The spec
 * marks `id`, `object`, `title`, `owner`, `created_at`, `updated_at` as
 * required; we use `looseObject` so future server additions don't break us.
 */
export const PublicNoteSummarySchema = v.looseObject({
  id: v.string(),
  object: v.optional(v.string()),
  title: v.nullish(v.string()),
  created_at: v.nullish(v.string()),
  updated_at: v.nullish(v.string()),
  owner: v.nullish(OwnerSchema),
});

/**
 * `GET /v1/notes` response. Spec uses camelCase `hasMore` and bare `cursor`
 * (not `next_cursor`). Locking these names exactly — pagination depends on
 * them.
 */
export const PublicListNotesResponseSchema = v.looseObject({
  notes: v.array(PublicNoteSummarySchema),
  cursor: v.nullish(v.string()),
  hasMore: v.optional(v.boolean()),
});

/**
 * Full note as returned by `GET /v1/notes/{id}`. `transcript` is only present
 * when `?include=transcript` is requested. `summary_markdown` is the canonical
 * note body for API-key auth.
 */
export const PublicNoteSchema = v.looseObject({
  id: v.string(),
  title: v.nullish(v.string()),
  created_at: v.nullish(v.string()),
  updated_at: v.nullish(v.string()),
  web_url: v.nullish(v.string()),
  owner: v.nullish(OwnerSchema),
  attendees: v.optional(v.array(AttendeeSchema)),
  summary_markdown: v.nullish(v.string()),
  summary_text: v.nullish(v.string()),
  folder_membership: v.optional(v.array(FolderMembershipEntrySchema)),
  transcript: v.optional(v.array(PublicTranscriptEntrySchema)),
});

/**
 * Folder shape from `GET /v1/folders`. Spec field name is `parent_folder_id`
 * (not `parent_id`), matching the folder_membership shape on Get Note.
 */
const PublicFolderSchema = v.looseObject({
  id: v.string(),
  object: v.optional(v.string()),
  name: v.string(),
  parent_folder_id: v.nullish(v.string()),
});

/**
 * `GET /v1/folders` response. Same pagination contract as list-notes:
 * camelCase `hasMore`, bare `cursor`.
 */
export const PublicListFoldersResponseSchema = v.looseObject({
  folders: v.array(PublicFolderSchema),
  cursor: v.nullish(v.string()),
  hasMore: v.optional(v.boolean()),
});

// Type exports for use by the adapter and client.
export type PublicNoteSummary = v.InferOutput<typeof PublicNoteSummarySchema>;
export type PublicNote = v.InferOutput<typeof PublicNoteSchema>;
export type PublicTranscriptEntry = v.InferOutput<
  typeof PublicTranscriptEntrySchema
>;
export type PublicFolderMembershipEntry = v.InferOutput<
  typeof FolderMembershipEntrySchema
>;
export type PublicFolder = v.InferOutput<typeof PublicFolderSchema>;
export type PublicListNotesResponse = v.InferOutput<
  typeof PublicListNotesResponseSchema
>;
export type PublicListFoldersResponse = v.InferOutput<
  typeof PublicListFoldersResponseSchema
>;
