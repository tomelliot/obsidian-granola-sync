# Granola API Sync for Obsidian

Sync your [Granola](https://granola.ai) meeting notes and transcripts into your Obsidian vault as plain Markdown — searchable, linkable, and yours to keep — using the **official Granola API** with an API key you create yourself.

This plugin is a fork of [Tom Elliot's Granola Sync](https://github.com/tomelliot/obsidian-granola-sync), rebuilt on Granola's public API. The original plugin reads the Granola desktop app's local credential store; this fork authenticates with a personal API key instead, which means:

- **No desktop app required** on the machine running Obsidian — the plugin talks straight to `public-api.granola.ai`.
- **No keychain/DPAPI prompts** and no credential decryption — just paste a key.
- **AI summaries as the source of truth** — note bodies come from Granola's `summary_markdown`.

## What changed with the official API

Note bodies are now Granola's AI-generated summary (`summary_markdown`) rather than a conversion of the raw note content, so your own typed notes no longer sync and only meetings with a finished AI summary and transcript come through. Auth is a `grn_` API key you paste into settings instead of the plugin decrypting the desktop app's local credentials — meaning no Keychain prompts and no need for Granola to be installed on the machine, but also no private/shared-notes toggles (your key's scope controls access) and no image attachments.

## Installation (BRAT beta)

This plugin is currently distributed via [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. In Obsidian, install **BRAT** from Community Plugins and enable it.
2. Run the command **BRAT: Add a beta plugin for testing** (or BRAT settings → *Add beta plugin*).
3. Enter `kayacancode/obsidian-granola-sync` and install.
4. Enable **Granola API Sync** in Settings → Community plugins.

## Setup

1. In the Granola desktop app, go to **Settings → Connectors → API keys** and create a new key with the **Personal notes** scope. (Enterprise workspaces need an admin to enable API keys first.)
2. In Obsidian, open the plugin settings and paste the key (`grn_…`) into **Granola API key**.
3. Click **Test connection** to confirm it works.
4. Run the command **Sync from Granola**, or enable periodic sync.

## What syncs

- Meetings that have a **generated AI summary and transcript** — that's what the public API returns. Notes still processing (or without a summary) are skipped until Granola finishes them.
- The note body is the **AI-enhanced summary** (`summary_markdown`). Your own raw typed notes are not exposed by the public API and no longer sync.
- **Transcripts** (optional), with speaker names when Granola can identify them.
- **Folders**: notes carry their Granola folder membership in frontmatter, including nested paths.
- Attendees, timestamps, and a `web_url` link back to the note in the Granola web app.

## Migrating from Granola Sync

If you used the original Granola Sync plugin:

- **Disable the original plugin** to avoid double-syncing into the same folders.
- Your existing synced files are **updated in place, not duplicated**. The public API uses new note IDs, but each note's `web_url` carries the old internal ID, so the first sync re-keys existing files (matched by their `granola_id` frontmatter, with a target-path fallback) to the new IDs.
- The "Include private notes" and "Include shared notes" settings were removed — access is governed by your API key's scope instead.

### Carrying over your settings

Your folder choices, filename patterns, transcript handling, sync interval, and filters can be copied straight from the original plugin — each plugin stores its settings at `.obsidian/plugins/<plugin-id>/data.json` inside your vault:

1. Install Granola API Sync via BRAT and enable it once (this creates the `.obsidian/plugins/granola-api-sync/` folder), then **disable it** — Obsidian writes settings on unload, so copying while it's active can get overwritten.
2. Copy the old settings file over the new one (show hidden files in Finder with `Cmd+Shift+.`, or use a terminal):

   ```bash
   cp "<YourVault>/.obsidian/plugins/granola-sync/data.json" \
      "<YourVault>/.obsidian/plugins/granola-api-sync/data.json"
   ```

3. Re-enable Granola API Sync and paste your API key in its settings.

The plugin cleans up the copied file automatically: removed settings are deleted on load, the API key starts empty until you paste one, and the old plugin's cached folder map is replaced on the first sync.

## Features

- Sync notes to daily-note sections or individual files, with configurable folders, subfolder patterns, and filename patterns
- Transcript syncing: separate files, same location as notes, or combined into the note
- Automatic bidirectional linking between notes and transcripts
- Periodic automatic syncing with a customizable interval
- Title-based include/exclude filtering and a sync-history window
- Rate-limit aware: batches requests within the public API's limits and retries on `429`
- **Platform support:** desktop only for now.

## Frontmatter structure

All synced files include structured frontmatter for tracking and deduplication:

**Notes:**
```yaml
---
granola_id: not_1d3tmYTlCICgjy
title: "Meeting Title"
type: note
created: 2024-01-15T10:00:00Z
updated: 2024-01-15T12:00:00Z
attendees:
  - John Doe
  - Jane Smith
web_url: https://notes.granola.ai/d/f3e45e0f-24cc-480b-9a6c-8b1f5e3d7a2c
transcript: "[[Transcripts/Meeting Title-transcript.md]]"
---
```

**Transcripts:**
```yaml
---
granola_id: not_1d3tmYTlCICgjy
title: "Meeting Title - Transcript"
type: transcript
created: 2024-01-15T10:00:00Z
updated: 2024-01-15T12:00:00Z
attendees:
  - John Doe
  - Jane Smith
note: "[[Granola/Meeting Title.md]]"
---
```

The `granola_id` is consistent across both note and transcript files for the same meeting, while the `type` field distinguishes them.

## Development

### Prerequisites

- Node.js 18 or later
- pnpm

### Setup and building

```bash
pnpm install
pnpm build
```

### Testing

```bash
pnpm test            # run all tests
pnpm test:watch      # watch mode
pnpm test:coverage   # with coverage
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for more.

### Releasing

```bash
node scripts/release.js        # auto-bump patch version
node scripts/release.js 0.2.0  # specific version
```

## Credits

Forked from [tomelliot/obsidian-granola-sync](https://github.com/tomelliot/obsidian-granola-sync) — the sync engine, path resolution, daily-note handling, and test suite come from that project.

## License

MIT

## Disclaimer

This plugin is an independent project and is not affiliated with, endorsed by, or sponsored by Granola. It uses Granola's official public API with an API key you create in your own account. Do not use this plugin in any way that breaks [Granola's Terms of Service](https://www.granola.ai/terms) — you are responsible for ensuring your use complies with them.
