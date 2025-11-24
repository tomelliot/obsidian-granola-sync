# Obsidian Granola Sync

[![Release](https://github.com/tomelliot/obsidian-granola-sync/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/tomelliot/obsidian-granola-sync/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/tomelliot/obsidian-granola-sync/graph/badge.svg?token=UALN2224PQ)](https://codecov.io/gh/tomelliot/obsidian-granola-sync)

This plugin allows you to synchronize your notes and transcripts from Granola (https://granola.ai) directly into your Obsidian vault. It fetches documents from Granola, converts them from ProseMirror JSON format to Markdown, and saves them as `.md` files.

## Features

- Sync Granola notes to your Obsidian vault
- Sync Granola transcripts to your vault, with flexible destination options
- Support for syncing to daily notes, a dedicated folder, or a daily note folder structure
- Automatic bidirectional linking between notes and transcripts when using individual files
- Periodic automatic syncing with customizable interval
- Granular settings for notes and transcripts
- Customizable sync settings and destinations
- **Platform support:** This plugin only works on desktop. It is not supported on mobile.

## Installation

1. Go to [https://obsidian.md/plugins?search=granola](https://obsidian.md/plugins?search=granola)
2. Click Install

## Configuration

> **Note:** Granola credentials are fetched by the plugin using a local web server that temporarily serves your credentials file to the plugin. You can review the implementation of this mechanism in [`src/services/credentials.ts`](src/services/credentials.ts).

1. Configure note syncing:
   - Choose whether to sync notes
   - Select the destination: a specific folder, daily notes, or daily note folder structure
   - Optionally set a section heading for daily notes
2. Configure transcript syncing:
   - Choose whether to sync transcripts
   - Select the destination: a dedicated transcripts folder or daily note folder structure
3. Set up periodic sync and adjust the interval as desired

## Frontmatter Structure

All synced files include structured frontmatter for tracking and identification:

**Notes:**
```yaml
---
granola_id: doc-123
title: "Meeting Title"
type: note
created_at: 2024-01-15T10:00:00Z
updated_at: 2024-01-15T12:00:00Z
attendees:
  - John Doe
  - Jane Smith
transcript: "[[Transcripts/Meeting Title-transcript.md]]"
---
```

**Transcripts:**
```yaml
---
granola_id: doc-123
title: "Meeting Title - Transcript"
type: transcript
created_at: 2024-01-15T10:00:00Z
updated_at: 2024-01-15T12:00:00Z
attendees:
  - John Doe
  - Jane Smith
note: "[[Granola/Meeting Title.md]]"
---
```

The `granola_id` is consistent across both note and transcript files for the same source document, while the `type` field distinguishes between them. This allows both file types to coexist with proper duplicate detection.

### Frontmatter Fields

- `granola_id`: Unique identifier from Granola, consistent across note and transcript files
- `title`: Document title (with "- Transcript" suffix for transcripts)
- `type`: Either `note` or `transcript`
- `created_at`: ISO timestamp when the document was created
- `updated_at`: ISO timestamp when the document was last updated
- `attendees`: Array of attendee names from the meeting
- `transcript`: Wiki-style link to the transcript file (only in notes saved as individual files, not in daily notes)
- `note`: Wiki-style link to the note (in transcripts, links to individual files or daily notes with heading anchors)

The `transcript` field is added when notes are saved as individual files and transcripts are synced. The `note` field is always added to transcripts when notes are being synced - for individual note files, it links to the file path; for daily notes, it links to the daily note file with a heading anchor (e.g., `[[2024-01-15#Meeting Title]]`).

### Legacy Format Migration

If you have existing files from a previous version, the plugin will automatically migrate them on load:
- Remove `-transcript` suffix from `granola_id` in transcript files
- Add `type` field to all files
- Add timestamps to transcript files (when available)

This migration runs silently in the background and only affects files that need updating.

## Documentation

For detailed information about how the sync process works, see [Sync Process Documentation](docs/sync-process.md). This document explains the credentials loading, document fetching, note syncing, transcript syncing, frontmatter structure, file deduplication, and error handling mechanisms.

## Development

### Prerequisites

- Node.js 18 or later
- npm

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Building

To build the plugin:
```bash
npm run build
```

### Testing

The plugin uses Jest for testing. To run the tests:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

For detailed testing information, including testing strategy and development workflow, see [CONTRIBUTING.md](CONTRIBUTING.md).

### Releasing

To create a release:

```bash
# Auto-bump patch version
node scripts/release.js

# Specify a specific version
node scripts/release.js 1.2.3
```

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for info on contributing to this project.

## License

MIT
