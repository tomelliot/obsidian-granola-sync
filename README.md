# Obsidian Granola Sync

[![Tests](https://github.com/tomelliot/obsidian-granola-sync/actions/workflows/release.yml/badge.svg)](https://github.com/tomelliot/obsidian-granola-sync/actions/workflows/release.yml)

This plugin allows you to synchronize your notes and transcripts from Granola (https://granola.ai) directly into your Obsidian vault. It fetches documents from Granola, converts them from ProseMirror JSON format to Markdown, and saves them as `.md` files.

Inspired by [Automatt/obsidian-granola-sync/](https://github.com/Automatt/obsidian-granola-sync/)

## Features

- Sync Granola notes to your Obsidian vault
- Sync Granola transcripts to your vault, with flexible destination options
- Support for syncing to daily notes, a dedicated folder, or a daily note folder structure
- Option to create links between notes and their transcripts
- Periodic automatic syncing with customizable interval
- Granular settings for notes and transcripts
- Customizable sync settings and destinations
- **Platform support:** This plugin only works on **macOS**. It is **not supported on iOS**.

## Installation

1. Download the latest release from the releases page
2. Extract the zip file into your Obsidian plugins folder
3. Enable the plugin in Obsidian settings

## Configuration

> **Note:** Granola credentials are fetched by the plugin using a local web server that temporarily serves your credentials file to the plugin. You can review the implementation of this mechanism in [`src/services/credentials.ts`](src/services/credentials.ts).

1. Set the path to your Granola token file in the plugin settings
2. Configure note syncing:
   - Choose whether to sync notes
   - Select the destination: a specific folder, daily notes, or daily note folder structure
   - Optionally set a section heading for daily notes
3. Configure transcript syncing:
   - Choose whether to sync transcripts
   - Select the destination: a dedicated transcripts folder or daily note folder structure
   - Optionally enable linking from notes to their transcripts
4. Set up periodic sync and adjust the interval as desired

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

### Testing Strategy

The plugin uses a combination of unit and integration tests:

1. Unit Tests:
   - Test individual service classes and utilities in isolation
   - Mock external dependencies
   - Focus on business logic

2. Integration Tests:
   - Test interactions between components
   - Test file system operations
   - Test API integration

### Adding New Tests

1. Create a new test file in the appropriate test directory
2. Follow the existing test patterns
3. Use Jest's mocking capabilities for external dependencies
4. Run tests to ensure they pass

### Releasing

To create a release:

```bash
# Auto-bump patch version
node scripts/release.js

# Specify a specific version
node scripts/release.js 1.2.3
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT
