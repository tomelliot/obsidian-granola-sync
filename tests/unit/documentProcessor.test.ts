import { DocumentProcessor } from "../../src/services/documentProcessor";
import { GranolaDoc } from "../../src/services/granolaApi";
import { PathResolver } from "../../src/services/pathResolver";
import { TranscriptDestination } from "../../src/settings";

// Mock the dependencies
jest.mock("../../src/services/prosemirrorMarkdown");
jest.mock("../../src/utils/filenameUtils");
jest.mock("../../src/utils/dateUtils");

import { convertProsemirrorToMarkdown } from "../../src/services/prosemirrorMarkdown";
import {
  sanitizeFilename,
  getTitleOrDefault,
} from "../../src/utils/filenameUtils";
import { getNoteDate } from "../../src/utils/dateUtils";

describe("DocumentProcessor", () => {
  let documentProcessor: DocumentProcessor;
  let mockPathResolver: PathResolver;

  beforeEach(() => {
    // Setup mocks
    (convertProsemirrorToMarkdown as jest.Mock).mockReturnValue(
      "# Mock Content\n\nThis is mock markdown content."
    );
    (sanitizeFilename as jest.Mock).mockImplementation((title: string) =>
      title.replace(/[^a-zA-Z0-9\s\-_]/g, "").trim()
    );
    (getTitleOrDefault as jest.Mock).mockImplementation(
      (doc: GranolaDoc) =>
        doc.title || "Untitled Granola Note at 2024-01-15 00-00"
    );
    (getNoteDate as jest.Mock).mockReturnValue(new Date("2024-01-15"));

    mockPathResolver = new PathResolver({
      transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
      granolaTranscriptsFolder: "Transcripts",
    });
    jest
      .spyOn(mockPathResolver, "computeTranscriptPath")
      .mockReturnValue("Transcripts/Test Note-transcript.md");

    documentProcessor = new DocumentProcessor(
      {
        syncTranscripts: false,
      },
      mockPathResolver
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("prepareNote", () => {
    it("should prepare a note with basic frontmatter", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        updated_at: "2024-01-15T12:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.filename).toBe("Test Note.md");
      expect(result.content).toContain("---");
      expect(result.content).toContain("granola_id: doc-123");
      expect(result.content).toContain('title: "Test Note"');
      expect(result.content).toContain("type: note");
      expect(result.content).toContain("created: 2024-01-15T10:00:00Z");
      expect(result.content).toContain("updated: 2024-01-15T12:00:00Z");
      expect(result.content).toContain("# Mock Content");
    });

    it("should handle documents without created_at or updated_at", () => {
      const doc: GranolaDoc = {
        id: "doc-456",
        title: "Minimal Note",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.filename).toBe("Minimal Note.md");
      expect(result.content).toContain("granola_id: doc-456");
      expect(result.content).toContain("type: note");
      expect(result.content).not.toContain("created:");
      expect(result.content).not.toContain("updated:");
    });

    it("should escape quotes in titles for YAML frontmatter", () => {
      const doc: GranolaDoc = {
        id: "doc-789",
        title: 'Note with "quotes"',
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.content).toContain('title: "Note with \\"quotes\\""');
    });

    it("should add transcript field to frontmatter when transcripts enabled and path provided", () => {
      documentProcessor = new DocumentProcessor(
        {
          syncTranscripts: true,
        },
        mockPathResolver
      );

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(
        doc,
        "Transcripts/Test Note-transcript.md"
      );

      expect(result.content).toContain(
        'transcript: "[[Transcripts/Test Note-transcript.md]]"'
      );
      expect(result.content).not.toContain("[Transcript]");
    });

    it("should not add transcript field when path not provided", () => {
      documentProcessor = new DocumentProcessor(
        {
          syncTranscripts: true,
        },
        mockPathResolver
      );

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.content).not.toContain("transcript:");
      expect(result.content).not.toContain("[Transcript]");
    });

    it("should not add transcript link when disabled", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.content).not.toContain("[Transcript]");
      expect(result.content).not.toContain("[[");
    });

    it("should use wiki-style links for transcript paths in frontmatter", () => {
      documentProcessor = new DocumentProcessor(
        {
          syncTranscripts: true,
        },
        mockPathResolver
      );

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(
        doc,
        "Transcripts/My Meeting Transcript.md"
      );

      expect(result.content).toContain(
        'transcript: "[[Transcripts/My Meeting Transcript.md]]"'
      );
    });

    it("should use wiki-style links for transcript paths without spaces in frontmatter", () => {
      documentProcessor = new DocumentProcessor(
        {
          syncTranscripts: true,
        },
        mockPathResolver
      );

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(
        doc,
        "Transcripts/TestNote-transcript.md"
      );

      expect(result.content).toContain(
        'transcript: "[[Transcripts/TestNote-transcript.md]]"'
      );
    });

    it("should use default title when title is missing", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.content).toContain(
        'title: "Untitled Granola Note at 2024-01-15 00-00"'
      );
    });

    it("should throw error when document has no valid content", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Invalid Note",
      };

      expect(() => documentProcessor.prepareNote(doc)).toThrow(
        "Document has no valid content to parse"
      );
    });

    it("should throw error when content type is not doc", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Invalid Note",
        last_viewed_panel: {
          content: {
            type: "invalid",
            content: [],
          },
        },
      };

      expect(() => documentProcessor.prepareNote(doc)).toThrow(
        "Document has no valid content to parse"
      );
    });
  });

  describe("prepareTranscript", () => {
    it("should prepare transcript with correct filename", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
      };
      const transcriptContent = "Speaker 1: Hello\nSpeaker 2: World";

      const result = documentProcessor.prepareTranscript(
        doc,
        transcriptContent
      );

      expect(result.filename).toBe("Test Note-transcript.md");
      expect(result.content).toBe(transcriptContent);
    });

    it("should handle missing title", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
      };
      const transcriptContent = "Speaker 1: Hello";

      const result = documentProcessor.prepareTranscript(
        doc,
        transcriptContent
      );

      expect(result.filename).toBe(
        "Untitled Granola Note at 2024-01-15 00-00-transcript.md"
      );
    });
  });

  describe("extractNoteForDailyNote", () => {
    it("should extract note data for daily notes", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        updated_at: "2024-01-15T12:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.extractNoteForDailyNote(doc);

      expect(result).toEqual({
        title: "Test Note",
        docId: "doc-123",
        createdAt: "2024-01-15T10:00:00Z",
        updatedAt: "2024-01-15T12:00:00Z",
        markdown: "# Mock Content\n\nThis is mock markdown content.",
      });
    });

    it("should return null when document has no valid content", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Invalid Note",
      };

      const result = documentProcessor.extractNoteForDailyNote(doc);

      expect(result).toBeNull();
    });

    it("should handle documents without timestamps", () => {
      const doc: GranolaDoc = {
        id: "doc-456",
        title: "Minimal Note",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.extractNoteForDailyNote(doc);

      expect(result).toEqual({
        title: "Minimal Note",
        docId: "doc-456",
        markdown: "# Mock Content\n\nThis is mock markdown content.",
      });
    });
  });

  describe("prepareCombinedNote", () => {
    it("should prepare a combined note with both note and transcript content", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        updated_at: "2024-01-15T12:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const transcriptContent = "## You (00:00:01)\n\nHello world.\n\n## Guest (00:00:05)\n\nHi there.\n\n";

      const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

      expect(result.filename).toBe("Test Note.md");
      expect(result.content).toContain("---");
      expect(result.content).toContain("granola_id: doc-123");
      expect(result.content).toContain('title: "Test Note"');
      expect(result.content).toContain("type: combined");
      expect(result.content).toContain("created: 2024-01-15T10:00:00Z");
      expect(result.content).toContain("updated: 2024-01-15T12:00:00Z");
      expect(result.content).toContain("## Note\n\n");
      expect(result.content).toContain("# Mock Content");
      expect(result.content).toContain("## Transcript\n\n");
      expect(result.content).toContain("## You (00:00:01)");
      expect(result.content).toContain("Hello world.");
      expect(result.content).toContain("## Guest (00:00:05)");
      expect(result.content).toContain("Hi there.");
    });

    it("should not include transcript or note link fields in frontmatter", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";

      const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

      expect(result.content).not.toContain("transcript:");
      expect(result.content).not.toContain("note:");
      expect(result.content).not.toContain("[[");
    });

    it("should include attendees in frontmatter", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        people: {
          attendees: [
            { name: "Alice", email: "alice@example.com" },
            { name: "Bob", email: "bob@example.com" },
          ],
        },
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";

      const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

      expect(result.content).toContain("attendees:");
      expect(result.content).toContain('- "Alice"');
      expect(result.content).toContain('- "Bob"');
    });

    it("should handle empty attendees array", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        people: {
          attendees: [],
        },
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";

      const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

      expect(result.content).toContain("attendees: []");
    });

    it("should handle documents without timestamps", () => {
      const doc: GranolaDoc = {
        id: "doc-456",
        title: "Minimal Note",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";

      const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

      expect(result.filename).toBe("Minimal Note.md");
      expect(result.content).toContain("granola_id: doc-456");
      expect(result.content).toContain("type: combined");
      expect(result.content).not.toContain("created:");
      expect(result.content).not.toContain("updated:");
    });

    it("should escape quotes in titles for YAML frontmatter", () => {
      const doc: GranolaDoc = {
        id: "doc-789",
        title: 'Note with "quotes"',
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";

      const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

      expect(result.content).toContain('title: "Note with \\"quotes\\""');
    });

    it("should place transcript content after note content", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const transcriptContent = "## You (00:00:01)\n\nTranscript text.\n\n";

      const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

      const noteIndex = result.content.indexOf("## Note");
      const transcriptIndex = result.content.indexOf("## Transcript");
      const noteContentIndex = result.content.indexOf("# Mock Content");
      const transcriptContentIndex = result.content.indexOf("Transcript text");

      expect(noteIndex).toBeLessThan(transcriptIndex);
      expect(noteContentIndex).toBeLessThan(transcriptIndex);
      expect(transcriptIndex).toBeLessThan(transcriptContentIndex);
    });

    it("should throw error when document has no valid content", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Invalid Note",
      };

      const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";

      expect(() =>
        documentProcessor.prepareCombinedNote(doc, transcriptContent)
      ).toThrow("Document has no valid content to parse");
    });

    it("should use default title when title is missing", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";

      const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

      expect(result.content).toContain(
        'title: "Untitled Granola Note at 2024-01-15 00-00"'
      );
    });
  });
});
