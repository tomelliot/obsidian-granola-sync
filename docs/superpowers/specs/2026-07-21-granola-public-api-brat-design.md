# Granola Public API + BRAT Plugin — Design

**Date:** 2026-07-21
**Repo:** `kayacancode/obsidian-granola-sync` (fork of Tom Elliot's Granola Sync)
**Status:** Approved approach B — full replacement of local-credential auth with a user-supplied API key, rebranded as a new plugin, distributed via BRAT first.

## Goal

Replace the current authentication path — reading the Granola desktop app's local
credential store (`stored-accounts.json.enc` decrypted via macOS Keychain / Windows
DPAPI / Linux keyring) and calling Granola's internal `api.granola.ai/v2` API — with
the official Granola public API (`https://public-api.granola.ai/v1`) authenticated by
an API key the user pastes into plugin settings. Ship it as a BRAT-installable beta
under a new plugin identity.

## Plugin identity (BRAT)

- `manifest.json`: id `granola-api-sync`, name **Granola API Sync**, author Kaya Jones,
  version reset to `0.1.0`, original `fundingUrl`/`authorUrl` removed. Description:
  "Sync Granola meeting notes into your vault using the official Granola API."
- `versions.json` reset to `{ "0.1.0": "1.5.7" }`.
- BRAT install path: users add `kayacancode/obsidian-granola-sync` in BRAT; a GitHub
  release tagged with the version contains `manifest.json`, `main.js`, `styles.css`.
  The existing `scripts/release.js` + `.github/workflows/release.yml` are kept,
  adjusted for the new id/version scheme.
- Because the id changes, the plugin installs alongside (not over) the original
  community plugin. README gains a BRAT install section and tells users to disable
  the original Granola Sync to avoid double-syncing.
- `isDesktopOnly`: attempt to set `false` — with the credential/fs code gone the
  plugin should be pure `requestUrl` + Vault API. Verify no remaining Node imports
  (`fs`, `path`, `os`, `child_process`) after deletion; if any remain in kept code,
  keep `true` for 0.1.0 and note it as follow-up.

## Authentication & settings

- New setting `apiKey: string` (default `""`), stored in the plugin's `data.json`
  like other Obsidian plugin settings.
- Settings UI: password-type text input at the top of the settings tab, with the
  hint "Create a key in Granola → Settings → Connectors → API keys (scope: Personal
  notes)" and a **Test connection** button that calls `GET /v1/notes?page_size=1`
  and shows a success/failure notice (401 → "Invalid API key"; network error →
  "Could not reach Granola").
- Sync refuses to start with a notice if the key is empty; a 401 during sync aborts
  with a "check your API key" notice.
- Deleted: `credentials.ts`, `granolaCredentialsCrypto.ts`, `dpapiLoader.ts`,
  `keyringLoader.ts`, `credentialsErrorPresenter.ts`, `ui/keychainPermissionModal.ts`,
  `scripts/generateEmbeddedDpapiBinaries.mjs`, `scripts/generateEmbeddedKeyringBinaries.mjs`,
  and the `embed-binaries`/`postinstall` package scripts.

## API client (`granolaApi.ts` rewrite)

- Base URL `https://public-api.granola.ai/v1`, header `Authorization: Bearer <key>`,
  plus the existing `X-Client-Version` / `User-Agent` convention with the new
  plugin name.
- `listNotes({ created_after?, folder_id?, cursor?, page_size: 30 })` — loops the
  cursor until `hasMore` is false. `syncDaysBack` maps to `created_after`.
- `getNote(id, { includeTranscript })` — `GET /v1/notes/{id}?include=transcript`
  when transcript sync is enabled.
- `listFolders()` — `GET /v1/folders`, cursor-paginated; feeds `folderMapBuilder`.
  Notes also carry `folder_membership` inline, which `folderMapBuilder` can use
  directly and simplify.
- Rate limiting: public API allows bursts of 25 requests / 5 s, 5 req/s sustained.
  The client inserts a ~250 ms delay between sequential requests (relevant when
  fetching transcripts per note) and on `429` waits (honoring `Retry-After` if
  present, else 2 s exponential backoff, max 3 retries).
- New valibot schemas for the v1 `Note`, `Folder`, list envelopes
  (`notes`/`folders`, `hasMore`, `cursor`), and transcript entries. Old v2 schemas
  removed.

## Content mapping

- Note body: `summary_markdown`, falling back to `summary_text`. The ProseMirror →
  markdown pipeline is deleted (`prosemirrorMarkdown.ts`, `htmlMarkdown.ts` if no
  remaining callers).
- Frontmatter keeps today's fields: `granola_id` (now the `not_…` id), `title`,
  `created`, `updated`, `attendees`, `transcript` link. New: `web_url`.
- Transcript files: built from the v1 transcript array (speaker source, text,
  timestamp) through the existing `transcriptFormatter`.
- Removed setting: `includePrivateNotes` (the public API returns AI summaries only;
  access is governed by the key's scope). `includeSharedNotes` maps to whether
  shared-folder notes are synced (key scope + folder filtering). A settings
  migration in `settings.ts` drops the dead field.

## Duplicate prevention on migration

Files are deduped by `granola_id` frontmatter, but public-API ids (`not_…`) differ
from the old internal UUIDs, so a naive switch would duplicate every previously
synced note. Mitigation in `fileSyncService`:

1. Look up by new `granola_id` (existing behavior).
2. If not found, compute the target path (filename pattern is deterministic) and
   check for an existing file there. If one exists **and has a `granola_id`
   frontmatter field** (i.e., it was created by a Granola sync plugin), update it
   in place and rewrite its `granola_id` to the new id.
3. Otherwise create a new file (existing collision handling stands).

## Behavior changes (README + release notes)

- Users must create an API key (enterprise workspaces need admin enablement).
- Only meetings with a generated AI summary + transcript are returned by the API;
  the user's own typed notes no longer sync.
- The Granola desktop app is no longer required on the machine running Obsidian.

## Testing

- Delete credential/crypto/keyring test suites.
- New tests: API client (cursor pagination, 429 retry/backoff, 401 handling,
  schema validation against recorded v1 fixtures), document processor
  (`summary_markdown` body, frontmatter incl. `web_url`), settings migration
  (dropping `includePrivateNotes`), and the path-fallback dedupe in
  `fileSyncService`.
- Manual verification: BRAT install from a tagged pre-release into a test vault,
  paste key, run sync, confirm notes/transcripts/folders/daily-note links.

## Out of scope

- Submitting to the Obsidian community plugin directory (BRAT first; community
  submission is a later step).
- Workspace-level API keys (personal keys only for 0.1.0; workspace keys should
  work incidentally since auth is just a bearer header).
- Syncing user-typed private notes (not available in the public API).
