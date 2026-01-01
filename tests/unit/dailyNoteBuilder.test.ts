import {
  DailyNoteBuilder,
  NoteData,
  NoteLinkData,
} from "../../src/services/dailyNoteBuilder";
import { GranolaDoc } from "../../src/services/granolaApi";
import { DocumentProcessor } from "../../src/services/documentProcessor";
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

  beforeEach(() => {
    // Setup mocks
    mockApp = {} as App;
    mockDocumentProcessor = {
      extractNoteForDailyNote: jest.fn(),
    } as unknown as DocumentProcessor;

    (getNoteDate as jest.Mock).mockReturnValue(
      new Date("2024-01-15T10:00:00Z")
    );

    dailyNoteBuilder = new DailyNoteBuilder(mockApp, mockDocumentProcessor);
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
      (
        mockDocumentProcessor.extractNoteForDailyNote as jest.Mock
      ).mockReturnValue(null);

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
        "## Granola Notes"
      );

      expect(result).toBe("## Granola Notes");
    });

    it("should build section content with note metadata", () => {
      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData],
        "## Granola Notes"
      );

      expect(result).toContain("## Granola Notes");
      expect(result).toContain("## Test Note");
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
        "## Granola Notes"
      );

      expect(result).not.toContain("**Created:**");
      expect(result).not.toContain("**Updated:**");
      expect(result).toContain("## Test Note");
      expect(result).toContain("**Granola ID:** doc-123");
    });

    it("should not add transcript link to daily note sections", () => {
      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData],
        "## Granola Notes"
      );

      expect(result).not.toContain("**Transcript:**");
      expect(result).not.toContain("[[<");
    });

    it("should handle multiple notes", () => {
      const noteData2: NoteData = {
        title: "Second Note",
        docId: "doc-456",
        markdown: "Second content",
      };

      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData, noteData2],
        "## Granola Notes"
      );

      expect(result).toContain("## Test Note");
      expect(result).toContain("## Second Note");
      expect(result).toContain("**Granola ID:** doc-123");
      expect(result).toContain("**Granola ID:** doc-456");
    });

    it("should trim and add newline at end", () => {
      const result = dailyNoteBuilder.buildDailyNoteSectionContent(
        [noteData],
        "## Granola Notes"
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
        "[Granola Sync]",
        "Error updating daily note section:",
        error
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("buildDailyNoteLinksMap", () => {
    it("should group notes by date and extract link data", () => {
      const doc1: GranolaDoc = {
        id: "doc-1",
        title: "Morning Standup",
        created_at: "2024-01-15T09:00:00Z",
      };
      const doc2: GranolaDoc = {
        id: "doc-2",
        title: "Planning Meeting",
        created_at: "2024-01-15T14:00:00Z",
      };
      const doc3: GranolaDoc = {
        id: "doc-3",
        title: "Retrospective",
        created_at: "2024-01-16T10:00:00Z",
      };

      (getNoteDate as jest.Mock)
        .mockReturnValueOnce(new Date("2024-01-15T09:00:00Z"))
        .mockReturnValueOnce(new Date("2024-01-15T14:00:00Z"))
        .mockReturnValueOnce(new Date("2024-01-16T10:00:00Z"));

      const notesWithPaths = [
        {
          doc: doc1,
          notePath: "Granola/Morning Standup.md",
        },
        {
          doc: doc2,
          notePath: "Granola/Planning Meeting.md",
        },
        {
          doc: doc3,
          notePath: "Granola/Retrospective.md",
        },
      ];

      const result = dailyNoteBuilder.buildDailyNoteLinksMap(notesWithPaths);

      expect(result.size).toBe(2);
      expect(result.get("2024-01-15")).toHaveLength(2);
      expect(result.get("2024-01-16")).toHaveLength(1);
    });

    it("should sort links by time within each day", () => {
      const doc1: GranolaDoc = {
        id: "doc-1",
        title: "Afternoon Meeting",
        created_at: "2024-01-15T14:00:00Z",
      };
      const doc2: GranolaDoc = {
        id: "doc-2",
        title: "Morning Standup",
        created_at: "2024-01-15T09:00:00Z",
      };

      (getNoteDate as jest.Mock)
        .mockReturnValueOnce(new Date("2024-01-15T14:00:00Z"))
        .mockReturnValueOnce(new Date("2024-01-15T09:00:00Z"));

      const notesWithPaths = [
        {
          doc: doc1,
          notePath: "Granola/Afternoon Meeting.md",
        },
        {
          doc: doc2,
          notePath: "Granola/Morning Standup.md",
        },
      ];

      const result = dailyNoteBuilder.buildDailyNoteLinksMap(notesWithPaths);
      const linksForDay = result.get("2024-01-15")!;

      // Should be sorted by time, so Morning Standup comes first
      expect(linksForDay[0].title).toBe("Morning Standup");
      expect(linksForDay[1].title).toBe("Afternoon Meeting");
    });

    it("should handle documents without titles", () => {
      //@ts-expect-error - title is missing
      const doc: GranolaDoc = {
        id: "doc-1",
        created_at: "2024-01-15T10:00:00Z",
      };

      (getNoteDate as jest.Mock).mockReturnValue(
        new Date("2024-01-15T10:00:00Z")
      );

      const notesWithPaths = [
        {
          doc,
          notePath: "Granola/Untitled.md",
        },
      ];

      const result = dailyNoteBuilder.buildDailyNoteLinksMap(notesWithPaths);
      const linksForDay = result.get("2024-01-15")!;

      expect(linksForDay[0].title).toBe("Untitled");
    });

    it("should return empty map when no notes provided", () => {
      const result = dailyNoteBuilder.buildDailyNoteLinksMap([]);
      expect(result.size).toBe(0);
    });
  });

  describe("buildDailyNoteLinksSectionContent", () => {
    it("should return just heading when no links", () => {
      const result = dailyNoteBuilder.buildDailyNoteLinksSectionContent(
        [],
        "## Meetings"
      );

      expect(result).toBe("## Meetings");
    });

    it("should build section content with links and times", () => {
      const links: NoteLinkData[] = [
        {
          title: "Morning Standup",
          filePath: "Granola/Morning Standup.md",
          time: "09:00",
        },
        {
          title: "Planning Meeting",
          filePath: "Granola/Planning Meeting.md",
          time: "14:00",
        },
      ];

      const result = dailyNoteBuilder.buildDailyNoteLinksSectionContent(
        links,
        "## Meetings"
      );

      expect(result).toContain("## Meetings");
      expect(result).toContain(
        "- 09:00 - [[Granola/Morning Standup|Morning Standup]]"
      );
      expect(result).toContain(
        "- 14:00 - [[Granola/Planning Meeting|Planning Meeting]]"
      );
      expect(result.endsWith("\n")).toBe(true);
    });

    it("should handle links without times", () => {
      const links: NoteLinkData[] = [
        {
          title: "Some Meeting",
          filePath: "Granola/Some Meeting.md",
        },
      ];

      const result = dailyNoteBuilder.buildDailyNoteLinksSectionContent(
        links,
        "## Meetings"
      );

      expect(result).toContain("- [[Granola/Some Meeting|Some Meeting]]");
      expect(result).not.toContain("- undefined");
    });

    it("should strip .md extension from wiki links", () => {
      const links: NoteLinkData[] = [
        {
          title: "Test Meeting",
          filePath: "Granola/Test Meeting.md",
          time: "10:00",
        },
      ];

      const result = dailyNoteBuilder.buildDailyNoteLinksSectionContent(
        links,
        "## Meetings"
      );

      expect(result).toContain("[[Granola/Test Meeting|Test Meeting]]");
      expect(result).not.toContain(".md|");
    });
  });

  describe("addLinksToDailyNotes", () => {
    it("should add links to daily notes for each date", async () => {
      const mockFile = { path: "2024-01-15.md" } as TFile;
      (getDailyNote as jest.Mock).mockReturnValue(mockFile);
      (getAllDailyNotes as jest.Mock).mockReturnValue({});
      (updateSection as jest.Mock).mockResolvedValue(undefined);
      (getNoteDate as jest.Mock).mockReturnValue(
        new Date("2024-01-15T10:00:00Z")
      );

      const doc: GranolaDoc = {
        id: "doc-1",
        title: "Test Meeting",
        created_at: "2024-01-15T10:00:00Z",
      };

      const notesWithPaths = [
        {
          doc,
          notePath: "Granola/Test Meeting.md",
        },
      ];

      await dailyNoteBuilder.addLinksToDailyNotes(
        notesWithPaths,
        "## Meetings"
      );

      expect(updateSection).toHaveBeenCalledWith(
        mockApp,
        mockFile,
        "## Meetings",
        expect.stringContaining("[[Granola/Test Meeting|Test Meeting]]"),
        false
      );
    });

    it("should handle errors gracefully", async () => {
      const error = new Error("Failed to get daily note");
      (getDailyNote as jest.Mock).mockReturnValue(null);
      (getAllDailyNotes as jest.Mock).mockReturnValue({});
      (createDailyNote as jest.Mock).mockRejectedValue(error);
      (getNoteDate as jest.Mock).mockReturnValue(
        new Date("2024-01-15T10:00:00Z")
      );

      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const doc: GranolaDoc = {
        id: "doc-1",
        title: "Test Meeting",
        created_at: "2024-01-15T10:00:00Z",
      };

      const notesWithPaths = [
        {
          doc,
          notePath: "Granola/Test Meeting.md",
        },
      ];

      await dailyNoteBuilder.addLinksToDailyNotes(
        notesWithPaths,
        "## Meetings"
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should pass forceOverwrite to updateSection", async () => {
      const mockFile = { path: "2024-01-15.md" } as TFile;
      (getDailyNote as jest.Mock).mockReturnValue(mockFile);
      (getAllDailyNotes as jest.Mock).mockReturnValue({});
      (updateSection as jest.Mock).mockResolvedValue(undefined);
      (getNoteDate as jest.Mock).mockReturnValue(
        new Date("2024-01-15T10:00:00Z")
      );

      const doc: GranolaDoc = {
        id: "doc-1",
        title: "Test Meeting",
        created_at: "2024-01-15T10:00:00Z",
      };

      const notesWithPaths = [
        {
          doc,
          notePath: "Granola/Test Meeting.md",
        },
      ];

      await dailyNoteBuilder.addLinksToDailyNotes(
        notesWithPaths,
        "## Meetings",
        true // forceOverwrite
      );

      expect(updateSection).toHaveBeenCalledWith(
        mockApp,
        mockFile,
        "## Meetings",
        expect.any(String),
        true
      );
    });
  });
});
