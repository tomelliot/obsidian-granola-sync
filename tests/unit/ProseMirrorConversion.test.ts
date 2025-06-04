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

describe("ProseMirror to Markdown Conversion", () => {
  let plugin: GranolaSync;

  beforeEach(() => {
    // Create a mock app object
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
    // Set up default settings to avoid issues
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

  describe("convertProsemirrorToMarkdown", () => {
    it("should handle empty or null documents", () => {
      // @ts-ignore - accessing private method for testing
      expect(plugin.convertProsemirrorToMarkdown(null)).toBe("");
      // @ts-ignore
      expect(plugin.convertProsemirrorToMarkdown(undefined)).toBe("");
      // @ts-ignore
      expect(plugin.convertProsemirrorToMarkdown({})).toBe("");
    });

    it("should convert simple paragraphs", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "This is a simple paragraph."
              }
            ]
          }
        ]
      };

      // @ts-ignore
      const result = plugin.convertProsemirrorToMarkdown(doc);
      expect(result).toBe("This is a simple paragraph.");
    });

    it("should convert headings with correct levels", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [
              {
                type: "text",
                text: "Main Heading"
              }
            ]
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [
              {
                type: "text",
                text: "Sub Heading"
              }
            ]
          },
          {
            type: "heading",
            attrs: { level: 3 },
            content: [
              {
                type: "text",
                text: "Sub Sub Heading"
              }
            ]
          }
        ]
      };

      // @ts-ignore
      const result = plugin.convertProsemirrorToMarkdown(doc);
      expect(result).toBe("# Main Heading\n\n## Sub Heading\n\n### Sub Sub Heading");
    });

    it("should convert bullet lists properly", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "First item"
                      }
                    ]
                  }
                ]
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Second item"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      // @ts-ignore
      const result = plugin.convertProsemirrorToMarkdown(doc);
      expect(result).toBe("- First item\n- Second item");
    });

    it("should handle mixed content with proper spacing", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [
              {
                type: "text",
                text: "Meeting Notes"
              }
            ]
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "This was a productive meeting."
              }
            ]
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Action item 1"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      // @ts-ignore
      const result = plugin.convertProsemirrorToMarkdown(doc);
      expect(result).toBe("# Meeting Notes\n\nThis was a productive meeting.\n\n- Action item 1");
    });

    it("should handle empty paragraphs and excessive newlines", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "First paragraph"
              }
            ]
          },
          {
            type: "paragraph",
            content: []
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Second paragraph"
              }
            ]
          }
        ]
      };

      // @ts-ignore
      const result = plugin.convertProsemirrorToMarkdown(doc);
      expect(result).toBe("First paragraph\n\nSecond paragraph");
    });

    it("should handle unknown node types gracefully", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "unknownType",
            content: [
              {
                type: "text",
                text: "This has unknown type"
              }
            ]
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "But this is normal"
              }
            ]
          }
        ]
      };

      // @ts-ignore
      const result = plugin.convertProsemirrorToMarkdown(doc);
      expect(result).toBe("This has unknown typeBut this is normal");
    });
  });
});