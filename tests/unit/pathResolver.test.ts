import { PathResolver, PathResolverSettings } from "../../src/services/pathResolver";
import { SyncDestination, TranscriptDestination } from "../../src/settings";

// Mock dependencies
jest.mock("obsidian-daily-notes-interface");
jest.mock("obsidian", () => ({
  normalizePath: jest.fn((path: string) => path),
  PluginSettingTab: class {},
}));

import { getDailyNoteSettings } from "obsidian-daily-notes-interface";

describe("PathResolver", () => {
  let resolver: PathResolver;
  let mockSettings: PathResolverSettings;

  beforeEach(() => {
    mockSettings = {
      granolaFolder: "Granola",
      granolaTranscriptsFolder: "Granola/Transcripts",
      syncDestination: SyncDestination.GRANOLA_FOLDER,
      transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
    };

    resolver = new PathResolver(mockSettings);

    // Default mock for daily note settings
    (getDailyNoteSettings as jest.Mock).mockReturnValue({
      format: "YYYY-MM-DD",
      folder: "Daily Notes",
    });
  });

  describe("resolveDailyNoteFolder", () => {
    it("should resolve folder path with default format", () => {
      const date = new Date("2024-01-15");
      const result = resolver.resolveDailyNoteFolder(date);

      expect(result).toBe("Daily Notes");
    });

    it("should handle nested folder structures in daily note format", () => {
      (getDailyNoteSettings as jest.Mock).mockReturnValue({
        format: "YYYY/MM/YYYY-MM-DD",
        folder: "Daily",
      });

      const date = new Date("2024-01-15");
      const result = resolver.resolveDailyNoteFolder(date);

      expect(result).toBe("Daily/2024/01");
    });

    it("should handle empty base folder", () => {
      (getDailyNoteSettings as jest.Mock).mockReturnValue({
        format: "YYYY-MM-DD",
        folder: "",
      });

      const date = new Date("2024-01-15");
      const result = resolver.resolveDailyNoteFolder(date);

      expect(result).toBe("");
    });

    it("should handle format without folder structure", () => {
      (getDailyNoteSettings as jest.Mock).mockReturnValue({
        format: "YYYY-MM-DD",
        folder: "Notes",
      });

      const date = new Date("2024-01-15");
      const result = resolver.resolveDailyNoteFolder(date);

      expect(result).toBe("Notes");
    });

    it("should handle multi-level folder structures", () => {
      (getDailyNoteSettings as jest.Mock).mockReturnValue({
        format: "YYYY/MM/DD/note",
        folder: "Root",
      });

      const date = new Date("2024-01-15");
      const result = resolver.resolveDailyNoteFolder(date);

      // Should exclude the last part (note)
      expect(result).toBe("Root/2024/01/15");
    });
  });

  describe("resolveTranscriptPath", () => {
    it("should resolve transcript path to Granola transcripts folder", () => {
      const result = resolver.resolveTranscriptPath("My Meeting", new Date("2024-01-15"));

      expect(result).toBe("Granola/Transcripts/My_Meeting-transcript.md");
    });

    it("should resolve transcript path to daily note folder structure", () => {
      mockSettings.transcriptDestination =
        TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE;
      resolver = new PathResolver(mockSettings);

      const result = resolver.resolveTranscriptPath("My Meeting", new Date("2024-01-15"));

      expect(result).toBe("Daily Notes/My_Meeting-transcript.md");
    });

    it("should sanitize filename in transcript path", () => {
      const result = resolver.resolveTranscriptPath(
        "Meeting: With *Special* Chars",
        new Date("2024-01-15")
      );

      expect(result).toBe("Granola/Transcripts/Meeting_With_Special_Chars-transcript.md");
    });
  });

  describe("resolveFolderPath", () => {
    describe("for transcripts", () => {
      it("should resolve to daily note folder structure", () => {
        mockSettings.transcriptDestination =
          TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE;
        resolver = new PathResolver(mockSettings);

        const result = resolver.resolveFolderPath(new Date("2024-01-15"), true);

        expect(result).toBe("Daily Notes");
      });

      it("should resolve to granola transcripts folder", () => {
        const result = resolver.resolveFolderPath(new Date("2024-01-15"), true);

        expect(result).toBe("Granola/Transcripts");
      });
    });

    describe("for notes", () => {
      it("should resolve to daily note folder structure", () => {
        mockSettings.syncDestination = SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE;
        resolver = new PathResolver(mockSettings);

        const result = resolver.resolveFolderPath(new Date("2024-01-15"), false);

        expect(result).toBe("Daily Notes");
      });

      it("should resolve to granola folder", () => {
        const result = resolver.resolveFolderPath(new Date("2024-01-15"), false);

        expect(result).toBe("Granola");
      });

      it("should handle DAILY_NOTES destination", () => {
        mockSettings.syncDestination = SyncDestination.DAILY_NOTES;
        resolver = new PathResolver(mockSettings);

        const result = resolver.resolveFolderPath(new Date("2024-01-15"), false);

        // Should fallback to granola folder
        expect(result).toBe("Granola");
      });
    });
  });

  describe("updateSettings", () => {
    it("should update settings", () => {
      const newSettings: PathResolverSettings = {
        granolaFolder: "NewFolder",
        granolaTranscriptsFolder: "NewFolder/Transcripts",
        syncDestination: SyncDestination.GRANOLA_FOLDER,
        transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
      };

      resolver.updateSettings(newSettings);

      const result = resolver.resolveFolderPath(new Date("2024-01-15"), false);
      expect(result).toBe("NewFolder");
    });
  });
});
