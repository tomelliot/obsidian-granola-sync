import { DocumentProcessor } from "../../src/services/documentProcessor";
import { GranolaDoc, TranscriptEntry } from "../../src/services/granolaApi";

describe("DocumentProcessor", () => {
  let processor: DocumentProcessor;

  beforeEach(() => {
    processor = new DocumentProcessor();
  });

  describe("processNote", () => {
    it("should create note with frontmatter and content", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:30:00Z",
        updated_at: "2024-01-20T15:45:00Z",
      };
      const markdownContent = "# My Note\n\nSome content here.";

      const result = processor.processNote(doc, markdownContent);

      expect(result.filename).toBe("Test_Note.md");
      expect(result.content).toContain("---");
      expect(result.content).toContain("granola_id: doc-123");
      expect(result.content).toContain('title: "Test Note"');
      expect(result.content).toContain("created_at: 2024-01-15T10:30:00Z");
      expect(result.content).toContain("updated_at: 2024-01-20T15:45:00Z");
      expect(result.content).toContain(markdownContent);
      expect(result.noteDate).toEqual(new Date("2024-01-15T10:30:00Z"));
    });

    it("should escape quotes in title for YAML frontmatter", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: 'Note with "quotes"',
      };
      const markdownContent = "Content";

      const result = processor.processNote(doc, markdownContent);

      expect(result.content).toContain('title: "Note with \\"quotes\\""');
    });

    it("should handle missing created_at and updated_at", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
      };
      const markdownContent = "Content";

      const result = processor.processNote(doc, markdownContent);

      expect(result.content).not.toContain("created_at:");
      expect(result.content).not.toContain("updated_at:");
      expect(result.content).toContain("granola_id: doc-123");
    });

    it("should use default title for untitled notes", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "",
      };
      const markdownContent = "Content";

      const result = processor.processNote(doc, markdownContent);

      expect(result.filename).toBe("Untitled_Granola_Note.md");
      expect(result.content).toContain('title: "Untitled Granola Note"');
    });

    it("should include transcript link when enabled", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:30:00Z",
      };
      const markdownContent = "Content";
      const computeTranscriptPath = (title: string, noteDate: Date) =>
        `transcripts/${title}-transcript.md`;

      const result = processor.processNote(
        doc,
        markdownContent,
        true,
        computeTranscriptPath
      );

      expect(result.content).toContain(
        "[Transcript](transcripts/Test Note-transcript.md)"
      );
    });

    it("should not include transcript link when disabled", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
      };
      const markdownContent = "Content";

      const result = processor.processNote(doc, markdownContent, false);

      expect(result.content).not.toContain("[Transcript]");
    });
  });

  describe("processTranscript", () => {
    it("should create transcript metadata", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:30:00Z",
      };
      const transcriptContent = "# Transcript\n\nContent here";

      const result = processor.processTranscript(doc, transcriptContent);

      expect(result.filename).toBe("Test_Note-transcript.md");
      expect(result.content).toBe(transcriptContent);
      expect(result.noteDate).toEqual(new Date("2024-01-15T10:30:00Z"));
      expect(result.transcriptId).toBe("doc-123-transcript");
    });

    it("should handle untitled documents", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "",
      };
      const transcriptContent = "Content";

      const result = processor.processTranscript(doc, transcriptContent);

      expect(result.filename).toBe("Untitled_Granola_Note-transcript.md");
      expect(result.transcriptId).toBe("doc-123-transcript");
    });
  });

  describe("formatTranscript", () => {
    it("should format transcript with frontmatter", () => {
      const transcriptData: TranscriptEntry[] = [
        {
          document_id: "doc-123",
          start_timestamp: "00:00:00",
          end_timestamp: "00:00:05",
          text: "Hello world",
          source: "microphone",
          id: "entry-1",
          is_final: true,
        },
      ];

      const result = processor.formatTranscript(
        transcriptData,
        "Test Meeting",
        "doc-123"
      );

      expect(result).toContain("---");
      expect(result).toContain("granola_id: doc-123-transcript");
      expect(result).toContain('title: "Test Meeting - Transcript"');
      expect(result).toContain("# Transcript for: Test Meeting");
    });

    it("should group consecutive entries from same speaker", () => {
      const transcriptData: TranscriptEntry[] = [
        {
          document_id: "doc-123",
          start_timestamp: "00:00:00",
          end_timestamp: "00:00:05",
          text: "Hello",
          source: "microphone",
          id: "entry-1",
          is_final: true,
        },
        {
          document_id: "doc-123",
          start_timestamp: "00:00:05",
          end_timestamp: "00:00:10",
          text: "world",
          source: "microphone",
          id: "entry-2",
          is_final: true,
        },
      ];

      const result = processor.formatTranscript(
        transcriptData,
        "Test Meeting",
        "doc-123"
      );

      expect(result).toContain("## You (00:00:00)");
      expect(result).toContain("Hello world");
      // Should only have one "You" heading since they're consecutive
      expect(result.match(/## You/g)?.length).toBe(1);
    });

    it("should separate different speakers", () => {
      const transcriptData: TranscriptEntry[] = [
        {
          document_id: "doc-123",
          start_timestamp: "00:00:00",
          end_timestamp: "00:00:05",
          text: "Hello from me",
          source: "microphone",
          id: "entry-1",
          is_final: true,
        },
        {
          document_id: "doc-123",
          start_timestamp: "00:00:05",
          end_timestamp: "00:00:10",
          text: "Hello from guest",
          source: "recording",
          id: "entry-2",
          is_final: true,
        },
      ];

      const result = processor.formatTranscript(
        transcriptData,
        "Test Meeting",
        "doc-123"
      );

      expect(result).toContain("## You (00:00:00)");
      expect(result).toContain("Hello from me");
      expect(result).toContain("## Guest (00:00:05)");
      expect(result).toContain("Hello from guest");
    });

    it("should handle alternating speakers", () => {
      const transcriptData: TranscriptEntry[] = [
        {
          document_id: "doc-123",
          start_timestamp: "00:00:00",
          end_timestamp: "00:00:05",
          text: "First me",
          source: "microphone",
          id: "entry-1",
          is_final: true,
        },
        {
          document_id: "doc-123",
          start_timestamp: "00:00:05",
          end_timestamp: "00:00:10",
          text: "Then guest",
          source: "recording",
          id: "entry-2",
          is_final: true,
        },
        {
          document_id: "doc-123",
          start_timestamp: "00:00:10",
          end_timestamp: "00:00:15",
          text: "Me again",
          source: "microphone",
          id: "entry-3",
          is_final: true,
        },
      ];

      const result = processor.formatTranscript(
        transcriptData,
        "Test Meeting",
        "doc-123"
      );

      expect(result.match(/## You/g)?.length).toBe(2);
      expect(result.match(/## Guest/g)?.length).toBe(1);
    });

    it("should handle empty transcript data", () => {
      const transcriptData: TranscriptEntry[] = [];

      const result = processor.formatTranscript(
        transcriptData,
        "Test Meeting",
        "doc-123"
      );

      expect(result).toContain("# Transcript for: Test Meeting");
      expect(result).not.toContain("## You");
      expect(result).not.toContain("## Guest");
    });

    it("should escape quotes in title", () => {
      const transcriptData: TranscriptEntry[] = [];

      const result = processor.formatTranscript(
        transcriptData,
        'Meeting with "quotes"',
        "doc-123"
      );

      expect(result).toContain('title: "Meeting with \\"quotes\\" - Transcript"');
    });
  });
});
