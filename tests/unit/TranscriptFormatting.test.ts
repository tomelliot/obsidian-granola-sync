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
  getDailyNoteSettings: jest.fn(() => ({ format: "YYYY-MM-DD", folder: "" })),
}));

jest.mock("../../src/services/credentials", () => ({
  loadCredentials: jest.fn(() => Promise.resolve({ accessToken: "test-token", error: null })),
  stopCredentialsServer: jest.fn(),
}));

describe("Transcript Formatting", () => {
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

  describe("formatTranscriptBySpeaker", () => {
    it("should format transcript with speaker grouping", () => {
      const transcriptData = [
        {
          document_id: "doc1",
          start_timestamp: "10:30:00",
          text: "Hello everyone, welcome to the meeting.",
          source: "microphone",
          id: "1",
          is_final: true,
          end_timestamp: "10:30:05"
        },
        {
          document_id: "doc1",
          start_timestamp: "10:30:06",
          text: "Thanks for having me.",
          source: "system_audio",
          id: "2",
          is_final: true,
          end_timestamp: "10:30:08"
        },
        {
          document_id: "doc1",
          start_timestamp: "10:30:09",
          text: "Let's start with the agenda.",
          source: "microphone",
          id: "3",
          is_final: true,
          end_timestamp: "10:30:12"
        }
      ];

      // @ts-ignore - accessing private method for testing
      const result = plugin.formatTranscriptBySpeaker(transcriptData, "Team Meeting");

      expect(result).toContain("# Transcript for: Team Meeting");
      expect(result).toContain("## Tom Elliot (10:30:00)");
      expect(result).toContain("Hello everyone, welcome to the meeting. Let's start with the agenda.");
      expect(result).toContain("## Guest (10:30:06)");
      expect(result).toContain("Thanks for having me.");
    });

    it("should handle single speaker transcript", () => {
      const transcriptData = [
        {
          document_id: "doc1",
          start_timestamp: "14:00:00",
          text: "This is a monologue.",
          source: "microphone",
          id: "1",
          is_final: true,
          end_timestamp: "14:00:03"
        },
        {
          document_id: "doc1",
          start_timestamp: "14:00:04",
          text: "Continuing with more thoughts.",
          source: "microphone",
          id: "2",
          is_final: true,
          end_timestamp: "14:00:08"
        }
      ];

      // @ts-ignore
      const result = plugin.formatTranscriptBySpeaker(transcriptData, "Personal Notes");

      expect(result).toContain("# Transcript for: Personal Notes");
      expect(result).toContain("## Tom Elliot (14:00:00)");
      expect(result).toContain("This is a monologue. Continuing with more thoughts.");
      // Should not contain a Guest section
      expect(result).not.toContain("## Guest");
    });

    it("should handle empty transcript data", () => {
      const transcriptData: any[] = [];

      // @ts-ignore
      const result = plugin.formatTranscriptBySpeaker(transcriptData, "Empty Meeting");

      expect(result).toBe("# Transcript for: Empty Meeting\n\n");
    });

    it("should handle alternating speakers correctly", () => {
      const transcriptData = [
        {
          document_id: "doc1",
          start_timestamp: "09:00:00",
          text: "Question one:",
          source: "microphone",
          id: "1",
          is_final: true,
          end_timestamp: "09:00:02"
        },
        {
          document_id: "doc1",
          start_timestamp: "09:00:03",
          text: "Answer one.",
          source: "system_audio",
          id: "2",
          is_final: true,
          end_timestamp: "09:00:05"
        },
        {
          document_id: "doc1",
          start_timestamp: "09:00:06",
          text: "Question two:",
          source: "microphone",
          id: "3",
          is_final: true,
          end_timestamp: "09:00:08"
        },
        {
          document_id: "doc1",
          start_timestamp: "09:00:09",
          text: "Answer two.",
          source: "system_audio",
          id: "4",
          is_final: true,
          end_timestamp: "09:00:11"
        }
      ];

      // @ts-ignore
      const result = plugin.formatTranscriptBySpeaker(transcriptData, "Interview");

      expect(result).toContain("## Tom Elliot (09:00:00)");
      expect(result).toContain("Question one:");
      expect(result).toContain("## Guest (09:00:03)");
      expect(result).toContain("Answer one.");
      expect(result).toContain("## Tom Elliot (09:00:06)");
      expect(result).toContain("Question two:");
      expect(result).toContain("## Guest (09:00:09)");
      expect(result).toContain("Answer two.");
    });

    it("should combine consecutive messages from same speaker", () => {
      const transcriptData = [
        {
          document_id: "doc1",
          start_timestamp: "11:15:00",
          text: "First part of thought.",
          source: "microphone",
          id: "1",
          is_final: true,
          end_timestamp: "11:15:03"
        },
        {
          document_id: "doc1",
          start_timestamp: "11:15:04",
          text: "Second part of thought.",
          source: "microphone",
          id: "2",
          is_final: true,
          end_timestamp: "11:15:07"
        },
        {
          document_id: "doc1",
          start_timestamp: "11:15:08",
          text: "Final part of thought.",
          source: "microphone",
          id: "3",
          is_final: true,
          end_timestamp: "11:15:11"
        }
      ];

      // @ts-ignore
      const result = plugin.formatTranscriptBySpeaker(transcriptData, "Long Thought");

      // Should have only one speaker section despite multiple entries
      const speakerMatches = result.match(/## Tom Elliot/g);
      expect(speakerMatches).toHaveLength(1);
      expect(result).toContain("First part of thought. Second part of thought. Final part of thought.");
    });

    it("should handle special characters in title", () => {
      const transcriptData = [
        {
          document_id: "doc1",
          start_timestamp: "16:00:00",
          text: "Testing special characters.",
          source: "microphone",
          id: "1",
          is_final: true,
          end_timestamp: "16:00:03"
        }
      ];

      // @ts-ignore
      const result = plugin.formatTranscriptBySpeaker(transcriptData, "Meeting: Q1 Review & Planning");

      expect(result).toContain("# Transcript for: Meeting: Q1 Review & Planning");
    });
  });
});