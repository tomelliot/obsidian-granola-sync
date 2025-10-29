# Granola Sync Process Documentation

This document explains how the Granola Sync plugin synchronizes notes and transcripts from Granola to Obsidian.

## Overview

The sync process retrieves documents and transcripts from the Granola API and saves them to the Obsidian vault. The plugin supports multiple sync destinations and handles deduplication through Granola ID tracking.

## High-Level Sync Flow

```mermaid
flowchart TD
    A[Sync Triggered] --> B[Load Credentials]
    B --> C{Credentials Loaded?}
    C -->|No| D[Show Error Notice]
    C -->|Yes| E[Build Granola ID Cache]
    E --> F[Fetch Documents from API]
    F --> G{Documents Found?}
    G -->|No| H[End Sync]
    G -->|Yes| I{Transcripts Enabled?}
    I -->|Yes| J[Sync Transcripts]
    I -->|No| K[Skip Transcripts]
    J --> L{Notes Enabled?}
    K --> L
    L -->|Yes| M[Sync Notes]
    L -->|No| N[End Sync]
    M --> O[Update Last Sync Time]
    O --> P[Update Status Bar]
    P --> H
```

## Credentials Loading

The plugin loads credentials from a local file via a temporary HTTP server. This approach allows secure access to credentials stored in the Granola application's data directory.

### Credentials Loading Flow

```mermaid
sequenceDiagram
    participant Plugin
    participant CredentialsService
    participant HTTPServer
    participant FileSystem
    participant GranolaApp

    Plugin->>CredentialsService: loadCredentials()
    CredentialsService->>HTTPServer: startCredentialsServer()
    HTTPServer->>HTTPServer: Listen on 127.0.0.1:2590
    HTTPServer-->>CredentialsService: Server Ready
    
    CredentialsService->>HTTPServer: GET http://127.0.0.1:2590/
    HTTPServer->>FileSystem: Read ~/Library/Application Support/Granola/supabase.json
    FileSystem-->>HTTPServer: JSON Content
    HTTPServer-->>CredentialsService: JSON Response
    
    CredentialsService->>CredentialsService: Parse workos_tokens.access_token
    CredentialsService->>HTTPServer: stopCredentialsServer()
    HTTPServer-->>HTTPServer: Server Closed
    CredentialsService-->>Plugin: { accessToken, error }
```

### Credentials Service Details

- **File Location**: `~/Library/Application Support/Granola/supabase.json`
- **Server Port**: `2590` (localhost only)
- **Token Path**: `workos_tokens.access_token` within the JSON structure
- **Server Lifecycle**: Started before each sync, closed immediately after token extraction

## Document Fetching

The plugin fetches documents from the Granola API using the loaded access token.

### API Request Flow

```mermaid
sequenceDiagram
    participant Plugin
    participant GranolaAPI
    participant GranolaServer

    Plugin->>GranolaAPI: fetchGranolaDocuments(accessToken)
    GranolaAPI->>GranolaServer: POST /v2/get-documents
    Note over GranolaAPI: Headers: Authorization Bearer token<br/>Body: {limit: 100, offset: 0,<br/>include_last_viewed_panel: true}
    GranolaServer-->>GranolaAPI: {docs: GranolaDoc[]}
    GranolaAPI->>GranolaAPI: Validate Response Structure
    GranolaAPI-->>Plugin: GranolaDoc[]
```

### Document Structure

Each `GranolaDoc` contains:
- `id`: Unique Granola document identifier
- `title`: Document title
- `created_at`: Creation timestamp (optional)
- `updated_at`: Last update timestamp (optional)
- `last_viewed_panel.content`: ProseMirror document structure (optional)

### Error Handling

The plugin handles various HTTP error codes:
- **401**: Authentication failed (token expired)
- **403**: Access forbidden
- **404**: API endpoint not found
- **500+**: Server errors
- **Other**: Network or connection errors

## Granola ID Cache

Before syncing, the plugin builds a cache mapping Granola IDs to existing Obsidian files. This enables efficient deduplication.

### Cache Building Process

```mermaid
flowchart LR
    A[Scan All Markdown Files] --> B[Read Frontmatter]
    B --> C{Has granola_id?}
    C -->|Yes| D[Add to Cache Map]
    C -->|No| E[Skip File]
    D --> F[Next File]
    E --> F
    F --> G{More Files?}
    G -->|Yes| B
    G -->|No| H[Cache Ready]
```

**Cache Structure**: `Map<granolaId, TFile>`
- Key: Granola document ID (or `{docId}-transcript` for transcripts)
- Value: Obsidian `TFile` reference

## Note Syncing

Notes can be synced to three different destinations, each with different behavior:

### Note Sync Destinations

```mermaid
flowchart TD
    A[Sync Notes] --> B{Destination Type?}
    B -->|Daily Notes| C[Group by Date]
    B -->|Daily Note Folder Structure| D[Individual Files]
    B -->|Granola Folder| D
    
    C --> E[Create/Update Daily Note]
    E --> F[Update Section with Heading]
    
    D --> G[For Each Document]
    G --> H[Convert ProseMirror to Markdown]
    H --> I[Add Frontmatter]
    I --> J[Save to Disk]
```

### Daily Notes Destination

When syncing to daily notes, documents are grouped by date and inserted into sections within daily note files.

```mermaid
flowchart TD
    A[Documents List] --> B[For Each Document]
    B --> C[Extract Date from created_at/updated_at]
    C --> D[Group by Date YYYY-MM-DD]
    D --> E[Convert ProseMirror to Markdown]
    E --> F[Add to Daily Notes Map]
    F --> G{More Documents?}
    G -->|Yes| B
    G -->|No| H[For Each Date Group]
    H --> I[Get/Create Daily Note File]
    I --> J[Build Section Content]
    J --> K[Update Section with Heading]
    K --> L{More Dates?}
    L -->|Yes| H
    L -->|No| M[Complete]
```

**Section Format**:
- Heading: User-configured section heading (trimmed)
- Each note includes:
  - H3 title
  - Granola ID
  - Created/Updated timestamps
  - Optional transcript link
  - Note content

### Individual Files Destination

When syncing to individual files (either Granola folder or daily note folder structure), each document becomes a separate markdown file.

```mermaid
flowchart TD
    A[Document] --> B[Convert ProseMirror to Markdown]
    B --> C[Prepare Frontmatter]
    C --> D[Add granola_id, title, timestamps]
    D --> E{Transcript Link Enabled?}
    E -->|Yes| F[Add Transcript Link]
    E -->|No| G[Continue]
    F --> G
    G --> H[Compute File Path]
    H --> I[Save to Disk]
```

**File Content Structure**:
1. Frontmatter with `granola_id`, `title`, `created_at`, `updated_at`
2. Optional transcript link (if enabled)
3. Note content (converted from ProseMirror)

## Transcript Syncing

Transcripts are always synced before notes (if enabled) so that note links to transcripts can be created correctly.

### Transcript Sync Flow

```mermaid
flowchart TD
    A[For Each Document] --> B[Fetch Transcript from API]
    B --> C{Transcript Found?}
    C -->|No| D[Skip Document]
    C -->|Yes| E[Format by Speaker]
    E --> F[Add Frontmatter]
    F --> G[Compute File Path]
    G --> H[Save to Disk]
    H --> I{More Documents?}
    I -->|Yes| A
    I -->|No| J[Complete]
```

### Transcript Formatting

Transcripts are grouped by speaker and formatted as markdown:

```mermaid
flowchart TD
    A[Transcript Entries] --> B[For Each Entry]
    B --> C[Determine Speaker from source]
    C --> D{Speaker Changed?}
    D -->|No| E[Append Text to Current Block]
    D -->|Yes| F[Write Previous Block]
    F --> G[Start New Block]
    E --> H{More Entries?}
    G --> H
    H -->|Yes| B
    H -->|No| I[Write Final Block]
    I --> J[Complete]
```

**Speaker Mapping**:
- `source === "microphone"` → "Tom Elliot"
- Otherwise → "Guest"

**Format**:
- Frontmatter with `granola_id: {docId}-transcript`
- H1 heading: "Transcript for: {title}"
- H2 sections: `## {Speaker} ({start_timestamp})`
- Content: Combined text entries for each speaker block

### Transcript API Request

```mermaid
sequenceDiagram
    participant Plugin
    participant GranolaAPI
    participant GranolaServer

    Plugin->>GranolaAPI: fetchGranolaTranscript(accessToken, docId)
    GranolaAPI->>GranolaServer: POST /v1/get-document-transcript
    Note over GranolaAPI: Body: {document_id: docId}
    GranolaServer-->>GranolaAPI: TranscriptEntry[]
    GranolaAPI-->>Plugin: TranscriptEntry[]
```

**TranscriptEntry Structure**:
- `document_id`: Associated document ID
- `start_timestamp`: Start time
- `end_timestamp`: End time
- `text`: Transcribed text
- `source`: Audio source ("microphone" or other)
- `id`: Entry ID
- `is_final`: Whether transcription is final

## File Saving and Deduplication

The `saveToDisk` method handles file creation, updates, and deduplication.

### Save to Disk Flow

```mermaid
flowchart TD
    A[saveToDisk Called] --> B[Determine Folder Path]
    B --> C{File Type?}
    C -->|Transcript| D[Use Transcript Destination]
    C -->|Note| E[Use Note Destination]
    D --> F[Ensure Folder Exists]
    E --> F
    F --> G{Has granolaId?}
    G -->|Yes| H[Search Cache for Existing File]
    G -->|No| I[Search by File Path]
    H --> J{File Found?}
    I --> J
    J -->|Yes| K[Update Existing File]
    J -->|No| L[Create New File]
    K --> M{Path Changed?}
    M -->|Yes| N[Attempt Rename]
    M -->|No| O[Update Cache]
    N --> O
    L --> O
    O --> P[Return Success]
```

### Deduplication Strategy

1. **Primary**: Search by Granola ID in cache
2. **Fallback**: Search by computed file path
3. **Update**: If file exists, update content
4. **Rename**: If path changed (e.g., title changed), rename file
5. **Cache Update**: Always update cache after save

### File Path Computation

Path computation depends on the destination type:

**Daily Note Folder Structure**:
- Uses daily note format settings
- Extracts folder structure from date format
- Combines with base daily notes folder

**Granola Folder / Granola Transcripts Folder**:
- Uses configured folder path directly
- Normalizes path separators

**Filename Sanitization**:
- Removes invalid characters: `<>:"/\|?*`
- Replaces spaces with underscores
- Truncates to 200 characters maximum

## Periodic Sync

The plugin supports automatic periodic syncing based on user settings.

### Periodic Sync Setup

```mermaid
stateDiagram-v2
    [*] --> Idle: Plugin Loaded
    Idle --> Enabled: isSyncEnabled && syncInterval > 0
    Enabled --> Running: Interval Triggered
    Running --> Enabled: Sync Complete
    Enabled --> Idle: Settings Changed (Disabled)
    Idle --> Enabled: Settings Changed (Enabled)
    Enabled --> [*]: Plugin Unloaded
```

**Settings**:
- `isSyncEnabled`: Boolean flag to enable/disable periodic sync
- `syncInterval`: Interval in seconds

**Status Bar Updates**:
- "Granola sync idle" - Initial state
- "Granola sync: Syncing..." - During sync
- "Granola sync: Auto-syncing..." - During periodic sync
- "Granola sync: Last synced {timestamp}" - After completion

## Error Handling

The plugin implements comprehensive error handling at multiple levels:

### Error Handling Strategy

```mermaid
flowchart TD
    A[Operation] --> B{Error Type?}
    B -->|Credentials Error| C[Show Notice: Auth Failed]
    B -->|API 401/403| D[Show Notice: Permission Error]
    B -->|API 404| E[Show Notice: Endpoint Not Found]
    B -->|API 500+| F[Show Notice: Server Error]
    B -->|Network Error| G[Show Notice: Connection Error]
    B -->|File Error| H[Show Notice: File Error]
    B -->|Parse Error| I[Log to Console]
    C --> J[Continue/Abort]
    D --> J
    E --> J
    F --> J
    G --> J
    H --> J
    I --> J
```

**Error Notices**:
- Display duration: 7-10 seconds depending on severity
- Include actionable error messages
- Log detailed errors to console

## Summary

The sync process orchestrates multiple components:

1. **Credentials Management**: Secure loading via temporary HTTP server
2. **API Communication**: Fetching documents and transcripts from Granola API
3. **Deduplication**: Using Granola ID cache to prevent duplicates
4. **Content Conversion**: ProseMirror to Markdown transformation
5. **File Management**: Creating/updating files in appropriate locations
6. **Error Handling**: Comprehensive error reporting and recovery

The plugin supports flexible sync destinations and maintains data integrity through ID-based deduplication and careful file management.

