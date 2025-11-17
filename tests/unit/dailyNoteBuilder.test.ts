import { DailyNoteBuilder, NoteData } from "../../src/services/dailyNoteBuilder";
import { GranolaDoc } from "../../src/services/granolaApi";
import { DocumentProcessor } from "../../src/services/documentProcessor";
import { PathResolver } from "../../src/services/pathResolver";
import { App, TFile } from "obsidian";

// Mock dependencies
jest.mock("../../src/utils/dateUtils");
jest.mock("../../src/utils/textUtils");
jest.mock("obsidian-daily-notes-interface");

import { getNoteDate } from "../../src/utils/dateUtils";
import { updateSection } from "../../src/utils/textUtils";
import {
  getDailyNote,
  getAllDailyNotes,
  createDailyNote,
} from "obsidian-daily-notes-interface";

describe("DailyNoteBuilder", () => {
  let dailyNoteBuilder: DailyNoteBuilder;
  let mockApp: App;
  let mockDocumentProcessor: DocumentProcessor;
  let mockPathResolver: PathResolver;

  beforeEach(() => {
    // Setup mocks
    mockApp = {} as App;
    mockDocumentProcessor = {
      extractNoteForDailyNote: jest.fn(),
    } as unknown as DocumentProcessor;
    mockPathResolver = {
      computeTranscriptPath: jest.fn(),
    } as unknown as PathResolver;

    (getNoteDate as jest.Mock).mockReturnValue(new Date("2024-01-15T10:00:00Z"));

    dailyNoteBuilder = new DailyNoteBuilder(
      mockApp,
      mockDocumentProcessor,
      mockPathResolver,
      {
        syncTranscripts: false,
        createLinkFromNoteToTranscript: false,
        dailyNoteSectionHeading: "## Granola Notes",
      }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("buildDailyNotesMap", () => {
    it("should group documents by date", () => {
      const doc1: GranolaDoc = {
        id: "doc-1",
        title: "Note 1",
        created_at: "2024-01-15T10:00:00Z",
      };
      const doc2: GranolaDoc = {
        id: "doc-2",
        title: "Note 2",
        created_at: "2024-01-15T11:00:00Z",
      };
      const doc3: GranolaDoc = {
        id: "doc-3",
        title: "Note 3",
        created_at: "2024-01-16T10:00:00Z",
      };

      const noteData1: NoteData = {
        title: "Note 1",
        docId: "doc-1",
        createdAt: "2024-01-15T10:00:00Z",
        markdown: "Content 1",
      };
      const noteData2: NoteData = {
        title: "Note 2",
        docId: "doc-2",
        createdAt: "2024-01-15T11:00:00Z",
        markdown: "Content 2",
      };
      const noteData3: NoteData = {
        title: "Note 3",
        docId: "doc-3",
        createdAt: "2024-01-16T10:00:00Z",
        markdown: "Content 3",
      };

      (mockDocumentProcessor.extractNoteForDailyNote as jest.Mock)
        .mockReturnValueOnce(noteData1)
        .mockReturnValueOnce(noteData2)
        .mockReturnValueOnce(noteData3);

      (getNoteDate as jest.Mock)
        .mockReturnValueOnce(new Date("2024-01-15"))
        .mockReturnValueOnce(new Date("2024-01-15"))
        .mockReturnValueOnce(new Date("2024-01-16"));

      const result = dailyNoteBuilder.buildDailyNotesMap([doc1, doc2, doc3]);

      expect(result.size).toBe(2);
      expect(result.get("2024-01-15")).toEqual([noteData1, noteData2]);
      expect(result.get("2024-01-16")).toEqual([noteData3]);
    });

    it("should skip documents with no valid content", () => {
      const doc1: GranolaDoc = {
        id: "doc-1",
        title: "Note 1",
      };
      const doc2: GranolaDoc = {
        id: "doc-2",
        title: "Note 2",
        created_at: "2024-01-15T10:00:00Z",
      };

      (mockDocumentProcessor.extractNoteForDailyNote as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({
          title: "Note 2",
          docId: "doc-2",
          createdAt: "2024-01-15T10:00:00Z",
          markdown: "Content 2",
        });

      (getNoteDate as jest.Mock).mockReturnValue(new Date("2024-01-15"));

      const result = dailyNoteBuilder.buildDailyNotesMap([doc1, doc2]);

      expect(result.size).toBe(1);
      expect(result.get("2024-01-15")).toHaveLength(1);
      expect(result.get("2024-01-15")![0].docId).toBe("doc-2");
    });

    it("should return empty map when no valid documents", () => {
      (mockDocumentProcessor.extractNoteForDailyNote as jest.Mock).mockReturnValue(
        null
      );

      const result = dailyNoteBuilder.buildDailyNotesMap([
        { id: "doc-1" } as GranolaDoc,
      ]);

      expect(result.size).toBe(0);
    });
  });

  describe("getOrCreateDailyNote", () => {
    it("should return existing daily note if found", async () => {
      const mockFile = { path: "2024-01-15.md" } as TFile;
      (getDailyNote as jest.Mock).mockReturnValue(mockFile);
      (getAllDailyNotes as jest.Mock).mockReturnValue({});

      const result = await dailyNoteBuilder.getOrCreateDailyNote("2024-01-15");

      expect(result).toBe(mockFile);
      expect(createDailyNote).not.toHaveBeenCalled();
    });

    it("should create daily note if not found", async () => {
      const mockFile = { path: "2024-01-15.md" } as TFile;
      (getDailyNote as jest.Mock).mockReturnValue(null);
      (getAllDailyNotes as jest.Mock).mockReturnValue({});
      (createDailyNote as jest.Mock).mockResolvedValue(mockFile);

      const result = await dailyNoteBuilder.getOrCreateDailyNote("2024-01-15");

      expect(result).toBe(mockFile);
      expect(createDailyNote).toHaveBeenCalled();
    });
  });

  describe("buildDailyNoteSectionContent", () => {
    const noteData: NoteData = {
      title: "Test Note",
      docId: "doc-123",
      createdAt: "2024-01-15T10:00:00Z",
      updatedAt: "2024-01-15T12:00:00Z",
      markdown: "# Content\n\nTest content",
    };

    it("should return just heading when no notes", () => {
      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [],
        "## Granola Notes",
        "2024-01-15"
      );

      expect(result).toBe("## Granola Notes");
    });

    it("should build section content with note metadata", () => {
      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData],
        "## Granola Notes",
        "2024-01-15"
      );

      expect(result).toContain("## Granola Notes");
      expect(result).toContain("### Test Note");
      expect(result).toContain("**Granola ID:** doc-123");
      expect(result).toContain("**Created:** 2024-01-15T10:00:00Z");
      expect(result).toContain("**Updated:** 2024-01-15T12:00:00Z");
      expect(result).toContain("# Content\n\nTest content");
    });

    it("should handle notes without timestamps", () => {
      const noteWithoutTimestamps: NoteData = {
        title: "Test Note",
        docId: "doc-123",
        markdown: "Content",
      };

      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteWithoutTimestamps],
        "## Granola Notes",
        "2024-01-15"
      );

      expect(result).not.toContain("**Created:**");
      expect(result).not.toContain("**Updated:**");
      expect(result).toContain("### Test Note");
      expect(result).toContain("**Granola ID:** doc-123");
    });

    it("should add transcript link when enabled", () => {
      dailyNoteBuilder = new DailyNoteBuilder(
        mockApp,
        mockDocumentProcessor,
        mockPathResolver,
        {
          syncTranscripts: true,
          createLinkFromNoteToTranscript: true,
          dailyNoteSectionHeading: "## Granola Notes",
        }
      );

      (mockPathResolver.computeTranscriptPath as jest.Mock).mockReturnValue(
        "Transcripts/Test Note-transcript.md"
      );

      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData],
        "## Granola Notes",
        "2024-01-15"
      );

      expect(result).toContain(
        "**Transcript:** [[<Transcripts/Test Note-transcript.md>]]"
      );
      expect(mockPathResolver.computeTranscriptPath).toHaveBeenCalledWith(
        "Test Note",
        expect.any(Date)
      );
    });

    it("should not add transcript link when disabled", () => {
      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData],
        "## Granola Notes",
        "2024-01-15"
      );

      expect(result).not.toContain("**Transcript:**");
      expect(mockPathResolver.computeTranscriptPath).not.toHaveBeenCalled();
    });

    it("should wrap transcript paths with spaces in angle brackets", () => {
      dailyNoteBuilder = new DailyNoteBuilder(
        mockApp,
        mockDocumentProcessor,
        mockPathResolver,
        {
          syncTranscripts: true,
          createLinkFromNoteToTranscript: true,
          dailyNoteSectionHeading: "## Granola Notes",
        }
      );

      (mockPathResolver.computeTranscriptPath as jest.Mock).mockReturnValue(
        "Transcripts/My Meeting Transcript.md"
      );

      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData],
        "## Granola Notes",
        "2024-01-15"
      );

      expect(result).toContain(
        "**Transcript:** [[<Transcripts/My Meeting Transcript.md>]]"
      );
    });

    it("should not wrap transcript paths without spaces in angle brackets", () => {
      dailyNoteBuilder = new DailyNoteBuilder(
        mockApp,
        mockDocumentProcessor,
        mockPathResolver,
        {
          syncTranscripts: true,
          createLinkFromNoteToTranscript: true,
          dailyNoteSectionHeading: "## Granola Notes",
        }
      );

      (mockPathResolver.computeTranscriptPath as jest.Mock).mockReturnValue(
        "Transcripts/TestNote-transcript.md"
      );

      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData],
        "## Granola Notes",
        "2024-01-15"
      );

      expect(result).toContain(
        "**Transcript:** [[Transcripts/TestNote-transcript.md]]"
      );
    });

    it("should handle multiple notes", () => {
      const noteData2: NoteData = {
        title: "Second Note",
        docId: "doc-456",
        markdown: "Second content",
      };

      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData, noteData2],
        "## Granola Notes",
        "2024-01-15"
      );

      expect(result).toContain("### Test Note");
      expect(result).toContain("### Second Note");
      expect(result).toContain("**Granola ID:** doc-123");
      expect(result).toContain("**Granola ID:** doc-456");
    });

    it("should trim and add newline at end", () => {
      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData],
        "## Granola Notes",
        "2024-01-15"
      );

      expect(result.endsWith("\n")).toBe(true);
      expect(result.endsWith("\n\n")).toBe(false);
    });
  });

  describe("updateDailyNoteSection", () => {
    it("should update section successfully", async () => {
      const mockFile = { path: "2024-01-15.md" } as TFile;
      (updateSection as jest.Mock).mockResolvedValue(undefined);

      await dailyNoteBuilder.updateDailyNoteSection(
        mockFile,
        "## Granola Notes",
        "Content"
      );

      expect(updateSection).toHaveBeenCalledWith(
        mockApp,
        mockFile,
        "## Granola Notes",
        "Content",
        false
      );
    });

    it("should handle errors gracefully", async () => {
      const mockFile = { path: "2024-01-15.md" } as TFile;
      const error = new Error("Update failed");
      (updateSection as jest.Mock).mockRejectedValue(error);

      // Mock console.error to avoid test output noise
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await dailyNoteBuilder.updateDailyNoteSection(
        mockFile,
        "## Granola Notes",
        "Content"
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error updating daily note section:",
        error
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
