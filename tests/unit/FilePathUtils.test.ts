import GranolaSync from "../../src/main";
import { SyncDestination, TranscriptDestination } from "../../src/settings";

// Mock Obsidian dependencies
jest.mock("obsidian", () => ({
  Plugin: class MockPlugin {
    settings: any = {};
    app: any = {};
    addStatusBarItem = jest.fn(() => ({ setText: jest.fn() }));
    addCommand = jest.fn();
    addSettingTab = jest.fn();
    registerInterval = jest.fn();
    loadData = jest.fn(() => Promise.resolve({}));
    saveData = jest.fn(() => Promise.resolve());
  },
  PluginSettingTab: class MockPluginSettingTab {
    containerEl: any = { createEl: jest.fn(() => ({ setText: jest.fn(), createEl: jest.fn() })) };
  },
  Notice: jest.fn(),
  requestUrl: jest.fn(),
  normalizePath: (path: string) => path,
}));

jest.mock("obsidian-daily-notes-interface", () => ({
  createDailyNote: jest.fn(),
  getDailyNote: jest.fn(),
  getAllDailyNotes: jest.fn(),
  getDailyNoteSettings: jest.fn(() => ({ format: "YYYY-MM-DD", folder: "DailyNotes" })),
}));

jest.mock("../../src/services/credentials", () => ({
  loadCredentials: jest.fn(() => Promise.resolve({ accessToken: "test-token", error: null })),
  stopCredentialsServer: jest.fn(),
}));

jest.mock("moment", () => {
  const originalMoment = jest.requireActual("moment");
  return (date?: any) => {
    if (date) return originalMoment(date);
    return originalMoment("2024-01-15T10:30:00Z");
  };
});

describe("File Path Utilities", () => {
  let plugin: GranolaSync;

  beforeEach(() => {
    const mockApp = {
      vault: {
        adapter: {
          exists: jest.fn(() => Promise.resolve(true)),
          write: jest.fn(() => Promise.resolve()),
        },
        createFolder: jest.fn(() => Promise.resolve()),
        read: jest.fn(() => Promise.resolve("")),
        modify: jest.fn(() => Promise.resolve()),
      },
      workspace: {
        containerEl: {
          querySelector: jest.fn(() => ({ setText: jest.fn() })),
        },
      },
    } as any;

    plugin = new GranolaSync(mockApp, {} as any);
    plugin.settings = {
      syncNotes: true,
      syncTranscripts: true,
      syncDestination: SyncDestination.GRANOLA_FOLDER,
      transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
      granolaFolder: "Granola",
      granolaTranscriptsFolder: "Transcripts",
      dailyNoteSectionHeading: "## Granola Notes",
      createLinkFromNoteToTranscript: false,
      isSyncEnabled: false,
      syncInterval: 300,
      latestSyncTime: 0,
      tokenPath: "configs/supabase.json",
    };
  });

  describe("sanitizeFilename", () => {
    it("should remove invalid filename characters", () => {
      // @ts-ignore - accessing private method for testing
      expect(plugin.sanitizeFilename("File<Name>With:Invalid/Characters")).toBe("FileNameWithInvalidCharacters");
      // @ts-ignore
      expect(plugin.sanitizeFilename('File"With|Bad*Chars?')).toBe("FileWithBadChars");
      // @ts-ignore
      expect(plugin.sanitizeFilename("File\\With\\Backslashes")).toBe("FileWithBackslashes");
    });

    it("should replace spaces with underscores", () => {
      // @ts-ignore
      expect(plugin.sanitizeFilename("Meeting Notes From Today")).toBe("Meeting_Notes_From_Today");
      // @ts-ignore
      expect(plugin.sanitizeFilename("Multiple   Spaces   Here")).toBe("Multiple_Spaces_Here");
    });

    it("should truncate very long filenames", () => {
      const longName = "a".repeat(250);
      // @ts-ignore
      const result = plugin.sanitizeFilename(longName);
      expect(result.length).toBe(200);
      expect(result).toBe("a".repeat(200));
    });

    it("should handle empty or unusual input", () => {
      // @ts-ignore
      expect(plugin.sanitizeFilename("")).toBe("");
      // @ts-ignore
      expect(plugin.sanitizeFilename("   ")).toBe("");
      // @ts-ignore
      expect(plugin.sanitizeFilename("///")).toBe("");
    });
  });

  describe("computeDailyNoteFolderPath", () => {
    it("should compute folder path based on daily note settings", () => {
      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore - accessing private method for testing
      const result = plugin.computeDailyNoteFolderPath(testDate);
      
      // Should combine base folder with computed date path, excluding filename
      expect(result).toBe("DailyNotes");
    });

    it("should handle date with folder structure in format", () => {
      // Mock getDailyNoteSettings to return a format with folders
      const { getDailyNoteSettings } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({ 
        format: "YYYY/MM/YYYY-MM-DD", 
        folder: "Journal" 
      });

      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore
      const result = plugin.computeDailyNoteFolderPath(testDate);
      
      expect(result).toBe("Journal/2024/01");
    });

    it("should handle empty base folder", () => {
      const { getDailyNoteSettings } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({ 
        format: "YYYY-MM-DD", 
        folder: "" 
      });

      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore
      const result = plugin.computeDailyNoteFolderPath(testDate);
      
      expect(result).toBe("");
    });
  });

  describe("computeTranscriptPath", () => {
    it("should compute transcript path for granola transcripts folder", () => {
      plugin.settings.transcriptDestination = TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER;
      plugin.settings.granolaTranscriptsFolder = "Meeting-Transcripts";
      
      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore
      const result = plugin.computeTranscriptPath("Team Meeting", testDate);
      
      expect(result).toBe("Meeting-Transcripts/Team_Meeting-transcript.md");
    });

    it("should compute transcript path for daily note folder structure", () => {
      plugin.settings.transcriptDestination = TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE;
      
      const { getDailyNoteSettings } = require("obsidian-daily-notes-interface");
      getDailyNoteSettings.mockReturnValue({ 
        format: "YYYY-MM-DD", 
        folder: "DailyNotes" 
      });
      
      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore
      const result = plugin.computeTranscriptPath("Team Meeting", testDate);
      
      expect(result).toBe("DailyNotes/Team_Meeting-transcript.md");
    });

    it("should sanitize filename in transcript path", () => {
      plugin.settings.transcriptDestination = TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER;
      plugin.settings.granolaTranscriptsFolder = "Transcripts";
      
      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore
      const result = plugin.computeTranscriptPath("Meeting: Q1 Planning/Review", testDate);
      
      expect(result).toBe("Transcripts/Meeting_Q1_PlanningReview-transcript.md");
    });
  });

  describe("saveToDisk", () => {
    it("should save file to correct path for notes", async () => {
      plugin.settings.syncDestination = SyncDestination.GRANOLA_FOLDER;
      plugin.settings.granolaFolder = "MyGranola";
      
      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore
      const result = await plugin.saveToDisk("test-note.md", "# Test Content", testDate, false);
      
      expect(result).toBe(true);
      expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith(
        "MyGranola/test-note.md",
        "# Test Content"
      );
    });

    it("should save file to correct path for transcripts", async () => {
      plugin.settings.transcriptDestination = TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER;
      plugin.settings.granolaTranscriptsFolder = "MyTranscripts";
      
      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore
      const result = await plugin.saveToDisk("test-transcript.md", "# Transcript", testDate, true);
      
      expect(result).toBe(true);
      expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith(
        "MyTranscripts/test-transcript.md",
        "# Transcript"
      );
    });

    it("should handle folder creation errors gracefully", async () => {
      (plugin.app.vault.adapter.exists as jest.Mock).mockResolvedValue(false);
      (plugin.app.vault.createFolder as jest.Mock).mockRejectedValue(new Error("Permission denied"));
      
      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore
      const result = await plugin.saveToDisk("test.md", "content", testDate, false);
      
      expect(result).toBe(false);
    });

    it("should handle file write errors gracefully", async () => {
      (plugin.app.vault.adapter.write as jest.Mock).mockRejectedValue(new Error("Disk full"));
      
      const testDate = new Date("2024-01-15T10:30:00Z");
      
      // @ts-ignore
      const result = await plugin.saveToDisk("test.md", "content", testDate, false);
      
      expect(result).toBe(false);
    });
  });
});