import { DailyNoteBuilder, DailyNoteEntry } from "../../src/services/dailyNoteBuilder";
import { GranolaDoc } from "../../src/services/granolaApi";

// Mock the external dependencies
jest.mock("obsidian-daily-notes-interface");
jest.mock("../../src/services/prosemirrorMarkdown");

import {
  createDailyNote,
  getDailyNote,
  getAllDailyNotes,
} from "obsidian-daily-notes-interface";
import { convertProsemirrorToMarkdown } from "../../src/services/prosemirrorMarkdown";

describe("DailyNoteBuilder", () => {
  let builder: DailyNoteBuilder;

  beforeEach(() => {
    builder = new DailyNoteBuilder();
    jest.clearAllMocks();
  });

  describe("buildMap", () => {
    beforeEach(() => {
      (convertProsemirrorToMarkdown as jest.Mock).mockReturnValue("Converted markdown");
    });

    it("should build a map of notes grouped by date", () => {
      const documents: GranolaDoc[] = [
        {
          id: "doc-1",
          title: "Note 1",
          created_at: "2024-01-15T10:00:00Z",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        },
        {
          id: "doc-2",
          title: "Note 2",
          created_at: "2024-01-15T14:00:00Z",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        },
        {
          id: "doc-3",
          title: "Note 3",
          created_at: "2024-01-16T10:00:00Z",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        },
      ];

      const result = builder.buildMap(documents);

      expect(result.size).toBe(2);
      expect(result.get("2024-01-15")?.length).toBe(2);
      expect(result.get("2024-01-16")?.length).toBe(1);
    });

    it("should skip documents without content", () => {
      const documents: GranolaDoc[] = [
        {
          id: "doc-1",
          title: "Note 1",
          created_at: "2024-01-15T10:00:00Z",
        },
        {
          id: "doc-2",
          title: "Note 2",
          created_at: "2024-01-15T14:00:00Z",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        },
      ];

      const result = builder.buildMap(documents);

      expect(result.size).toBe(1);
      expect(result.get("2024-01-15")?.length).toBe(1);
    });

    it("should skip documents with non-doc content type", () => {
      const documents: GranolaDoc[] = [
        {
          id: "doc-1",
          title: "Note 1",
          created_at: "2024-01-15T10:00:00Z",
          last_viewed_panel: {
            content: {
              type: "other" as any,
              content: [],
            },
          },
        },
      ];

      const result = builder.buildMap(documents);

      expect(result.size).toBe(0);
    });

    it("should use default values for missing fields", () => {
      const documents: GranolaDoc[] = [
        {
          id: "doc-1",
          title: "",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        },
      ];

      const result = builder.buildMap(documents);

      const entries = Array.from(result.values())[0];
      expect(entries[0].title).toBe("Untitled Granola Note");
      expect(entries[0].docId).toBe("doc-1");
    });

    it("should convert prosemirror content to markdown", () => {
      const documents: GranolaDoc[] = [
        {
          id: "doc-1",
          title: "Note 1",
          created_at: "2024-01-15T10:00:00Z",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
            },
          },
        },
      ];

      builder.buildMap(documents);

      expect(convertProsemirrorToMarkdown).toHaveBeenCalledWith({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      });
    });

    it("should include created and updated timestamps", () => {
      const documents: GranolaDoc[] = [
        {
          id: "doc-1",
          title: "Note 1",
          created_at: "2024-01-15T10:00:00Z",
          updated_at: "2024-01-15T12:00:00Z",
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        },
      ];

      const result = builder.buildMap(documents);
      const entries = Array.from(result.values())[0];

      expect(entries[0].createdAt).toBe("2024-01-15T10:00:00Z");
      expect(entries[0].updatedAt).toBe("2024-01-15T12:00:00Z");
    });
  });

  describe("getOrCreate", () => {
    it("should return existing daily note if it exists", async () => {
      const mockFile = { path: "2024-01-15.md" } as any;
      (getDailyNote as jest.Mock).mockReturnValue(mockFile);
      (getAllDailyNotes as jest.Mock).mockReturnValue({});

      const result = await builder.getOrCreate("2024-01-15");

      expect(result).toBe(mockFile);
      expect(getDailyNote).toHaveBeenCalled();
      expect(createDailyNote).not.toHaveBeenCalled();
    });

    it("should create new daily note if it does not exist", async () => {
      const mockFile = { path: "2024-01-15.md" } as any;
      (getDailyNote as jest.Mock).mockReturnValue(null);
      (getAllDailyNotes as jest.Mock).mockReturnValue({});
      (createDailyNote as jest.Mock).mockResolvedValue(mockFile);

      const result = await builder.getOrCreate("2024-01-15");

      expect(result).toBe(mockFile);
      expect(createDailyNote).toHaveBeenCalled();
    });
  });

  describe("buildSectionContent", () => {
    it("should return just the heading for empty notes array", () => {
      const result = builder.buildSectionContent([], "## Granola Notes", "2024-01-15");

      expect(result).toBe("## Granola Notes");
    });

    it("should build content with note metadata", () => {
      const notes: DailyNoteEntry[] = [
        {
          title: "Test Note",
          docId: "doc-123",
          createdAt: "2024-01-15T10:00:00Z",
          updatedAt: "2024-01-15T12:00:00Z",
          markdown: "Note content here",
        },
      ];

      const result = builder.buildSectionContent(notes, "## Granola Notes", "2024-01-15");

      expect(result).toContain("## Granola Notes");
      expect(result).toContain("### Test Note");
      expect(result).toContain("**Granola ID:** doc-123");
      expect(result).toContain("**Created:** 2024-01-15T10:00:00Z");
      expect(result).toContain("**Updated:** 2024-01-15T12:00:00Z");
      expect(result).toContain("Note content here");
    });

    it("should handle missing created and updated timestamps", () => {
      const notes: DailyNoteEntry[] = [
        {
          title: "Test Note",
          docId: "doc-123",
          markdown: "Note content",
        },
      ];

      const result = builder.buildSectionContent(notes, "## Granola Notes", "2024-01-15");

      expect(result).not.toContain("**Created:**");
      expect(result).not.toContain("**Updated:**");
      expect(result).toContain("### Test Note");
    });

    it("should include transcript links when enabled", () => {
      const notes: DailyNoteEntry[] = [
        {
          title: "Test Note",
          docId: "doc-123",
          createdAt: "2024-01-15T10:00:00Z",
          markdown: "Note content",
        },
      ];

      const computeTranscriptPath = jest.fn().mockReturnValue("transcripts/Test_Note-transcript.md");

      const result = builder.buildSectionContent(
        notes,
        "## Granola Notes",
        "2024-01-15",
        {
          includeTranscriptLinks: true,
          computeTranscriptPath,
        }
      );

      expect(result).toContain("**Transcript:** [[transcripts/Test_Note-transcript.md]]");
      expect(computeTranscriptPath).toHaveBeenCalledWith("Test Note", new Date("2024-01-15T10:00:00Z"));
    });

    it("should not include transcript links when disabled", () => {
      const notes: DailyNoteEntry[] = [
        {
          title: "Test Note",
          docId: "doc-123",
          markdown: "Note content",
        },
      ];

      const result = builder.buildSectionContent(
        notes,
        "## Granola Notes",
        "2024-01-15",
        { includeTranscriptLinks: false }
      );

      expect(result).not.toContain("**Transcript:**");
    });

    it("should handle multiple notes", () => {
      const notes: DailyNoteEntry[] = [
        {
          title: "Note 1",
          docId: "doc-1",
          markdown: "Content 1",
        },
        {
          title: "Note 2",
          docId: "doc-2",
          markdown: "Content 2",
        },
      ];

      const result = builder.buildSectionContent(notes, "## Granola Notes", "2024-01-15");

      expect(result).toContain("### Note 1");
      expect(result).toContain("### Note 2");
      expect(result).toContain("Content 1");
      expect(result).toContain("Content 2");
    });

    it("should use fallback date when note dates are missing", () => {
      const notes: DailyNoteEntry[] = [
        {
          title: "Test Note",
          docId: "doc-123",
          markdown: "Note content",
        },
      ];

      const computeTranscriptPath = jest.fn().mockReturnValue("transcripts/Test_Note-transcript.md");

      builder.buildSectionContent(
        notes,
        "## Granola Notes",
        "2024-01-15",
        {
          includeTranscriptLinks: true,
          computeTranscriptPath,
        }
      );

      expect(computeTranscriptPath).toHaveBeenCalledWith("Test Note", new Date("2024-01-15"));
    });
  });
});
