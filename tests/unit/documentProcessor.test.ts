import { DocumentProcessor } from "../../src/services/documentProcessor";
import { GranolaDoc } from "../../src/services/granolaApi";
import { PathResolver } from "../../src/services/pathResolver";
import { TranscriptDestination } from "../../src/settings";

// Mock the dependencies
jest.mock("../../src/services/prosemirrorMarkdown");
jest.mock("../../src/utils/filenameUtils");
jest.mock("../../src/utils/dateUtils");

import { convertProsemirrorToMarkdown } from "../../src/services/prosemirrorMarkdown";
import { sanitizeFilename } from "../../src/utils/filenameUtils";
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
        createLinkFromNoteToTranscript: false,
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
      expect(result.content).toContain("created_at: 2024-01-15T10:00:00Z");
      expect(result.content).toContain("updated_at: 2024-01-15T12:00:00Z");
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
      expect(result.content).not.toContain("created_at:");
      expect(result.content).not.toContain("updated_at:");
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

    it("should add transcript link when enabled", () => {
      documentProcessor = new DocumentProcessor(
        {
          syncTranscripts: true,
          createLinkFromNoteToTranscript: true,
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

      expect(result.content).toContain(
        "[Transcript](Transcripts/Test Note-transcript.md)"
      );
      expect(mockPathResolver.computeTranscriptPath).toHaveBeenCalledWith(
        "Test Note",
        new Date("2024-01-15"),
        doc
      );
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

      expect(result.content).toContain('title: "Untitled Granola Note"');
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

    it("should include attendees in frontmatter when provided", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Team Meeting",
        created_at: "2024-01-15T10:00:00Z",
        attendees: ["Alice Johnson", "Bob Smith", "Charlie Brown"],
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.content).toContain("attendees:");
      expect(result.content).toContain('  - Alice Johnson');
      expect(result.content).toContain('  - Bob Smith');
      expect(result.content).toContain('  - Charlie Brown');
    });

    it("should not include attendees in frontmatter when not provided", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Solo Note",
        created_at: "2024-01-15T10:00:00Z",
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.content).not.toContain("attendees:");
    });

    it("should not include attendees when array is empty", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Empty Attendees",
        created_at: "2024-01-15T10:00:00Z",
        attendees: [],
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.content).not.toContain("attendees:");
    });

    it("should escape quotes in attendee names", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Meeting",
        attendees: ['John "Johnny" Doe'],
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      };

      const result = documentProcessor.prepareNote(doc);

      expect(result.content).toContain('  - John "Johnny" Doe');
    });
  });

  describe("prepareTranscript", () => {
    it("should prepare transcript with correct filename", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
      };
      const transcriptContent = "Speaker 1: Hello\nSpeaker 2: World";

      const result = documentProcessor.prepareTranscript(doc, transcriptContent);

      expect(result.filename).toBe("Test Note-transcript.md");
      expect(result.content).toBe(transcriptContent);
    });

    it("should handle missing title", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
      };
      const transcriptContent = "Speaker 1: Hello";

      const result = documentProcessor.prepareTranscript(doc, transcriptContent);

      expect(result.filename).toBe("Untitled Granola Note-transcript.md");
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
});
