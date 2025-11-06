# Contributing

## Testing Changes

- Make changes
- Set env var `DEV_PLUGIN_PATH` to the Obsidian plugin dir. On macOS that is `~/Documents/Obsidian Vault/.obsidian/plugins/obsidian-granola-sync/main.js`
- Use `npm run dev`
- Either restart Obsidian between changes, or use the [hot reload plugin](https://github.com/pjeby/hot-reload)
- Test changes worked in Obsidian

## Testing Validation Schemas

You can fetch real API data from Granola and test validation schemas against it:

- Fetch API responses using `scripts/fetch-api-response.js`:
  - For docs: `node scripts/fetch-api-response.js docs > docs/api-response/my-response.json`
  - For transcripts: `node scripts/fetch-api-response.js transcripts <docId> > docs/api-response/my-transcript.json`
- Store responses in `docs/api-response` (this directory is gitignored)
- Test validation against the stored data: `node scripts/test-validation.js docs/api-response/my-response.json`

