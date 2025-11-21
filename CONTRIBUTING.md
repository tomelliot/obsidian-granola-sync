# Contributing

## Getting Started

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## Project Philosophy

When contributing to this plugin, please keep these core principles in mind:

1. **Keep the codebase minimal:**
   - We don't add features for uncommon or edge use-cases
   - Feel free to fork the project for specialized use cases!

2. **Preserve content integrity:**
   - Content of notes and transcripts should match what is stored in Granola
   - Don't add extra information to the body of notes or transcripts
   - Use frontmatter to store additional metadata (e.g. links between notes and transcripts)

3. **Maintain code quality:**
   - PRs should never reduce test coverage
   - New functionality should come with new tests

## Testing Strategy

The plugin uses a combination of unit and integration tests:

1. **Unit Tests:**
   - Test individual service classes and utilities in isolation
   - Mock external dependencies
   - Focus on business logic

2. **Integration Tests:**
   - Test interactions between components
   - Test file system operations
   - Test API integration

### Adding New Tests

1. Create a new test file in the appropriate test directory
2. Follow the existing test patterns
3. Use Jest's mocking capabilities for external dependencies
4. Run tests to ensure they pass

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
- Test validation against the stored data: `node scripts/test-validation.ts docs/api-response/my-response.json`

