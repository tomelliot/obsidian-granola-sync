import { PathResolver } from "../../src/services/pathResolver";
import { GranolaSyncSettings, DEFAULT_SETTINGS } from "../../src/settings";
import { GranolaDoc } from "../../src/services/granolaApi";

// Mock obsidian-daily-notes-interface
jest.mock("obsidian-daily-notes-interface", () => ({
  getDailyNoteSettings: jest.fn(() => ({
    format: "YYYY-MM-DD",
    folder: "daily-notes",
  })),
}));

describe("PathResolver", () => {
  let settings: GranolaSyncSettings;
  let pathResolver: PathResolver;

  beforeEach(() => {
    settings = {
      ...DEFAULT_SETTINGS,
      saveAsIndividualFiles: true,
      baseFolderType: "custom",
      customBaseFolder: "granola",
      subfolderPattern: "none",
      filenamePattern: "{title}",
      transcriptHandling: "custom-location",
      customTranscriptBaseFolder: "transcripts",
      transcriptSubfolderPattern: "none",
      transcriptFilenamePattern: "{title}-transcript",
    };
    pathResolver = new PathResolver(settings);
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
      const {
        getDailyNoteSettings,
      } = require("obsidian-daily-notes-interface");
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
      const {
        getDailyNoteSettings,
      } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({
        format: "YYYY-MM-DD",
        folder: "",
      });

      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeDailyNoteFolderPath(noteDate);

      expect(result).toBe("");
    });

    it("should use default format when none provided", () => {
      const {
        getDailyNoteSettings,
      } = require("obsidian-daily-notes-interface");
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

  describe("computeTranscriptBaseFolder", () => {
    it("should return empty string for combined mode", () => {
      settings.transcriptHandling = "combined";
      pathResolver = new PathResolver(settings);

      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeTranscriptFolderPath(noteDate);

      expect(result).toBe("");
    });
  });

  describe("computeTranscriptPath", () => {
    it("should compute path to custom transcripts folder when configured", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Meeting",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("transcripts/Test Meeting-transcript.md");
    });

    it("should compute path with subfolder pattern when configured", () => {
      settings.transcriptSubfolderPattern = "day";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Project Alpha",
        created_at: "2024-03-20T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("transcripts/2024-03-20/Project Alpha-transcript.md");
    });

    it("should use same location as notes when configured", () => {
      settings.transcriptHandling = "same-location";
      settings.subfolderPattern = "month";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Project Alpha",
        created_at: "2024-03-20T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("granola/2024-03/Project Alpha-transcript.md");
    });

    it("should sanitize title in transcript filename", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Meeting: Q1 Planning",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("transcripts/Meeting_ Q1 Planning-transcript.md");
    });

    it("should handle titles with special characters", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test/File<Name>",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("transcripts/Test_File_Name_-transcript.md");
    });

    it("should use combined mode filename pattern", () => {
      settings.transcriptHandling = "combined";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Meeting",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("/Test Meeting-transcript.md");
    });

    it("should handle same-location with no subfolder", () => {
      settings.transcriptHandling = "same-location";
      settings.subfolderPattern = "none";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Meeting",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("granola/Test Meeting-transcript.md");
    });

    it("should handle custom-location with no subfolder", () => {
      settings.transcriptHandling = "custom-location";
      settings.transcriptSubfolderPattern = "none";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Meeting",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("transcripts/Test Meeting-transcript.md");
    });

    it("should handle same-location with subfolder", () => {
      settings.transcriptHandling = "same-location";
      settings.subfolderPattern = "day";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Meeting",
        created_at: "2024-03-15T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("granola/2024-03-15/Test Meeting-transcript.md");
    });

    it("should handle custom-location with subfolder", () => {
      settings.transcriptHandling = "custom-location";
      settings.transcriptSubfolderPattern = "month";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Meeting",
        created_at: "2024-03-15T10:00:00Z",
      };
      const result = pathResolver.computeTranscriptPath(doc);

      expect(result).toBe("transcripts/2024-03/Test Meeting-transcript.md");
    });
  });

  describe("computeNoteBaseFolder", () => {
    it("should return empty string when saveAsIndividualFiles is false", () => {
      settings.saveAsIndividualFiles = false;
      pathResolver = new PathResolver(settings);

      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeNoteFolderPath(noteDate);

      expect(result).toBe("");
    });
  });

  describe("computeNotePath", () => {
    it("should compute path to custom folder when configured", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Meeting",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeNotePath(doc);

      expect(result).toBe("granola/Test Meeting.md");
    });

    it("should compute path with day subfolder pattern", () => {
      settings.subfolderPattern = "day";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Project Alpha",
        created_at: "2024-03-20T10:00:00Z",
      };
      const result = pathResolver.computeNotePath(doc);

      expect(result).toBe("granola/2024-03-20/Project Alpha.md");
    });

    it("should compute path with year-month subfolder pattern", () => {
      settings.subfolderPattern = "year-month";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Project Alpha",
        created_at: "2024-03-20T10:00:00Z",
      };
      const result = pathResolver.computeNotePath(doc);

      expect(result).toBe("granola/2024/03/Project Alpha.md");
    });

    it("should use daily notes folder when configured", () => {
      const {
        getDailyNoteSettings,
      } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({
        format: "YYYY/MM/DD",
        folder: "journal",
      });

      settings.baseFolderType = "daily-notes";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Project Alpha",
        created_at: "2024-03-20T10:00:00Z",
      };
      const result = pathResolver.computeNotePath(doc);

      expect(result).toBe("journal/2024/03/Project Alpha.md");
    });

    it("should sanitize title in note filename", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Meeting: Q1 Planning",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeNotePath(doc);

      expect(result).toBe("granola/Meeting_ Q1 Planning.md");
    });

    it("should handle titles with special characters", () => {
      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test/File<Name>",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeNotePath(doc);

      expect(result).toBe("granola/Test_File_Name_.md");
    });

    it("should use custom filename pattern", () => {
      settings.filenamePattern = "{date}-{title}";
      pathResolver = new PathResolver(settings);

      const doc: GranolaDoc = {
        id: "doc-123",
        title: "Test Meeting",
        created_at: "2024-01-15T10:00:00Z",
      };
      const result = pathResolver.computeNotePath(doc);

      expect(result).toBe("granola/2024-01-15-Test Meeting.md");
    });
  });
});
