import GranolaSync from "../../src/main";
import { DEFAULT_SETTINGS, migrateSettingsToNewFormat } from "../../src/settings";
import {
  fetchAllGranolaDocuments,
  fetchGranolaDocumentsByDaysBack,
  fetchGranolaTranscript,
  GranolaDoc,
} from "../../src/services/granolaApi";
import { loadCredentials } from "../../src/services/credentials";
import { FileSyncService } from "../../src/services/fileSyncService";
import { DocumentProcessor } from "../../src/services/documentProcessor";
import { DailyNoteBuilder } from "../../src/services/dailyNoteBuilder";
import { PathResolver } from "../../src/services/pathResolver";
import { formatTranscriptBySpeaker } from "../../src/services/transcriptFormatter";
import { getNoteDate } from "../../src/utils/dateUtils";
import { showStatusBar, hideStatusBar, showStatusBarTemporary } from "../../src/utils/statusBar";
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
jest.mock("../../src/utils/dateUtils");
jest.mock("../../src/utils/statusBar");
jest.mock("obsidian-daily-notes-interface");
jest.mock("moment", () => {
  const actualMoment = jest.requireActual("moment");
  return {
    ...actualMoment,
    default: jest.fn((date?: string) => {
      if (date) {
        return actualMoment(date);
      }
      return actualMoment();
    }),
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
      saveNoteToDisk: jest.fn().mockResolvedValue(true),
      saveTranscriptToDisk: jest.fn().mockResolvedValue(true),
      saveCombinedNoteToDisk: jest.fn().mockResolvedValue(true),
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
      computeTranscriptPath: jest.fn(),
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
      (fetchGranolaDocumentsByDaysBack as jest.Mock).mockResolvedValue([mockDoc]);
      (fetchAllGranolaDocuments as jest.Mock).mockResolvedValue([mockDoc]);
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
      expect(fetchGranolaDocumentsByDaysBack).not.toHaveBeenCalled();
    });

    it("should handle 401 authentication error", async () => {
      const error = { status: 401 };
      (fetchGranolaDocumentsByDaysBack as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Authentication failed"),
        10000
      );
      expect(hideStatusBar).toHaveBeenCalledWith(plugin);
    });

    it("should handle 403 forbidden error", async () => {
      const error = { status: 403 };
      (fetchGranolaDocumentsByDaysBack as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Access forbidden"),
        10000
      );
    });

    it("should handle 404 not found error", async () => {
      const error = { status: 404 };
      (fetchGranolaDocumentsByDaysBack as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("API endpoint not found"),
        10000
      );
    });

    it("should handle 500+ server errors", async () => {
      const error = { status: 500 };
      (fetchGranolaDocumentsByDaysBack as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("server error"),
        10000
      );
    });

    it("should handle network errors", async () => {
      const error = new Error("Network error");
      (fetchGranolaDocumentsByDaysBack as jest.Mock).mockRejectedValue(error);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Failed to fetch documents"),
        10000
      );
    });

    it("should handle empty document responses in standard mode", async () => {
      (fetchGranolaDocumentsByDaysBack as jest.Mock).mockResolvedValue([]);

      await plugin.sync();

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("No documents found within the last"),
        5000
      );
      expect(hideStatusBar).toHaveBeenCalledWith(plugin);
    });

    it("should handle empty document responses in full mode", async () => {
      (fetchAllGranolaDocuments as jest.Mock).mockResolvedValue([]);

      await plugin.sync({ mode: "full" });

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("No documents returned from Granola API"),
        5000
      );
    });

    it("should use full sync mode when specified", async () => {
      plugin.settings = { ...DEFAULT_SETTINGS, syncNotes: true, syncTranscripts: false };

      await plugin.sync({ mode: "full" });

      expect(fetchAllGranolaDocuments).toHaveBeenCalledWith(mockAccessToken);
      expect(fetchGranolaDocumentsByDaysBack).not.toHaveBeenCalled();
    });

    it("should use standard mode by default", async () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: false,
        syncDaysBack: 7,
      };

      await plugin.sync();

      expect(fetchGranolaDocumentsByDaysBack).toHaveBeenCalledWith(
        mockAccessToken,
        7
      );
      expect(fetchAllGranolaDocuments).not.toHaveBeenCalled();
    });

    it("should sync both notes and transcripts when both enabled", async () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: true,
      };
      const mockTranscriptMap = new Map([["doc-1", []]]);
      (plugin as any).syncTranscripts = jest.fn().mockResolvedValue(mockTranscriptMap);
      (plugin as any).syncNotes = jest.fn().mockResolvedValue(undefined);

      await plugin.sync();

      expect((plugin as any).syncTranscripts).toHaveBeenCalledWith(
        [mockDoc],
        mockAccessToken,
        false
      );
      expect((plugin as any).syncNotes).toHaveBeenCalledWith(
        [mockDoc],
        false,
        mockTranscriptMap
      );
    });

    it("should use forceOverwrite in full sync mode", async () => {
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        syncNotes: true,
        syncTranscripts: true,
      };
      const mockTranscriptMap = new Map([["doc-1", []]]);
      (plugin as any).syncTranscripts = jest.fn().mockResolvedValue(mockTranscriptMap);
      (plugin as any).syncNotes = jest.fn().mockResolvedValue(undefined);

      await plugin.sync({ mode: "full" });

      expect((plugin as any).syncTranscripts).toHaveBeenCalledWith(
        [mockDoc],
        mockAccessToken,
        true
      );
      expect((plugin as any).syncNotes).toHaveBeenCalledWith(
        [mockDoc],
        true,
        mockTranscriptMap
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

});
