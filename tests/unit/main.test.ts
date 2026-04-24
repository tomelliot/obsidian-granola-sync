import GranolaSync from "../../src/main";
import { DEFAULT_SETTINGS, migrateSettingsToNewFormat } from "../../src/settings";
import {
  getAllDocuments,
  getRecentDocuments,
  fetchGranolaTranscript,
  GranolaDoc,
} from "../../src/services/granolaApi";
import { loadCredentials } from "../../src/services/credentials";
import { FileSyncService } from "../../src/services/fileSyncService";
import { DocumentProcessor } from "../../src/services/documentProcessor";
import { DailyNoteBuilder } from "../../src/services/dailyNoteBuilder";
import { PathResolver } from "../../src/services/pathResolver";
import { formatTranscriptBySpeaker } from "../../src/services/transcriptFormatter";
import { buildFolderMap, diffFolderMaps } from "../../src/services/folderMapBuilder";
import { getNoteDate } from "../../src/utils/dateUtils";
import { showStatusBar, hideStatusBar, showStatusBarTemporary } from "../../src/utils/statusBar";
import { log } from "../../src/utils/logger";
import { Notice, App } from "obsidian";
import moment from "moment";
import { getDailyNote, getAllDailyNotes } from "obsidian-daily-notes-interface";

// Mock dependencies with side effects
jest.mock("../../src/services/granolaApi");
jest.mock("../../src/services/credentials");
jest.mock("../../src/services/fileSyncService");
jest.mock("../../src/services/documentProcessor");
jest.mock("../../src/services/dailyNoteBuilder");
jest.mock("../../src/services/pathResolver");
jest.mock("../../src/services/transcriptFormatter");
jest.mock("../../src/services/folderMapBuilder");
jest.mock("../../src/utils/dateUtils");
jest.mock("../../src/utils/statusBar");
jest.mock("obsidian-daily-notes-interface");
jest.mock("moment", () => {
  const actualMoment = jest.requireActual("moment");
  const mockMoment = jest.fn((date?: string | Date) => {
    if (date) {
      return actualMoment(date);
    }
    return actualMoment();
  });
  return {
    __esModule: true,
    ...actualMoment,
    default: mockMoment,
  };
});

// Mock logger to avoid console noise in tests
jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("GranolaSync", () => {
  let plugin: GranolaSync;
  let mockApp: jest.Mocked<App>;
  let mockFileSyncService: jest.Mocked<FileSyncService>;
  let mockDocumentProcessor: jest.Mocked<DocumentProcessor>;
  let mockDailyNoteBuilder: jest.Mocked<DailyNoteBuilder>;
  let mockPathResolver: jest.Mocked<PathResolver>;

  beforeEach(() => {
    // Create mock app
    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
      workspace: {
        iterateAllLeaves: jest.fn(),
      },
    } as any;

    // Create mock services
    mockFileSyncService = {
      buildCache: jest.fn().mockResolvedValue(undefined),
      findByGranolaId: jest.fn().mockReturnValue(null),
      isRemoteNewer: jest.fn().mockReturnValue(true),
      saveNoteToDisk: jest.fn().mockResolvedValue({ saved: true, path: "Notes/test-note.md" }),
      saveTranscriptToDisk: jest.fn().mockResolvedValue({ saved: true, path: "Transcripts/test-transcript.md" }),
      saveCombinedNoteToDisk: jest.fn().mockResolvedValue({ saved: true, path: "Notes/test-note.md" }),
    } as any;

    mockDocumentProcessor = {
      prepareNote: jest.fn(),
      prepareTranscript: jest.fn(),
      prepareCombinedNote: jest.fn(),
      extractNoteForDailyNote: jest.fn(),
    } as any;

    mockDailyNoteBuilder = {
      buildDailyNotesMap: jest.fn().mockReturnValue(new Map()),
      getOrCreateDailyNote: jest.fn(),
      buildDailyNoteSectionContent: jest.fn(),
      updateDailyNoteSection: jest.fn(),
      addLinksToDailyNotes: jest.fn(),
    } as any;

    mockPathResolver = {
      computeNotePath: jest.fn(),
      getNoteFilenamePattern: jest.fn(),
      computeTranscriptFilenamePattern: jest.fn(),
    } as any;

    // Mock constructor returns - need to cast to any to access mockImplementation
    (FileSyncService as any).mockImplementation(() => mockFileSyncService);
    (DocumentProcessor as any).mockImplementation(() => mockDocumentProcessor);
    (DailyNoteBuilder as any).mockImplementation(() => mockDailyNoteBuilder);
    (PathResolver as any).mockImplementation(() => mockPathResolver);

    // Create plugin instance
    plugin = new GranolaSync(mockApp, { id: "test", name: "test" } as any);
    plugin.settings = { ...DEFAULT_SETTINGS };
    plugin.registerInterval = jest.fn();

    // Mock Notice
    (Notice as jest.Mock).mockImplementation(() => ({}));

    // Mock folder map builder
    (buildFolderMap as jest.Mock).mockResolvedValue({
      folders: {},
      docFolders: {},
      lastUpdated: Date.now(),
    });
    (diffFolderMaps as jest.Mock).mockReturnValue({ renamedPaths: new Map() });

    // Mock saveData to prevent actual writes
    plugin.saveData = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (plugin.syncIntervalId !== null) {
      window.clearInterval(plugin.syncIntervalId);
      plugin.syncIntervalId = null;
    }
  });

  describe("initializeServices", () => {
    it("should initialize all services with current settings", () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncTranscripts: true,
        includePrivateNotes: true,
      };

      // Access private method via type assertion
      (plugin as any).initializeServices();

      expect(PathResolver).toHaveBeenCalledWith(plugin.settings);
      expect(FileSyncService).toHaveBeenCalledWith(
        mockApp,
        mockPathResolver,
        expect.any(Function)
      );
      expect(DocumentProcessor).toHaveBeenCalledWith(
        {
          syncTranscripts: true,
          includePrivateNotes: true,
        },
        mockPathResolver
      );
      expect(DailyNoteBuilder).toHaveBeenCalledWith(mockApp, mockDocumentProcessor);
    });
  });

  describe("updateServices", () => {
    it("should recreate services when settings change", () => {
      plugin.settings = { ...DEFAULT_SETTINGS, syncTranscripts: false };
      (plugin as any).initializeServices();
      jest.clearAllMocks();

      plugin.settings = { ...DEFAULT_SETTINGS, syncTranscripts: true };
      (plugin as any).updateServices();

      expect(PathResolver).toHaveBeenCalled();
      expect(FileSyncService).toHaveBeenCalled();
      expect(DocumentProcessor).toHaveBeenCalled();
      expect(DailyNoteBuilder).toHaveBeenCalled();
    });
  });


  describe("setupPeriodicSync", () => {
    it("should setup interval when sync is enabled and interval > 0", () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        isSyncEnabled: true,
        syncInterval: 60,
      };
      const mockIntervalId = 123;
      window.setInterval = jest.fn().mockReturnValue(mockIntervalId);

      plugin.setupPeriodicSync();

      expect(window.setInterval).toHaveBeenCalledWith(
        expect.any(Function),
        60000
      );
      expect(plugin.syncIntervalId).toBe(mockIntervalId);
      expect(plugin.registerInterval).toHaveBeenCalledWith(mockIntervalId);
    });

    it("should not setup interval when sync is disabled", () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        isSyncEnabled: false,
        syncInterval: 60,
      };

      plugin.setupPeriodicSync();

      expect(window.setInterval).not.toHaveBeenCalled();
      expect(plugin.syncIntervalId).toBeNull();
    });

    it("should not setup interval when interval is 0", () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        isSyncEnabled: true,
        syncInterval: 0,
      };

      plugin.setupPeriodicSync();

      expect(window.setInterval).not.toHaveBeenCalled();
    });

    it("should clear existing interval before setting up new one", () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        isSyncEnabled: true,
        syncInterval: 60,
      };
      const oldIntervalId = 456;
      plugin.syncIntervalId = oldIntervalId;
      window.clearInterval = jest.fn();
      window.setInterval = jest.fn().mockReturnValue(789);

      plugin.setupPeriodicSync();

      expect(window.clearInterval).toHaveBeenCalledWith(oldIntervalId);
      expect(window.setInterval).toHaveBeenCalled();
    });
  });

  describe("clearPeriodicSync", () => {
    it("should clear interval when one exists", () => {
      const intervalId = 123;
      plugin.syncIntervalId = intervalId;
      window.clearInterval = jest.fn();

      plugin.clearPeriodicSync();

      expect(window.clearInterval).toHaveBeenCalledWith(intervalId);
      expect(plugin.syncIntervalId).toBeNull();
    });

    it("should not throw when no interval exists", () => {
      plugin.syncIntervalId = null;

      expect(() => plugin.clearPeriodicSync()).not.toThrow();
    });
  });

  describe("updateSyncStatus", () => {
    it("should update status bar with correct format", () => {
      (plugin as any).updateSyncStatus("Note", 5, 10);

      expect(showStatusBar).toHaveBeenCalledWith(
        plugin,
        "Granola sync: note 5/10"
      );
    });

    it("should clamp current to valid range", () => {
      (plugin as any).updateSyncStatus("Transcript", 15, 10);

      expect(showStatusBar).toHaveBeenCalledWith(
        plugin,
        "Granola sync: Transcript 10/10"
      );
    });

    it("should clamp current to minimum of 1", () => {
      (plugin as any).updateSyncStatus("Note", 0, 10);

      expect(showStatusBar).toHaveBeenCalledWith(
        plugin,
        "Granola sync: note 1/10"
      );
    });

    it("should return early when total is 0 or less", () => {
      (plugin as any).updateSyncStatus("Note", 5, 0);

      expect(showStatusBar).not.toHaveBeenCalled();
    });
  });

  describe("sync", () => {
    const mockAccessToken = "test-token";
    const mockDoc: GranolaDoc = {
      id: "doc-1",
      title: "Test Note",
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-01-15T12:00:00Z",
      last_viewed_panel: {
        content: {
          type: "doc",
          content: [],
        },
      },
    };

    beforeEach(() => {
      (loadCredentials as jest.Mock).mockResolvedValue({
        accessToken: mockAccessToken,
        error: null,
      });
      (getRecentDocuments as jest.Mock).mockResolvedValue([mockDoc]);
      (getAllDocuments as jest.Mock).mockResolvedValue([mockDoc]);
      (plugin as any).initializeServices();
    });

    it("should handle credential loading failure", async () => {
      (loadCredentials as jest.Mock).mockResolvedValue({
        accessToken: null,
        error: "No credentials found",
      });

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        "Granola sync error: No credentials found",
        10000
      );
      expect(hideStatusBar).toHaveBeenCalledWith(plugin);
      expect(getRecentDocuments).not.toHaveBeenCalled();
    });

    it("should handle 401 authentication error", async () => {
      const error = { status: 401 };
      (getRecentDocuments as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Authentication failed"),
        10000
      );
      expect(hideStatusBar).toHaveBeenCalledWith(plugin);
    });

    it("should handle 403 forbidden error", async () => {
      const error = { status: 403 };
      (getRecentDocuments as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Access forbidden"),
        10000
      );
    });

    it("should handle 404 not found error", async () => {
      const error = { status: 404 };
      (getRecentDocuments as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("API endpoint not found"),
        10000
      );
    });

    it("should handle 500+ server errors", async () => {
      const error = { status: 500 };
      (getRecentDocuments as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("server error"),
        10000
      );
    });

    it("should handle network errors", async () => {
      const error = new Error("Network error");
      (getRecentDocuments as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Failed to fetch documents"),
        10000
      );
    });

    it("should handle empty document responses in standard mode", async () => {
      (getRecentDocuments as jest.Mock).mockResolvedValue([]);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("No documents found within the last"),
        5000
      );
      expect(hideStatusBar).toHaveBeenCalledWith(plugin);
    });

    it("should handle empty document responses in full mode", async () => {
      (getAllDocuments as jest.Mock).mockResolvedValue([]);

      await plugin.sync({ mode: "full" });

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("No documents returned from Granola API"),
        5000
      );
    });

    it("should use full sync mode when specified", async () => {
      plugin.settings = { ...DEFAULT_SETTINGS, syncNotes: true, syncTranscripts: false };

      await plugin.sync({ mode: "full" });

      expect(getAllDocuments).toHaveBeenCalledWith(mockAccessToken, 100, true);
      expect(getRecentDocuments).not.toHaveBeenCalled();
    });

    it("should use standard mode by default", async () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: false,
        syncDaysBack: 7,
      };

      await plugin.sync();

      expect(getRecentDocuments).toHaveBeenCalledWith(
        mockAccessToken,
        7,
        100,
        true
      );
      expect(getAllDocuments).not.toHaveBeenCalled();
    });

    it("should sync both notes and transcripts when both enabled", async () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: true,
      };
      const mockTranscriptMap = new Map([["doc-1", []]]);
      (plugin as any).syncTranscripts = jest.fn().mockResolvedValue({
        transcriptDataMap: mockTranscriptMap,
      });
      (plugin as any).syncNotes = jest.fn().mockResolvedValue(undefined);
      (plugin as any).updateCrossLinks = jest.fn().mockResolvedValue(undefined);

      await plugin.sync();

      expect((plugin as any).syncTranscripts).toHaveBeenCalledWith(
        [mockDoc],
        mockAccessToken,
        false
      );
      expect((plugin as any).syncNotes).toHaveBeenCalledWith(
        [mockDoc],
        false,
        mockTranscriptMap,
        {}
      );
      expect((plugin as any).updateCrossLinks).toHaveBeenCalledWith([mockDoc]);
    });

    it("should use forceOverwrite in full sync mode", async () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: true,
      };
      const mockTranscriptMap = new Map([["doc-1", []]]);
      (plugin as any).syncTranscripts = jest.fn().mockResolvedValue({
        transcriptDataMap: mockTranscriptMap,
      });
      (plugin as any).syncNotes = jest.fn().mockResolvedValue(undefined);
      (plugin as any).updateCrossLinks = jest.fn().mockResolvedValue(undefined);

      await plugin.sync({ mode: "full" });

      expect((plugin as any).syncTranscripts).toHaveBeenCalledWith(
        [mockDoc],
        mockAccessToken,
        true
      );
      expect((plugin as any).syncNotes).toHaveBeenCalledWith(
        [mockDoc],
        true,
        mockTranscriptMap,
        {}
      );
    });

    it("should show success message after sync", async () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: false,
      };
      (plugin as any).syncNotes = jest.fn().mockResolvedValue(undefined);

      await plugin.sync();

      expect(showStatusBarTemporary).toHaveBeenCalledWith(
        plugin,
        "Granola sync: Complete"
      );
    });
  });

  describe("syncNotesToIndividualFiles no longer embeds transcript links", () => {
    const docWithContent: GranolaDoc = {
      id: "doc-link-1",
      title: "Transcript Link Test",
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-01-15T12:00:00Z",
      last_viewed_panel: {
        content: {
          type: "doc",
          content: [],
        },
      },
    };

    beforeEach(() => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: true,
        saveAsIndividualFiles: true,
        transcriptHandling: "custom-location",
      };
      (plugin as any).initializeServices();
      mockPathResolver.computeNotePath.mockReturnValue("daily-notes/Transcript Link Test.md");
      mockFileSyncService.saveNoteToDisk.mockResolvedValue({
        saved: true,
        path: "daily-notes/Transcript Link Test.md",
      });
    });

    it("should save notes without transcript path (cross-links deferred to updateCrossLinks)", async () => {
      await (plugin as any).syncNotesToIndividualFiles(
        [docWithContent],
        true,
        null,
        {}
      );

      expect(mockFileSyncService.saveNoteToDisk).toHaveBeenCalledWith(
        docWithContent,
        mockDocumentProcessor,
        true,
        undefined,
        undefined
      );
    });
  });

  describe("upsertFrontmatterField", () => {
    beforeEach(() => {
      plugin.settings = { ...DEFAULT_SETTINGS };
      (plugin as any).initializeServices();
    });

    it("should add a new field before the closing ---", () => {
      const content = [
        "---",
        "granola_id: doc-1",
        "title: Test",
        "type: note",
        "---",
        "",
        "Body content",
      ].join("\n");

      const result = (plugin as any).upsertFrontmatterField(
        content,
        "transcript",
        '"[[Transcripts/test.md]]"'
      );

      expect(result).toContain('transcript: "[[Transcripts/test.md]]"');
      expect(result).toMatch(/transcript:.*\n---/);
      expect(result).toContain("Body content");
    });

    it("should update an existing field value", () => {
      const content = [
        "---",
        "granola_id: doc-1",
        'transcript: "[[old-path.md]]"',
        "type: note",
        "---",
        "",
        "Body",
      ].join("\n");

      const result = (plugin as any).upsertFrontmatterField(
        content,
        "transcript",
        '"[[new-path.md]]"'
      );

      expect(result).toContain('transcript: "[[new-path.md]]"');
      expect(result).not.toContain("old-path.md");
    });

    it("should return content unchanged when no frontmatter exists", () => {
      const content = "No frontmatter here";
      const result = (plugin as any).upsertFrontmatterField(
        content,
        "transcript",
        '"[[path.md]]"'
      );
      expect(result).toBe(content);
    });

    it("should return content unchanged when field already has the target value", () => {
      const content = [
        "---",
        "granola_id: doc-1",
        'transcript: "[[path.md]]"',
        "---",
        "",
        "Body",
      ].join("\n");

      const result = (plugin as any).upsertFrontmatterField(
        content,
        "transcript",
        '"[[path.md]]"'
      );

      expect(result).toBe(content);
    });
  });

  describe("updateCrossLinks", () => {
    const doc: GranolaDoc = {
      id: "doc-cross-1",
      title: "Cross Link Test",
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-01-15T12:00:00Z",
      last_viewed_panel: {
        content: { type: "doc", content: [] },
      },
    };

    const noteFrontmatter = [
      "---",
      "granola_id: doc-cross-1",
      "title: Cross Link Test",
      "type: note",
      "---",
      "",
      "Note body",
    ].join("\n");

    const transcriptFrontmatter = [
      "---",
      "granola_id: doc-cross-1",
      "title: Cross Link Test - Transcript",
      "type: transcript",
      "---",
      "",
      "Transcript body",
    ].join("\n");

    beforeEach(() => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: true,
        saveAsIndividualFiles: true,
        transcriptHandling: "custom-location",
      };
      (plugin as any).initializeServices();
      mockApp.vault.read = jest.fn();
      mockApp.vault.modify = jest.fn().mockResolvedValue(undefined);
    });

    it("should update both note and transcript frontmatter with cross-links", async () => {
      const noteFile = { path: "Notes/Cross Link Test.md" };
      const transcriptFile = { path: "Transcripts/Cross Link Test - Transcript.md" };

      mockFileSyncService.findByGranolaId.mockImplementation((id, type) => {
        if (id === "doc-cross-1" && type === "note") return noteFile as any;
        if (id === "doc-cross-1" && type === "transcript") return transcriptFile as any;
        return null;
      });
      (mockApp.vault.read as jest.Mock)
        .mockResolvedValueOnce(noteFrontmatter)
        .mockResolvedValueOnce(transcriptFrontmatter);

      await (plugin as any).updateCrossLinks([doc]);

      expect(mockApp.vault.modify).toHaveBeenCalledTimes(2);
      // Note should get transcript link
      const noteCall = (mockApp.vault.modify as jest.Mock).mock.calls[0];
      expect(noteCall[0]).toBe(noteFile);
      expect(noteCall[1]).toContain(
        'transcript: "[[Transcripts/Cross Link Test - Transcript.md]]"'
      );
      // Transcript should get note link
      const transcriptCall = (mockApp.vault.modify as jest.Mock).mock.calls[1];
      expect(transcriptCall[0]).toBe(transcriptFile);
      expect(transcriptCall[1]).toContain(
        'note: "[[Notes/Cross Link Test.md]]"'
      );
    });

    it("should use collision-resolved paths from cache", async () => {
      const noteFile = { path: "Notes/Daily Scrum-2024-01-15_10-00-00.md" };
      const transcriptFile = { path: "Transcripts/Daily Scrum-2024-01-15_10-00-00 - Transcript.md" };

      mockFileSyncService.findByGranolaId.mockImplementation((id, type) => {
        if (id === "doc-cross-1" && type === "note") return noteFile as any;
        if (id === "doc-cross-1" && type === "transcript") return transcriptFile as any;
        return null;
      });
      (mockApp.vault.read as jest.Mock)
        .mockResolvedValueOnce(noteFrontmatter)
        .mockResolvedValueOnce(transcriptFrontmatter);

      await (plugin as any).updateCrossLinks([doc]);

      const noteCall = (mockApp.vault.modify as jest.Mock).mock.calls[0];
      expect(noteCall[1]).toContain(
        'transcript: "[[Transcripts/Daily Scrum-2024-01-15_10-00-00 - Transcript.md]]"'
      );
      const transcriptCall = (mockApp.vault.modify as jest.Mock).mock.calls[1];
      expect(transcriptCall[1]).toContain(
        'note: "[[Notes/Daily Scrum-2024-01-15_10-00-00.md]]"'
      );
    });

    it("should skip documents without both note and transcript files", async () => {
      mockFileSyncService.findByGranolaId.mockReturnValue(null);

      await (plugin as any).updateCrossLinks([doc]);

      expect(mockApp.vault.modify).not.toHaveBeenCalled();
    });

    it("should skip when transcriptHandling is combined", async () => {
      plugin.settings.transcriptHandling = "combined";

      await (plugin as any).updateCrossLinks([doc]);

      expect(mockFileSyncService.findByGranolaId).not.toHaveBeenCalled();
    });

    it("should not modify files when cross-links already match", async () => {
      const noteFile = { path: "Notes/Test.md" };
      const transcriptFile = { path: "Transcripts/Test - Transcript.md" };

      mockFileSyncService.findByGranolaId.mockImplementation((id, type) => {
        if (type === "note") return noteFile as any;
        if (type === "transcript") return transcriptFile as any;
        return null;
      });

      const noteWithLink = [
        "---",
        "granola_id: doc-cross-1",
        'transcript: "[[Transcripts/Test - Transcript.md]]"',
        "type: note",
        "---",
        "",
        "Body",
      ].join("\n");
      const transcriptWithLink = [
        "---",
        "granola_id: doc-cross-1",
        'note: "[[Notes/Test.md]]"',
        "type: transcript",
        "---",
        "",
        "Body",
      ].join("\n");

      (mockApp.vault.read as jest.Mock)
        .mockResolvedValueOnce(noteWithLink)
        .mockResolvedValueOnce(transcriptWithLink);

      await (plugin as any).updateCrossLinks([doc]);

      expect(mockApp.vault.modify).not.toHaveBeenCalled();
    });

    it("should handle daily notes mode with heading links for transcripts", async () => {
      plugin.settings.saveAsIndividualFiles = false;
      const transcriptFile = { path: "Transcripts/Test - Transcript.md" };

      mockFileSyncService.findByGranolaId.mockImplementation((id, type) => {
        if (type === "transcript") return transcriptFile as any;
        return null;
      });

      const mockDailyNoteFile = { basename: "2024-01-15" } as any;
      (getDailyNote as jest.Mock).mockReturnValue(mockDailyNoteFile);
      (getAllDailyNotes as jest.Mock).mockReturnValue({});
      (getNoteDate as jest.Mock).mockReturnValue(new Date("2024-01-15T10:00:00Z"));

      (mockApp.vault.read as jest.Mock)
        .mockResolvedValueOnce(transcriptFrontmatter);

      await (plugin as any).updateCrossLinks([doc]);

      expect(mockApp.vault.modify).toHaveBeenCalledTimes(1);
      const call = (mockApp.vault.modify as jest.Mock).mock.calls[0];
      expect(call[0]).toBe(transcriptFile);
      expect(call[1]).toContain('note: "[[2024-01-15#Cross Link Test]]"');
    });
  });

  describe("syncNotesToIndividualFiles synced note paths", () => {
    const docWithContent: GranolaDoc = {
      id: "doc-recurring-1",
      title: "Daily Scrum",
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-01-15T12:00:00Z",
      last_viewed_panel: {
        content: {
          type: "doc",
          content: [],
        },
      },
    };

    beforeEach(() => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: false,
        saveAsIndividualFiles: true,
      };
      (plugin as any).initializeServices();
      mockPathResolver.computeNotePath.mockReturnValue(
        "Granola/Notes/2024-01/Daily Scrum.md"
      );
    });

    // Simulates a recurring meeting: a prior occurrence in the month already
    // owns the clean filename, so this save was collision-resolved with a date
    // suffix. `syncedNotes` must carry the path returned by `saveNoteToDisk` so
    // that daily-note links resolve to this note and not the earlier one.
    it("should use the path returned by saveNoteToDisk for collision-resolved filenames", async () => {
      const actualSavedPath =
        "Granola/Notes/2024-01/Daily Scrum-2024-01-15_10-00-00.md";
      mockFileSyncService.saveNoteToDisk.mockResolvedValue({
        saved: true,
        path: actualSavedPath,
      });

      const result = await (plugin as any).syncNotesToIndividualFiles(
        [docWithContent],
        true,
        null,
        {}
      );

      expect(result.syncedNotes).toEqual([
        { doc: docWithContent, notePath: actualSavedPath },
      ]);
    });

    it("should fall back to the computed path when saveNoteToDisk returns a null path", async () => {
      mockFileSyncService.saveNoteToDisk.mockResolvedValue({
        saved: true,
        path: null,
      });

      const result = await (plugin as any).syncNotesToIndividualFiles(
        [docWithContent],
        true,
        null,
        {}
      );

      expect(result.syncedNotes).toEqual([
        {
          doc: docWithContent,
          notePath: "Granola/Notes/2024-01/Daily Scrum.md",
        },
      ]);
    });
  });

});
