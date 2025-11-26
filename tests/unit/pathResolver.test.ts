import { PathResolver } from "../../src/services/pathResolver";
import { TranscriptDestination, TranscriptSettings, SyncDestination, NoteSettings } from "../../src/settings";

// Mock obsidian-daily-notes-interface
jest.mock("obsidian-daily-notes-interface", () => ({
  getDailyNoteSettings: jest.fn(() => ({
    format: "YYYY-MM-DD",
    folder: "daily-notes",
  })),
}));

describe("PathResolver", () => {
  let settings: Pick<TranscriptSettings, 'transcriptDestination' | 'granolaTranscriptsFolder'> &
                 Pick<NoteSettings, 'syncDestination' | 'granolaFolder'>;
  let pathResolver: PathResolver;

  beforeEach(() => {
    settings = {
      transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
      granolaTranscriptsFolder: "transcripts",
      syncDestination: SyncDestination.GRANOLA_FOLDER,
      granolaFolder: "granola",
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

      expect(result).toBe("transcripts/Test Meeting-transcript.md");
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
        syncDestination: SyncDestination.GRANOLA_FOLDER,
        granolaFolder: "granola",
      });

      const noteDate = new Date("2024-03-20");
      const result = pathResolver.computeTranscriptPath("Project Alpha", noteDate);

      expect(result).toBe("journal/2024/03/Project Alpha-transcript.md");
    });

    it("should sanitize title in transcript filename", () => {
      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeTranscriptPath("Meeting: Q1 Planning", noteDate);

      expect(result).toBe("transcripts/Meeting_ Q1 Planning-transcript.md");
    });

    it("should handle titles with special characters", () => {
      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeTranscriptPath("Test/File<Name>", noteDate);

      expect(result).toBe("transcripts/Test_File_Name_-transcript.md");
    });
  });

  describe("computeNotePath", () => {
    it("should compute path to granola folder when configured", () => {
      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeNotePath("Test Meeting", noteDate);

      expect(result).toBe("granola/Test Meeting.md");
    });

    it("should compute path to daily note folder structure when configured", () => {
      const { getDailyNoteSettings } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({
        format: "YYYY/MM/DD",
        folder: "journal",
      });

      pathResolver = new PathResolver({
        transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
        granolaTranscriptsFolder: "transcripts",
        syncDestination: SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE,
        granolaFolder: "granola",
      });

      const noteDate = new Date("2024-03-20");
      const result = pathResolver.computeNotePath("Project Alpha", noteDate);

      expect(result).toBe("journal/2024/03/Project Alpha.md");
    });

    it("should sanitize title in note filename", () => {
      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeNotePath("Meeting: Q1 Planning", noteDate);

      expect(result).toBe("granola/Meeting_ Q1 Planning.md");
    });

    it("should handle titles with special characters", () => {
      const noteDate = new Date("2024-01-15");
      const result = pathResolver.computeNotePath("Test/File<Name>", noteDate);

      expect(result).toBe("granola/Test_File_Name_.md");
    });

    it("should place notes in vault root when configured", () => {
      pathResolver = new PathResolver({
        transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
        granolaTranscriptsFolder: "transcripts",
        syncDestination: SyncDestination.VAULT_ROOT,
        granolaFolder: "granola",
      });

      const noteDate = new Date("2024-05-10");
      const result = pathResolver.computeNotePath("Root Level Note", noteDate);

      expect(result).toBe("Root Level Note.md");
    });
  });
});
