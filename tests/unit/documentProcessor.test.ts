import { DocumentProcessor } from "../../src/services/documentProcessor";
import { GranolaDoc } from "../../src/services/granolaApi";
import { PathResolver } from "../../src/services/pathResolver";

// Mock convertProsemirrorToMarkdown: While this is a pure function, we mock it to
// isolate DocumentProcessor's logic (frontmatter generation, formatting) from
// the ProseMirror conversion logic, making tests more maintainable and focused.
jest.mock("../../src/services/prosemirrorMarkdown");

// Mock getNoteDate: This function has time-dependent behavior (returns new Date()
// as fallback), so we mock it to ensure consistent, deterministic test results
// and avoid brittleness from time-dependent test failures.
jest.mock("../../src/utils/dateUtils", () => {
  const actual = jest.requireActual("../../src/utils/dateUtils");
  return {
    ...actual,
    getNoteDate: jest.fn(),
  };
});

import { convertProsemirrorToMarkdown } from "../../src/services/prosemirrorMarkdown";
import { getNoteDate } from "../../src/utils/dateUtils";

describe("DocumentProcessor", () => {
  let documentProcessor: DocumentProcessor;
  let mockPathResolver: PathResolver;

  beforeEach(() => {
    // Setup mocks
    (convertProsemirrorToMarkdown as jest.Mock).mockReturnValue(
      "# Mock Content\n\nThis is mock markdown content."
    );
    (getNoteDate as jest.Mock).mockReturnValue(
      new Date("2024-01-15T00:00:00.000Z")
    );

    // Use real PathResolver instance but spy on methods to control their return values
    mockPathResolver = new PathResolver({
      syncNotes: true,
      saveAsIndividualFiles: true,
      baseFolderType: "custom",
      customBaseFolder: "Granola",
      subfolderPattern: "none",
      filenamePattern: "{title}",
      syncTranscripts: true,
      transcriptHandling: "custom-location",
      customTranscriptBaseFolder: "Transcripts",
      transcriptSubfolderPattern: "none",
      transcriptFilenamePattern: "{title}-transcript",
    });
    jest
      .spyOn(mockPathResolver, "computeTranscriptPath")
      .mockReturnValue("Transcripts/Test Note-transcript.md");
    jest
      .spyOn(mockPathResolver, "computeTranscriptFilenamePattern")
      .mockReturnValue("{title}-transcript");
    jest
      .spyOn(mockPathResolver, "getNoteFilenamePattern")
      .mockReturnValue("{title}");

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
        'title: "Untitled Granola Note at 2024-01-15 00-00-00"'
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

    it("should use PathResolver's getNoteFilenamePattern for filename generation", () => {
      jest
        .spyOn(mockPathResolver, "getNoteFilenamePattern")
        .mockReturnValue("{date}-{title}");

      documentProcessor = new DocumentProcessor(
        {
          syncTranscripts: false,
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

      // resolveFilenamePattern resolves {date} with "2024-01-15" and {title} with "Test Note"
      expect(result.filename).toBe("2024-01-15-Test Note.md");
      expect(mockPathResolver.getNoteFilenamePattern).toHaveBeenCalled();
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
        "Untitled Granola Note at 2024-01-15 00-00-00-transcript.md"
      );
    });

    it("should use PathResolver's computeTranscriptFilenamePattern for filename generation", () => {
      jest
        .spyOn(mockPathResolver, "computeTranscriptFilenamePattern")
        .mockReturnValue("{date}-{title}-transcript");

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
      };
      const transcriptContent = "Speaker 1: Hello";

      const result = documentProcessor.prepareTranscript(
        doc,
        transcriptContent
      );

      expect(result.filename).toBe("2024-01-15-Test Note-transcript.md");
      expect(
        mockPathResolver.computeTranscriptFilenamePattern
      ).toHaveBeenCalled();
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

      const transcriptContent =
        "## You (00:00:01)\n\nHello world.\n\n## Guest (00:00:05)\n\nHi there.\n\n";

      const result = documentProcessor.prepareCombinedNote(
        doc,
        transcriptContent
      );

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

      const result = documentProcessor.prepareCombinedNote(
        doc,
        transcriptContent
      );

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

      const result = documentProcessor.prepareCombinedNote(
        doc,
        transcriptContent
      );

      expect(result.content).toContain("attendees:");
      expect(result.content).toContain("  - Alice");
      expect(result.content).toContain("  - Bob");
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

      const result = documentProcessor.prepareCombinedNote(
        doc,
        transcriptContent
      );

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

      const result = documentProcessor.prepareCombinedNote(
        doc,
        transcriptContent
      );

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

      const result = documentProcessor.prepareCombinedNote(
        doc,
        transcriptContent
      );

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

      const result = documentProcessor.prepareCombinedNote(
        doc,
        transcriptContent
      );

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

      const result = documentProcessor.prepareCombinedNote(
        doc,
        transcriptContent
      );

      expect(result.content).toContain(
        'title: "Untitled Granola Note at 2024-01-15 00-00-00"'
      );
    });
  });

  describe("private notes functionality", () => {
    describe("prepareNote with private notes", () => {
      it("should include private notes section when enabled and content exists", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: false,
            includePrivateNotes: true,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "This is a private note",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const result = documentProcessor.prepareNote(doc);

        expect(result.content).toContain("## Private Notes\n\n");
        expect(result.content).toContain("This is a private note");
        expect(result.content).toContain("## Enhanced Notes\n\n");
        // Enhanced notes section should come after private notes
        const privateNotesIndex = result.content.indexOf("## Private Notes");
        const enhancedNotesIndex = result.content.indexOf("## Enhanced Notes");
        expect(enhancedNotesIndex).toBeGreaterThan(privateNotesIndex);
      });

      it("should not include private notes section when disabled", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: false,
            includePrivateNotes: false,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "This is a private note",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const result = documentProcessor.prepareNote(doc);

        expect(result.content).not.toContain("## Private Notes");
        expect(result.content).not.toContain("## Enhanced Notes");
        expect(result.content).not.toContain("This is a private note");
      });

      it("should not include private notes section when content is empty", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: false,
            includePrivateNotes: true,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const result = documentProcessor.prepareNote(doc);

        expect(result.content).not.toContain("## Private Notes");
        expect(result.content).not.toContain("## Enhanced Notes");
      });

      it("should not include private notes section when content is only whitespace", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: false,
            includePrivateNotes: true,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "   \n\t  ",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const result = documentProcessor.prepareNote(doc);

        expect(result.content).not.toContain("## Private Notes");
        expect(result.content).not.toContain("## Enhanced Notes");
      });

      it("should not include private notes section when notes_markdown is missing", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: false,
            includePrivateNotes: true,
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

        expect(result.content).not.toContain("## Private Notes");
        expect(result.content).not.toContain("## Enhanced Notes");
      });
    });

    describe("prepareCombinedNote with private notes", () => {
      it("should include private notes section when enabled and content exists", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: true,
            includePrivateNotes: true,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "Private note content",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";
        const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

        expect(result.content).toContain("## Private Notes\n\n");
        expect(result.content).toContain("Private note content");
        expect(result.content).toContain("## Enhanced Notes\n\n");
        // Enhanced notes should come before transcript
        const enhancedNotesIndex = result.content.indexOf("## Enhanced Notes");
        const transcriptIndex = result.content.indexOf("## Transcript");
        expect(enhancedNotesIndex).toBeLessThan(transcriptIndex);
      });

      it("should use '## Note' heading when private notes are disabled", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: true,
            includePrivateNotes: false,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "Private note content",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";
        const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

        expect(result.content).not.toContain("## Private Notes");
        expect(result.content).not.toContain("## Enhanced Notes");
        expect(result.content).toContain("## Note\n\n");
      });

      it("should use '## Note' heading when private notes are empty", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: true,
            includePrivateNotes: true,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const transcriptContent = "## You (00:00:01)\n\nTest.\n\n";
        const result = documentProcessor.prepareCombinedNote(doc, transcriptContent);

        expect(result.content).not.toContain("## Private Notes");
        expect(result.content).not.toContain("## Enhanced Notes");
        expect(result.content).toContain("## Note\n\n");
      });
    });

    describe("extractNoteForDailyNote with private notes", () => {
      it("should include private notes in markdown when enabled and content exists", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: false,
            includePrivateNotes: true,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "Private note for daily note",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const result = documentProcessor.extractNoteForDailyNote(doc);

        expect(result).not.toBeNull();
        expect(result!.markdown).toContain("## Private Notes\n\n");
        expect(result!.markdown).toContain("Private note for daily note");
        expect(result!.markdown).toContain("## Enhanced Notes\n\n");
      });

      it("should not include private notes when disabled", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: false,
            includePrivateNotes: false,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "Private note",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const result = documentProcessor.extractNoteForDailyNote(doc);

        expect(result).not.toBeNull();
        expect(result!.markdown).not.toContain("## Private Notes");
        expect(result!.markdown).not.toContain("## Enhanced Notes");
        expect(result!.markdown).not.toContain("Private note");
      });

      it("should not include private notes when content is empty", () => {
        documentProcessor = new DocumentProcessor(
          {
            syncTranscripts: false,
            includePrivateNotes: true,
          },
          mockPathResolver
        );

        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          notes_markdown: "",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const result = documentProcessor.extractNoteForDailyNote(doc);

        expect(result).not.toBeNull();
        expect(result!.markdown).not.toContain("## Private Notes");
        expect(result!.markdown).not.toContain("## Enhanced Notes");
      });
    });

    describe("attendees edge cases", () => {
      it("should handle attendees with only email (no name)", () => {
        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          people: {
            attendees: [
              { email: "alice@example.com" }, // No name
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

        const result = documentProcessor.prepareNote(doc);

        expect(result.content).toContain("attendees:");
        // Should use email when name is missing
        expect(result.content).toContain("alice@example.com");
        expect(result.content).toContain("Bob");
      });

      it("should filter out attendees with neither name nor email", () => {
        const doc: GranolaDoc = {
          id: "doc-123",
          title: "Test Note",
          created_at: "2024-01-15T10:00:00Z",
          people: {
            attendees: [
              { name: "Alice" },
              {}, // No name or email - should be filtered
              { email: "bob@example.com" },
            ],
          },
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        };

        const result = documentProcessor.prepareNote(doc);

        expect(result.content).toContain("attendees:");
        expect(result.content).toContain("Alice");
        expect(result.content).toContain("bob@example.com");
        // Should not contain "Unknown" which would be filtered out
        expect(result.content).not.toContain("Unknown");
      });
    });
  });
});
