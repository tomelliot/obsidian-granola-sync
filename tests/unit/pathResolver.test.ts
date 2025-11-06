import { PathResolver } from "../../src/services/pathResolver";
import { TranscriptDestination, TranscriptSettings } from "../../src/settings";
import { GranolaDoc } from "../../src/services/granolaApi";

// Mock obsidian-daily-notes-interface
jest.mock("obsidian-daily-notes-interface", () => ({
  getDailyNoteSettings: jest.fn(() => ({
    format: "YYYY-MM-DD",
    folder: "daily-notes",
  })),
}));

describe("PathResolver", () => {
  let settings: Pick<TranscriptSettings, 'transcriptDestination' | 'granolaTranscriptsFolder'>;
  let pathResolver: PathResolver;

  beforeEach(() => {
    settings = {
      transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
      granolaTranscriptsFolder: "transcripts",
    };
    pathResolver = new PathResolver(settings, "Granola");
  });

  describe("computeDailyNoteFolderPath", () => {
    it("should compute folder path using daily note settings", () => {
      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeDailyNoteFolderPath(noteDate);

      // With format "YYYY-MM-DD", the folder is just the base daily notes folder
      // since there's no "/" in the formatted date
      expect(result).toBe("daily-notes");
    });

    it("should handle dates with nested folder structure", () => {
      const { getDailyNoteSettings } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({
        format: "YYYY/MM/DD",
        folder: "journal",
      });

      const noteDate = new Date("2024-03-20");
      const result = pathResolver.computeDailyNoteFolderPath(noteDate);

      // Should extract folder parts: YYYY/MM
      expect(result).toBe("journal/2024/03");
    });

    it("should handle empty base folder", () => {
      const { getDailyNoteSettings } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({
        format: "YYYY-MM-DD",
        folder: "",
      });

      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeDailyNoteFolderPath(noteDate);

      expect(result).toBe("");
    });

    it("should use default format when none provided", () => {
      const { getDailyNoteSettings } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({
        format: undefined,
        folder: "notes",
      });

      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeDailyNoteFolderPath(noteDate);

      // Should use default format "YYYY-MM-DD"
      expect(result).toBe("notes");
    });
  });

  describe("computeTranscriptPath", () => {
    it("should compute path to granola transcripts folder when configured", () => {
      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeTranscriptPath("Test Meeting", noteDate);

      expect(result).toBe("transcripts/Test_Meeting-transcript.md");
    });

    it("should compute path to daily note folder structure when configured", () => {
      const { getDailyNoteSettings } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({
        format: "YYYY/MM/DD",
        folder: "journal",
      });

      pathResolver = new PathResolver({
        transcriptDestination: TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE,
        granolaTranscriptsFolder: "transcripts",
      }, "Granola");

      const noteDate = new Date("2024-03-20");
      const result = pathResolver.computeTranscriptPath("Project Alpha", noteDate);

      expect(result).toBe("journal/2024/03/Project_Alpha-transcript.md");
    });

    it("should sanitize title in transcript filename", () => {
      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeTranscriptPath("Meeting: Q1 Planning", noteDate);

      expect(result).toBe("transcripts/Meeting_Q1_Planning-transcript.md");
    });

    it("should handle titles with special characters", () => {
      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeTranscriptPath("Test/File<Name>", noteDate);

      expect(result).toBe("transcripts/TestFileName-transcript.md");
    });

    it("should compute path using Granola folder structure when GRANOLA_FOLDERS is configured", () => {
      pathResolver = new PathResolver({
        transcriptDestination: TranscriptDestination.GRANOLA_FOLDERS,
        granolaTranscriptsFolder: "transcripts",
      }, "Granola");

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Meeting",
        folder_path: "Projects/2024",
      };

      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeTranscriptPath("Test Meeting", noteDate, doc);

      expect(result).toBe("Granola/Projects/2024/Test_Meeting-transcript.md");
    });

    it("should fallback to transcripts folder when doc not provided for GRANOLA_FOLDERS", () => {
      pathResolver = new PathResolver({
        transcriptDestination: TranscriptDestination.GRANOLA_FOLDERS,
        granolaTranscriptsFolder: "transcripts",
      }, "Granola");

      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeTranscriptPath("Test Meeting", noteDate);

      expect(result).toBe("transcripts/Test_Meeting-transcript.md");
    });
  });

  describe("computeGranolaFolderPath", () => {
    it("should use folder_path when available", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test",
        folder_path: "Projects/2024/Q1",
      };

      const result = pathResolver.computeGranolaFolderPath(doc, "Granola");

      expect(result).toBe("Granola/Projects/2024/Q1");
    });

    it("should fallback to folder when folder_path is not available", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test",
        folder: "Projects",
      };

      const result = pathResolver.computeGranolaFolderPath(doc, "Granola");

      expect(result).toBe("Granola/Projects");
    });

    it("should fallback to collection when folder and folder_path are not available", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test",
        collection: "My Collection",
      };

      const result = pathResolver.computeGranolaFolderPath(doc, "Granola");

      expect(result).toBe("Granola/My Collection");
    });

    it("should fallback to workspace when other folder fields are not available", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test",
        workspace: "My Workspace",
      };

      const result = pathResolver.computeGranolaFolderPath(doc, "Granola");

      expect(result).toBe("Granola/My Workspace");
    });

    it("should return base folder when no folder information is available", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test",
      };

      const result = pathResolver.computeGranolaFolderPath(doc, "Granola");

      expect(result).toBe("Granola");
    });

    it("should normalize paths with leading/trailing slashes", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test",
        folder_path: "/Projects/2024/",
      };

      const result = pathResolver.computeGranolaFolderPath(doc, "Granola");

      expect(result).toBe("Granola/Projects/2024");
    });

    it("should handle backslashes in paths", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test",
        folder_path: "Projects\\2024\\Q1",
      };

      const result = pathResolver.computeGranolaFolderPath(doc, "Granola");

      expect(result).toBe("Granola/Projects/2024/Q1");
    });

    it("should handle null folder values", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test",
        folder: null,
        folder_path: null,
        collection: null,
        workspace: null,
      };

      const result = pathResolver.computeGranolaFolderPath(doc, "Granola");

      expect(result).toBe("Granola");
    });

    it("should prioritize folder_path over folder", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test",
        folder_path: "Projects/2024",
        folder: "Old Folder",
      };

      const result = pathResolver.computeGranolaFolderPath(doc, "Granola");

      expect(result).toBe("Granola/Projects/2024");
    });
  });
});
