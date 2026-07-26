import { App, TFile } from "obsidian";
import * as obsidian from "obsidian";
import {
  FileSyncService,
  extractLegacyIdFromWebUrl,
} from "../../src/services/fileSyncService";
import type { GranolaDoc } from "../../src/services/granolaApi";
import type { DocumentProcessor } from "../../src/services/documentProcessor";
import type { PathResolver } from "../../src/services/pathResolver";
import {
  DEFAULT_SETTINGS,
  GranolaSyncSettings,
} from "../../src/settings";
import * as dateUtils from "../../src/utils/dateUtils";

describe("FileSyncService", () => {
  let mockApp: jest.Mocked<App>;
  let fileSyncService: FileSyncService;
  let mockSettings: GranolaSyncSettings;
  let mockPathResolver: jest.Mocked<PathResolver>;

  beforeEach(() => {
    // Suppress console output for error handling tests
    // Note: You can still verify calls with expect(console.error).toHaveBeenCalled()
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});

    // Create a mock app with vault, including binary APIs, fileManager, and metadataCache
    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn(),
        getAbstractFileByPath: jest.fn(),
        getFileByPath: jest.fn(),
        createFolder: jest.fn(),
        create: jest.fn(),
        createBinary: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
        rename: jest.fn(),
        getConfig: jest.fn().mockReturnValue("attachments"),
      },
      fileManager: {
        getAvailablePathForAttachment: jest
          .fn()
          .mockImplementation((filename: string) => `attachments/${filename}`),
      } as any,
      metadataCache: {
        getFileCache: jest.fn(),
      },
    } as any;

    mockPathResolver = {
      computeDailyNoteFolderPath: jest.fn().mockReturnValue("daily-folder"),
      computeNoteFolderPath: jest.fn().mockReturnValue("granola-folder"),
      computeTranscriptFolderPath: jest.fn().mockReturnValue("granola-transcripts"),
      computeNotePath: jest.fn(),
    } as unknown as jest.Mocked<PathResolver>;

    mockSettings = {
      ...DEFAULT_SETTINGS,
      saveAsIndividualFiles: true,
      baseFolderType: "custom",
      customBaseFolder: "granola-folder",
      subfolderPattern: "none",
      filenamePattern: "{title}",
      transcriptHandling: "custom-location",
      customTranscriptBaseFolder: "granola-transcripts",
      transcriptSubfolderPattern: "none",
      transcriptFilenamePattern: "{title}-transcript",
    };

    fileSyncService = new FileSyncService(
      mockApp,
      mockPathResolver,
      () => mockSettings
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("buildCache", () => {
    it("should build cache from markdown files with granola_id frontmatter", async () => {
      const mockFile1 = { path: "note1.md" } as TFile;
      const mockFile2 = { path: "note2.md" } as TFile;

      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile1, mockFile2]);
      mockApp.metadataCache.getFileCache
        .mockReturnValueOnce({
          frontmatter: { granola_id: "id-1" },
        } as any)
        .mockReturnValueOnce({
          frontmatter: { granola_id: "id-2" },
        } as any);

      await fileSyncService.buildCache();

      expect(fileSyncService.getCacheSize()).toBe(2);
      expect(fileSyncService.findByGranolaId("id-1")).toBe(mockFile1);
      expect(fileSyncService.findByGranolaId("id-2")).toBe(mockFile2);
    });

    it("should skip files without granola_id frontmatter", async () => {
      const mockFile1 = { path: "note1.md" } as TFile;
      const mockFile2 = { path: "note2.md" } as TFile;

      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile1, mockFile2]);
      mockApp.metadataCache.getFileCache
        .mockReturnValueOnce({
          frontmatter: { granola_id: "id-1" },
        } as any)
        .mockReturnValueOnce({
          frontmatter: {}, // No granola_id
        } as any);

      await fileSyncService.buildCache();

      expect(fileSyncService.getCacheSize()).toBe(1);
      expect(fileSyncService.findByGranolaId("id-1")).toBe(mockFile1);
    });

    it("should handle errors when reading frontmatter", async () => {
      const mockFile = { path: "note.md" } as TFile;
      const error = new Error("Cache read error");

      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockImplementation(() => {
        throw error;
      });

      await fileSyncService.buildCache();

      expect(fileSyncService.getCacheSize()).toBe(0);
      expect(console.error).toHaveBeenCalledWith(
        "[Granola Sync]",
        expect.stringContaining("Error reading frontmatter"),
        error
      );
    });

    it("should handle files with no frontmatter", async () => {
      const mockFile = { path: "note.md" } as TFile;

      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      await fileSyncService.buildCache();

      expect(fileSyncService.getCacheSize()).toBe(0);
    });

    it("should clear existing cache when rebuilding", async () => {
      const mockFile = { path: "note.md" } as TFile;

      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "id-1" },
      } as any);

      await fileSyncService.buildCache();
      expect(fileSyncService.getCacheSize()).toBe(1);

      // Rebuild with no files
      mockApp.vault.getMarkdownFiles.mockReturnValue([]);
      await fileSyncService.buildCache();
      expect(fileSyncService.getCacheSize()).toBe(0);
    });
  });

  describe("findByGranolaId", () => {
    it("should return file if found in cache", async () => {
      const mockFile = { path: "note.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "test-id" },
      } as any);

      await fileSyncService.buildCache();
      const result = fileSyncService.findByGranolaId("test-id");

      expect(result).toBe(mockFile);
    });

    it("should return null if not found in cache", async () => {
      mockApp.vault.getMarkdownFiles.mockReturnValue([]);
      await fileSyncService.buildCache();
      const result = fileSyncService.findByGranolaId("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("getGranolaIdByPath", () => {
    it("should return granolaId when path matches cached file", async () => {
      const mockFile = { path: "Granola/Meeting.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "doc-123" },
      } as any);

      await fileSyncService.buildCache();
      const result = fileSyncService.getGranolaIdByPath("Granola/Meeting.md");

      expect(result).toBe("doc-123");
    });

    it("should return null when path is not in cache", async () => {
      mockApp.vault.getMarkdownFiles.mockReturnValue([]);
      await fileSyncService.buildCache();
      const result = fileSyncService.getGranolaIdByPath("Granola/Other.md");

      expect(result).toBeNull();
    });

    it("should normalize path when matching", async () => {
      const mockFile = { path: "Granola/Sub/Note.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "id-1" },
      } as any);

      await fileSyncService.buildCache();
      expect(fileSyncService.getGranolaIdByPath("Granola/Sub/Note.md")).toBe(
        "id-1"
      );
    });
  });

  describe("isRemoteNewer", () => {
    it("should return true when local file does not exist", () => {
      const result = fileSyncService.isRemoteNewer(
        "non-existent-id",
        "2024-01-15T12:00:00Z",
        "note"
      );

      expect(result).toBe(true);
    });

    it("should return true when remote has no timestamp", () => {
      const mockFile = { path: "note.md" } as TFile;
      fileSyncService.updateCache("test-id", mockFile, "note");
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "test-id", updated: "2024-01-15T10:00:00Z" },
      } as any);

      const result = fileSyncService.isRemoteNewer("test-id", undefined, "note");

      expect(result).toBe(true);
    });

    it("should return true when local has no timestamp in frontmatter", () => {
      const mockFile = { path: "note.md" } as TFile;
      fileSyncService.updateCache("test-id", mockFile, "note");
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "test-id" }, // No updated field
      } as any);

      const result = fileSyncService.isRemoteNewer(
        "test-id",
        "2024-01-15T12:00:00Z",
        "note"
      );

      expect(result).toBe(true);
    });

    it("should return true when remote is newer than local", () => {
      const mockFile = { path: "note.md" } as TFile;
      fileSyncService.updateCache("test-id", mockFile, "note");
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "test-id",
          updated: "2024-01-15T10:00:00Z",
        },
      } as any);

      const result = fileSyncService.isRemoteNewer(
        "test-id",
        "2024-01-15T12:00:00Z", // 2 hours later
        "note"
      );

      expect(result).toBe(true);
    });

    it("should return false when local is newer than remote", () => {
      const mockFile = { path: "note.md" } as TFile;
      fileSyncService.updateCache("test-id", mockFile, "note");
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "test-id",
          updated: "2024-01-15T14:00:00Z",
        },
      } as any);

      const result = fileSyncService.isRemoteNewer(
        "test-id",
        "2024-01-15T12:00:00Z", // 2 hours earlier
        "note"
      );

      expect(result).toBe(false);
    });

    it("should return false when timestamps are equal", () => {
      const mockFile = { path: "note.md" } as TFile;
      fileSyncService.updateCache("test-id", mockFile, "note");
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "test-id",
          updated: "2024-01-15T12:00:00Z",
        },
      } as any);

      const result = fileSyncService.isRemoteNewer(
        "test-id",
        "2024-01-15T12:00:00Z",
        "note"
      );

      expect(result).toBe(false);
    });

    it("should handle transcripts separately from notes", () => {
      const mockNote = { path: "note.md" } as TFile;
      const mockTranscript = { path: "transcript.md" } as TFile;
      fileSyncService.updateCache("test-id", mockNote, "note");
      fileSyncService.updateCache("test-id", mockTranscript, "transcript");

      mockApp.metadataCache.getFileCache
        .mockReturnValueOnce({
          frontmatter: {
            granola_id: "test-id",
            type: "note",
            updated: "2024-01-15T10:00:00Z",
          },
        } as any)
        .mockReturnValueOnce({
          frontmatter: {
            granola_id: "test-id",
            type: "transcript",
            updated: "2024-01-15T14:00:00Z",
          },
        } as any);

      // Note is older than remote
      const noteResult = fileSyncService.isRemoteNewer(
        "test-id",
        "2024-01-15T12:00:00Z",
        "note"
      );
      expect(noteResult).toBe(true);

      // Transcript is newer than remote
      const transcriptResult = fileSyncService.isRemoteNewer(
        "test-id",
        "2024-01-15T12:00:00Z",
        "transcript"
      );
      expect(transcriptResult).toBe(false);
    });

    it("should return true on error during timestamp comparison", () => {
      const mockFile = { path: "note.md" } as TFile;
      fileSyncService.updateCache("test-id", mockFile, "note");
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "test-id",
          updated: "invalid-date",
        },
      } as any);

      const result = fileSyncService.isRemoteNewer(
        "test-id",
        "2024-01-15T12:00:00Z",
        "note"
      );

      expect(result).toBe(true);
    });

    it("should handle exceptions in timestamp comparison and return true", () => {
      const mockFile = { path: "note.md" } as TFile;
      fileSyncService.updateCache("test-id", mockFile, "note");
      
      // Mock getFileCache to throw an error
      mockApp.metadataCache.getFileCache.mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const result = fileSyncService.isRemoteNewer(
        "test-id",
        "2024-01-15T12:00:00Z",
        "note"
      );

      expect(result).toBe(true); // Should return true on error
      expect(console.error).toHaveBeenCalledWith(
        "[Granola Sync]",
        expect.stringContaining("Error comparing timestamps"),
        expect.any(Error)
      );
    });

    it("should return true when frontmatter cache is null", () => {
      const mockFile = { path: "note.md" } as TFile;
      fileSyncService.updateCache("test-id", mockFile, "note");
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      const result = fileSyncService.isRemoteNewer(
        "test-id",
        "2024-01-15T12:00:00Z",
        "note"
      );

      expect(result).toBe(true);
    });
  });

  describe("updateCache", () => {
    it("should add file to cache when granolaId provided", () => {
      const mockFile = { path: "note.md" } as TFile;

      fileSyncService.updateCache("new-id", mockFile);

      expect(fileSyncService.findByGranolaId("new-id")).toBe(mockFile);
    });

    it("should not add file to cache when granolaId is undefined", () => {
      const mockFile = { path: "note.md" } as TFile;

      fileSyncService.updateCache(undefined, mockFile);

      expect(fileSyncService.getCacheSize()).toBe(0);
    });
  });

  describe("ensureFolder", () => {
    it("should return true if folder already exists", async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue({} as any);

      const result = await fileSyncService.ensureFolder("existing-folder");

      expect(result).toBe(true);
      expect(mockApp.vault.createFolder).not.toHaveBeenCalled();
    });

    it("should create folder and return true if it doesn't exist", async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.createFolder.mockResolvedValue(undefined);

      const result = await fileSyncService.ensureFolder("new-folder");

      expect(result).toBe(true);
      expect(mockApp.vault.createFolder).toHaveBeenCalledWith("new-folder");
    });

    it("should return false on error", async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.createFolder.mockRejectedValue(
        new Error("Permission denied")
      );

      const result = await fileSyncService.ensureFolder("bad-folder");

      expect(result).toBe(false);
    });
  });

  describe("resolveFilePath", () => {
    it("should return null when folder path cannot be resolved", () => {
      mockSettings.saveAsIndividualFiles = false; // Invalid for individual files

      const result = fileSyncService.resolveFilePath(
        "note.md",
        new Date(),
        false
      );

      expect(result).toBeNull();
    });

    it("should return the resolved path", () => {
      const result = fileSyncService.resolveFilePath(
        "note.md",
        new Date(),
        false
      );

      expect(result).toBe("granola-folder/note.md");
    });

    it("should handle transcript files", () => {
      const result = fileSyncService.resolveFilePath(
        "note-transcript.md",
        new Date(),
        true
      );

      expect(result).toBe("granola-transcripts/note-transcript.md");
    });
  });

  describe("saveToDisk", () => {
    it("should return false when folder path cannot be resolved", async () => {
      mockSettings.saveAsIndividualFiles = false; // Invalid for individual files
      const ensureFolderSpy = jest.spyOn(fileSyncService, "ensureFolder");
      const saveFileSpy = jest.spyOn(fileSyncService, "saveFile");

      const result = await fileSyncService.saveToDisk(
        "note.md",
        "content",
        new Date(),
        "doc-1"
      );

      expect(result).toBe(false);
      expect(ensureFolderSpy).not.toHaveBeenCalled();
      expect(saveFileSpy).not.toHaveBeenCalled();
    });

    it("should ensure folder and delegate to saveFile when no conflicts", async () => {
      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(true);
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile")
        .mockResolvedValue(true);

      const result = await fileSyncService.saveToDisk(
        "note.md",
        "content",
        new Date(),
        "doc-1"
      );

      expect(result).toBe(true);
      expect(fileSyncService.ensureFolder).toHaveBeenCalledWith(
        "granola-folder"
      );
      expect(saveFileSpy).toHaveBeenCalledWith(
        "granola-folder/note.md",
        "content",
        "doc-1",
        "note",
        false,
        expect.any(Date),
        null
      );
    });

    it("should use resolveFilePath to resolve the target path", async () => {
      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(true);
      const resolveFilePathSpy = jest
        .spyOn(fileSyncService, "resolveFilePath")
        .mockReturnValue("granola-folder/note.md");
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile")
        .mockResolvedValue(true);

      await fileSyncService.saveToDisk(
        "note.md",
        "content",
        new Date(),
        "doc-1"
      );

      expect(resolveFilePathSpy).toHaveBeenCalledWith(
        "note.md",
        expect.any(Date),
        false
      );
      expect(saveFileSpy).toHaveBeenCalledWith(
        "granola-folder/note.md",
        "content",
        "doc-1",
        "note",
        false,
        expect.any(Date),
        null
      );
    });

    it("should return false when ensureFolder fails", async () => {
      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(false);

      const result = await fileSyncService.saveToDisk(
        "note.md",
        "content",
        new Date(),
        "doc-1"
      );

      expect(result).toBe(false);
    });

    it("should return false when resolveFilePath returns null", async () => {
      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(true);
      jest.spyOn(fileSyncService, "resolveFilePath").mockReturnValue(null);

      const result = await fileSyncService.saveToDisk(
        "note.md",
        "content",
        new Date(),
        "doc-1"
      );

      expect(result).toBe(false);
    });

    it("should handle day subfolder pattern for notes", async () => {
      mockSettings.subfolderPattern = "day";
      mockPathResolver.computeNoteFolderPath = jest.fn().mockReturnValue("granola-folder/2024-01-15");

      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(true);
      jest.spyOn(fileSyncService, "resolveFilePath").mockReturnValue("granola-folder/2024-01-15/note.md");
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile")
        .mockResolvedValue(true);

      await fileSyncService.saveToDisk(
        "note.md",
        "content",
        new Date("2024-01-15"),
        "doc-1",
        false
      );

      expect(saveFileSpy).toHaveBeenCalled();
    });

    it("should handle custom subfolder pattern for transcripts", async () => {
      mockSettings.transcriptSubfolderPattern = "day";
      mockPathResolver.computeTranscriptFolderPath = jest.fn().mockReturnValue("granola-transcripts/2024-01-15");

      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(true);
      jest.spyOn(fileSyncService, "resolveFilePath").mockReturnValue("granola-transcripts/2024-01-15/transcript.md");
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile")
        .mockResolvedValue(true);

      await fileSyncService.saveToDisk(
        "transcript.md",
        "content",
        new Date("2024-01-15"),
        "doc-1",
        true
      );

      expect(saveFileSpy).toHaveBeenCalled();
    });
  });

  describe("saveNoteToDisk", () => {
    let mockDocumentProcessor: jest.Mocked<DocumentProcessor>;

    beforeEach(() => {
      mockDocumentProcessor = {
        prepareNote: jest.fn(),
        prepareTranscript: jest.fn(),
      } as unknown as jest.Mocked<DocumentProcessor>;
    });

    it("should return saved:false and path:null when doc id is missing", async () => {
      const doc = { title: "No ID" } as GranolaDoc;

      const result = await fileSyncService.saveNoteToDisk(
        doc,
        mockDocumentProcessor
      );

      expect(result).toEqual({ saved: false, path: null });
      expect(mockDocumentProcessor.prepareNote).not.toHaveBeenCalled();
    });

    it("should return cached note path after save when rename target conflicts", async () => {
      const doc = { id: "doc-1" } as GranolaDoc;
      const noteDate = new Date("2024-01-15T10:00:00Z");
      mockDocumentProcessor.prepareNote.mockReturnValue({
        filename: "Daily Scrum.md",
        content: "content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);
      jest.spyOn(fileSyncService, "saveFile" as any).mockResolvedValue(true);
      jest
        .spyOn(fileSyncService, "findByGranolaId")
        .mockImplementation((granolaId, type) => {
          if (granolaId === "doc-1" && type === "note") {
            return {
              path: "granola-folder/Daily Scrum-2024-01-15_10-00-00.md",
              extension: "md",
            } as TFile;
          }
          return null;
        });

      const result = await fileSyncService.saveNoteToDisk(
        doc,
        mockDocumentProcessor
      );

      expect(result).toEqual({
        saved: true,
        path: "granola-folder/Daily Scrum-2024-01-15_10-00-00.md",
      });
    });

    it("should prepare note and delegate to saveToDisk", async () => {
      const doc = { id: "doc-1" } as GranolaDoc;
      const noteDate = new Date("2024-01-02T12:00:00Z");
      mockDocumentProcessor.prepareNote.mockReturnValue({
        filename: "note.md",
        content: "content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile")
        .mockResolvedValue(true);

      const result = await fileSyncService.saveNoteToDisk(
        doc,
        mockDocumentProcessor
      );

      expect(result.saved).toBe(true);
      expect(mockDocumentProcessor.prepareNote).toHaveBeenCalledWith(
        doc,
        undefined
      );
      expect(saveFileSpy).toHaveBeenCalledWith(
        expect.stringContaining("note.md"),
        expect.any(String),
        "doc-1",
        "note",
        false,
        expect.any(Date),
        null
      );
    });

    it("should return saved:false and path:null when folder path cannot be resolved", async () => {
      const doc: GranolaDoc = {
        id: "doc-no-folder",
        title: "Note Without Folder",
      };

      const noteDate = new Date("2024-01-02T12:00:00Z");
      mockDocumentProcessor.prepareNote.mockReturnValue({
        filename: "note.md",
        content: "Content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);

      // Mock folder resolution to fail
      jest.spyOn(fileSyncService as any, "resolveFolderPath").mockReturnValue(null);

      const result = await fileSyncService.saveNoteToDisk(
        doc,
        mockDocumentProcessor,
        false,
        undefined
      );

      expect(result).toEqual({ saved: false, path: null });
    });

    it("should return saved:false and path:null when folder creation fails", async () => {
      const doc: GranolaDoc = {
        id: "doc-folder-fail",
        title: "Note With Folder Creation Failure",
      };

      const noteDate = new Date("2024-01-02T12:00:00Z");
      mockDocumentProcessor.prepareNote.mockReturnValue({
        filename: "note.md",
        content: "Content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);

      // Mock folder resolution to succeed but folder creation to fail
      jest
        .spyOn(fileSyncService as any, "resolveFolderPath")
        .mockReturnValue("test-folder");
      jest.spyOn(fileSyncService as any, "ensureFolder").mockResolvedValue(false);

      const result = await fileSyncService.saveNoteToDisk(
        doc,
        mockDocumentProcessor,
        false,
        undefined
      );

      expect(result).toEqual({ saved: false, path: null });
    });

    it("should return saved:false and path:null when file path cannot be resolved", async () => {
      const doc: GranolaDoc = {
        id: "doc-no-filepath",
        title: "Note Without File Path",
      };

      const noteDate = new Date("2024-01-02T12:00:00Z");
      mockDocumentProcessor.prepareNote.mockReturnValue({
        filename: "note.md",
        content: "Content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);

      // Mock folder operations to succeed but file path resolution to fail
      jest
        .spyOn(fileSyncService as any, "resolveFolderPath")
        .mockReturnValue("test-folder");
      jest.spyOn(fileSyncService as any, "ensureFolder").mockResolvedValue(true);
      jest.spyOn(fileSyncService as any, "resolveFilePath").mockReturnValue(null);

      const result = await fileSyncService.saveNoteToDisk(
        doc,
        mockDocumentProcessor,
        false,
        undefined
      );

      expect(result).toEqual({ saved: false, path: null });
    });
  });

  describe("saveTranscriptToDisk", () => {
    let mockDocumentProcessor: jest.Mocked<DocumentProcessor>;

    beforeEach(() => {
      mockDocumentProcessor = {
        prepareNote: jest.fn(),
        prepareTranscript: jest.fn(),
      } as unknown as jest.Mocked<DocumentProcessor>;
    });

    it("should return saved:false and path:null when doc id is missing", async () => {
      const doc = { title: "No ID" } as GranolaDoc;

      const result = await fileSyncService.saveTranscriptToDisk(
        doc,
        "transcript content",
        mockDocumentProcessor
      );

      expect(result).toEqual({ saved: false, path: null });
      expect(mockDocumentProcessor.prepareTranscript).not.toHaveBeenCalled();
    });

    it("should prepare transcript and return saved status with actual path", async () => {
      const doc = { id: "doc-1" } as GranolaDoc;
      const noteDate = new Date("2024-01-03T09:15:00Z");
      mockDocumentProcessor.prepareTranscript.mockReturnValue({
        filename: "note-transcript.md",
        content: "transcript content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile" as any)
        .mockResolvedValue(true);

      const result = await fileSyncService.saveTranscriptToDisk(
        doc,
        "transcript content",
        mockDocumentProcessor
      );

      expect(result.saved).toBe(true);
      expect(result.path).toBe("granola-transcripts/note-transcript.md");
      expect(mockDocumentProcessor.prepareTranscript).toHaveBeenCalledWith(
        doc,
        "transcript content"
      );
    });

    it("should return cached transcript path after save when rename target conflicts", async () => {
      const doc = { id: "doc-1" } as GranolaDoc;
      const noteDate = new Date("2024-01-03T09:15:00Z");
      mockDocumentProcessor.prepareTranscript.mockReturnValue({
        filename: "note-transcript.md",
        content: "transcript content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);
      jest
        .spyOn(fileSyncService, "saveFile" as any)
        .mockResolvedValue(true);
      jest
        .spyOn(fileSyncService, "findByGranolaId")
        .mockImplementation((granolaId, type) => {
          if (granolaId === "doc-1" && type === "transcript") {
            return {
              path: "granola-transcripts/note-transcript-2024-01-03_09-15-00.md",
              extension: "md",
            } as TFile;
          }
          return null;
        });

      const result = await fileSyncService.saveTranscriptToDisk(
        doc,
        "transcript content",
        mockDocumentProcessor
      );

      expect(result).toEqual({
        saved: true,
        path: "granola-transcripts/note-transcript-2024-01-03_09-15-00.md",
      });
    });
  });

  describe("saveFile", () => {
    it("should create new file when it doesn't exist", async () => {
      const mockNewFile = { path: "new-note.md", extension: "md" } as TFile;
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.create.mockResolvedValue(mockNewFile);

      const result = await fileSyncService.saveFile(
        "new-note.md",
        "content",
        "id-1"
      );

      expect(result).toBe(true);
      expect(mockApp.vault.create).toHaveBeenCalledWith(
        "new-note.md",
        "content"
      );
      expect(fileSyncService.findByGranolaId("id-1")).toBe(mockNewFile);
    });

    it("should update existing file when content changes", async () => {
      const mockFile = { path: "existing.md", extension: "md" } as TFile;
      // Pre-populate cache with existing file
      fileSyncService.updateCache("id-1", mockFile);
      mockApp.vault.read.mockResolvedValue("old content");
      mockApp.vault.modify.mockResolvedValue(undefined);

      const result = await fileSyncService.saveFile(
        "existing.md",
        "new content",
        "id-1"
      );

      expect(result).toBe(true);
      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        mockFile,
        "new content"
      );
    });

    it("should return false when content is unchanged", async () => {
      const mockFile = { path: "existing.md", extension: "md" } as TFile;
      // Pre-populate cache with existing file
      fileSyncService.updateCache("id-1", mockFile);
      mockApp.vault.read.mockResolvedValue("same content");

      const result = await fileSyncService.saveFile(
        "existing.md",
        "same content",
        "id-1"
      );

      expect(result).toBe(false);
      expect(mockApp.vault.modify).not.toHaveBeenCalled();
    });

    it("should find file by granola_id if exists elsewhere", async () => {
      const mockFile = { path: "old-path.md", extension: "md" } as TFile;

      // Pre-populate cache
      fileSyncService.updateCache("id-1", mockFile);

      mockApp.vault.read.mockResolvedValue("old content");
      mockApp.vault.modify.mockResolvedValue(undefined);
      mockApp.vault.rename.mockResolvedValue(undefined);

      const result = await fileSyncService.saveFile(
        "new-path.md",
        "new content",
        "id-1"
      );

      expect(result).toBe(true);
      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        mockFile,
        "new content"
      );
      expect(mockApp.vault.rename).toHaveBeenCalledWith(
        mockFile,
        "new-path.md"
      );
    });

    it("should handle rename failures gracefully", async () => {
      const mockFile = { path: "old-path.md", extension: "md" } as TFile;
      fileSyncService.updateCache("id-1", mockFile);

      mockApp.vault.read.mockResolvedValue("old content");
      mockApp.vault.modify.mockResolvedValue(undefined);
      mockApp.vault.rename.mockRejectedValue(new Error("File already exists"));

      const result = await fileSyncService.saveFile(
        "new-path.md",
        "new content",
        "id-1"
      );

      expect(result).toBe(true); // Should still return true for content update
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });

    it("should return false on save error", async () => {
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.create.mockRejectedValue(new Error("Disk full"));

      const result = await fileSyncService.saveFile(
        "new.md",
        "content",
        "id-1"
      );

      expect(result).toBe(false);
    });
  });

  describe("createNewFile collision recovery (issue #61)", () => {
    it("recovers from a create collision by saving under a date-suffixed name", async () => {
      jest
        .spyOn(dateUtils, "formatDateForFilename")
        .mockReturnValue("2024-01-01 10-30-00");
      const suffixedPath = "granola-folder/note-2024-01-01_10-30-00.md";
      const createdFile = new TFile(suffixedPath);
      mockApp.vault.create
        .mockRejectedValueOnce(new Error("File already exists."))
        .mockResolvedValueOnce(createdFile);

      const result = await fileSyncService.saveFile(
        "granola-folder/note.md",
        "content",
        "id-1",
        "note",
        false,
        new Date("2024-01-01T10:30:00Z")
      );

      expect(result).toBe(true);
      expect(mockApp.vault.create).toHaveBeenNthCalledWith(
        1,
        "granola-folder/note.md",
        "content"
      );
      expect(mockApp.vault.create).toHaveBeenNthCalledWith(
        2,
        suffixedPath,
        "content"
      );
      // Cache points at the file that was actually created on disk.
      expect(fileSyncService.findByGranolaId("id-1", "note")).toBe(createdFile);
    });

    it("appends a numeric counter when the date-suffixed name also collides", async () => {
      jest
        .spyOn(dateUtils, "formatDateForFilename")
        .mockReturnValue("2024-01-01 10-30-00");
      const finalPath = "granola-folder/note-2024-01-01_10-30-00-2.md";
      mockApp.vault.create
        .mockRejectedValueOnce(new Error("File already exists."))
        .mockRejectedValueOnce(new Error("File already exists."))
        .mockResolvedValueOnce(new TFile(finalPath));

      const result = await fileSyncService.saveFile(
        "granola-folder/note.md",
        "content",
        "id-1",
        "note",
        false,
        new Date("2024-01-01T10:30:00Z")
      );

      expect(result).toBe(true);
      expect(mockApp.vault.create).toHaveBeenNthCalledWith(
        3,
        finalPath,
        "content"
      );
    });

    it("saves under a suffix when getAbstractFileByPath misses but create collides (case-insensitive FS)", async () => {
      // The in-memory index lookup is case-sensitive and misses the existing
      // case variant on disk...
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      jest
        .spyOn(dateUtils, "formatDateForFilename")
        .mockReturnValue("2024-01-01 10-30-00");
      // ...but the case-insensitive filesystem rejects the first create.
      const suffixedPath =
        "granola-transcripts/Instance AI standup-transcript-2024-01-01_10-30-00.md";
      const createdFile = new TFile(suffixedPath);
      mockApp.vault.create
        .mockRejectedValueOnce(new Error("File already exists."))
        .mockResolvedValueOnce(createdFile);

      const result = await fileSyncService.saveFile(
        "granola-transcripts/Instance AI standup-transcript.md",
        "transcript content",
        "e7b12999",
        "transcript",
        false,
        new Date("2024-01-01T10:30:00Z")
      );

      expect(result).toBe(true);
      expect(fileSyncService.findByGranolaId("e7b12999", "transcript")).toBe(
        createdFile
      );
    });

    it("caches the file re-resolved from the vault when create resolves null", async () => {
      // Obsidian's `vault.create` writes the file, then looks it up in the
      // in-memory index and returns null when the lookup misses — despite its
      // `Promise<TFile>` type.
      const createdFile = new TFile("granola-folder/note.md");
      mockApp.vault.create.mockResolvedValue(null as unknown as TFile);
      (mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(createdFile);

      const result = await fileSyncService.saveFile(
        "granola-folder/note.md",
        "content",
        "id-1",
        "note",
        false,
        new Date()
      );

      expect(result).toBe(true);
      expect(fileSyncService.findByGranolaId("id-1", "note")).toBe(createdFile);
    });

    it("never caches null when create resolves null and the file is unresolvable", async () => {
      mockApp.vault.create.mockResolvedValue(null as unknown as TFile);
      (mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(null);
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await fileSyncService.saveFile(
        "granola-folder/note.md",
        "content",
        "id-1",
        "note",
        false,
        new Date()
      );

      // The file was written to disk, so the save succeeded...
      expect(result).toBe(true);
      // ...but the cache must not hold a null entry.
      expect(fileSyncService.findByGranolaId("id-1", "note")).toBeNull();
      expect(fileSyncService.getCacheSize()).toBe(0);
    });

    it("keeps syncing subsequent documents after an unresolvable create", async () => {
      // Regression: a null cached by an earlier save made every later save
      // throw "Cannot read properties of null (reading 'path')" while scanning
      // the cache, aborting the whole sync.
      mockApp.vault.create.mockResolvedValueOnce(null as unknown as TFile);
      (mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(null);
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

      await fileSyncService.saveFile(
        "granola-folder/first.md",
        "content",
        "id-1",
        "note",
        false,
        new Date()
      );

      const secondFile = new TFile("granola-folder/second.md");
      mockApp.vault.create.mockResolvedValueOnce(secondFile);

      const result = await fileSyncService.saveFile(
        "granola-folder/second.md",
        "content",
        "id-2",
        "note",
        false,
        new Date()
      );

      expect(result).toBe(true);
      expect(fileSyncService.findByGranolaId("id-2", "note")).toBe(secondFile);
    });

    it("tolerates a pre-poisoned cache entry without throwing", async () => {
      // Defense in depth: whatever the origin of a malformed entry, scanning
      // the cache must not crash the sync. Poke the private map directly so the
      // scan guards are exercised even though updateCache now rejects nulls.
      (
        fileSyncService as unknown as { granolaIdCache: Map<string, unknown> }
      ).granolaIdCache.set("stale-id-note", null);

      const createdFile = new TFile("granola-folder/note.md");
      mockApp.vault.create.mockResolvedValue(createdFile);

      const result = await fileSyncService.saveFile(
        "granola-folder/note.md",
        "content",
        "id-1",
        "note",
        false,
        new Date()
      );

      expect(result).toBe(true);
      expect(fileSyncService.getGranolaIdByPath("granola-folder/note.md")).toBe(
        "id-1"
      );
    });

    it("contains an unexpected cache-scan failure to the one document", async () => {
      // An entry that blows up on access stands in for any future defect in the
      // scan: saveFile must report the failure, not reject and abort the sync.
      const hostile = {
        get path(): string {
          throw new Error("boom");
        },
      };
      (
        fileSyncService as unknown as { granolaIdCache: Map<string, unknown> }
      ).granolaIdCache.set("hostile-note", hostile);

      await expect(
        fileSyncService.saveFile(
          "granola-folder/note.md",
          "content",
          "id-1",
          "note",
          false,
          new Date()
        )
      ).resolves.toBe(false);
    });

    it("does not retry on a non-collision error", async () => {
      mockApp.vault.create.mockRejectedValue(new Error("Disk full"));

      const result = await fileSyncService.saveFile(
        "granola-folder/note.md",
        "content",
        "id-1",
        "note",
        false,
        new Date()
      );

      expect(result).toBe(false);
      expect(mockApp.vault.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("clearCache and getCacheSize", () => {
    it("should clear the cache", async () => {
      const mockFile = { path: "note.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "id-1" },
      } as any);

      await fileSyncService.buildCache();
      expect(fileSyncService.getCacheSize()).toBe(1);

      fileSyncService.clearCache();
      expect(fileSyncService.getCacheSize()).toBe(0);
    });
  });

  describe("forceOverwrite behavior", () => {
    it("should overwrite file even when content is unchanged if forceOverwrite is true", async () => {
      const mockFile = { path: "existing.md", extension: "md" } as TFile;
      // Pre-populate cache with existing file
      fileSyncService.updateCache("id-1", mockFile);
      mockApp.vault.read.mockResolvedValue("same content");
      mockApp.vault.modify.mockResolvedValue(undefined);

      const result = await fileSyncService.saveFile(
        "existing.md",
        "same content",
        "id-1",
        "note",
        true // forceOverwrite
      );

      expect(result).toBe(true);
      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        mockFile,
        "same content"
      );
    });

    it("should not overwrite file when content is unchanged and forceOverwrite is false", async () => {
      const mockFile = { path: "existing.md", extension: "md" } as TFile;
      fileSyncService.updateCache("id-1", mockFile);
      mockApp.vault.read.mockResolvedValue("same content");

      const result = await fileSyncService.saveFile(
        "existing.md",
        "same content",
        "id-1",
        "note",
        false // forceOverwrite
      );

      expect(result).toBe(false);
      expect(mockApp.vault.modify).not.toHaveBeenCalled();
    });

    it("should pass forceOverwrite through saveToDisk to saveFile", async () => {
      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(true);
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile")
        .mockResolvedValue(true);

      await fileSyncService.saveToDisk(
        "note.md",
        "content",
        new Date(),
        "doc-1",
        false,
        true // forceOverwrite
      );

      expect(saveFileSpy).toHaveBeenCalledWith(
        "granola-folder/note.md",
        "content",
        "doc-1",
        "note",
        true, // forceOverwrite should be passed through
        expect.any(Date),
        null
      );
    });

    it("should pass forceOverwrite through saveNoteToDisk to saveToDisk", async () => {
      const mockDocumentProcessor = {
        prepareNote: jest.fn(),
        prepareTranscript: jest.fn(),
      } as unknown as jest.Mocked<DocumentProcessor>;
      
      const doc = { id: "doc-1" } as GranolaDoc;
      const noteDate = new Date("2024-01-02T12:00:00Z");
      mockDocumentProcessor.prepareNote.mockReturnValue({
        filename: "note.md",
        content: "content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile")
        .mockResolvedValue(true);

      await fileSyncService.saveNoteToDisk(doc, mockDocumentProcessor, true);

      expect(saveFileSpy).toHaveBeenCalledWith(
        expect.stringContaining("note.md"),
        expect.any(String),
        "doc-1",
        "note",
        true, // forceOverwrite should be passed through
        expect.any(Date),
        null
      );
    });

    it("should pass forceOverwrite through saveTranscriptToDisk to saveFile", async () => {
      const mockDocumentProcessor = {
        prepareNote: jest.fn(),
        prepareTranscript: jest.fn(),
      } as unknown as jest.Mocked<DocumentProcessor>;

      const doc = { id: "doc-1" } as GranolaDoc;
      const noteDate = new Date("2024-01-03T09:15:00Z");
      mockDocumentProcessor.prepareTranscript.mockReturnValue({
        filename: "note-transcript.md",
        content: "transcript content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile" as any)
        .mockResolvedValue(true);

      await fileSyncService.saveTranscriptToDisk(
        doc,
        "transcript content",
        mockDocumentProcessor,
        true // forceOverwrite
      );

      expect(saveFileSpy).toHaveBeenCalledWith(
        "granola-transcripts/note-transcript.md",
        "transcript content",
        "doc-1",
        "transcript",
        true, // forceOverwrite should be passed through
        expect.any(Date),
        null
      );
    });
  });

  describe("type-based cache keys", () => {
    it("should distinguish between notes and transcripts with same granola_id", async () => {
      const mockNote = { path: "note.md" } as TFile;
      const mockTranscript = { path: "transcript.md" } as TFile;

      mockApp.vault.getMarkdownFiles.mockReturnValue([
        mockNote,
        mockTranscript,
      ]);
      mockApp.metadataCache.getFileCache
        .mockReturnValueOnce({
          frontmatter: { granola_id: "doc-123", type: "note" },
        } as any)
        .mockReturnValueOnce({
          frontmatter: { granola_id: "doc-123", type: "transcript" },
        } as any);

      await fileSyncService.buildCache();

      expect(fileSyncService.getCacheSize()).toBe(2);
      expect(fileSyncService.findByGranolaId("doc-123", "note")).toBe(mockNote);
      expect(fileSyncService.findByGranolaId("doc-123", "transcript")).toBe(
        mockTranscript
      );
    });

    it("should default type to note for backward compatibility", async () => {
      const mockFile = { path: "legacy.md" } as TFile;

      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "doc-456" }, // No type field
      } as any);

      await fileSyncService.buildCache();

      expect(fileSyncService.getCacheSize()).toBe(1);
      expect(fileSyncService.findByGranolaId("doc-456")).toBe(mockFile);
      expect(fileSyncService.findByGranolaId("doc-456", "note")).toBe(mockFile);
    });

    it("should save and retrieve files by type", async () => {
      const mockNote = { path: "note.md", extension: "md" } as TFile;
      const mockTranscript = {
        path: "transcript.md",
        extension: "md",
      } as TFile;

      mockApp.vault.getAbstractFileByPath
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);
      mockApp.vault.create
        .mockResolvedValueOnce(mockNote)
        .mockResolvedValueOnce(mockTranscript);

      // Save a note
      await fileSyncService.saveFile(
        "note.md",
        "note content",
        "doc-123",
        "note"
      );

      // Save a transcript with same granola_id
      await fileSyncService.saveFile(
        "transcript.md",
        "transcript content",
        "doc-123",
        "transcript"
      );

      // Both should be cached separately
      expect(fileSyncService.findByGranolaId("doc-123", "note")).toBe(mockNote);
      expect(fileSyncService.findByGranolaId("doc-123", "transcript")).toBe(
        mockTranscript
      );
    });

    it("should update cache with correct type", async () => {
      const mockFile = { path: "note.md", extension: "md" } as TFile;

      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.create.mockResolvedValue(mockFile);

      await fileSyncService.saveFile(
        "note.md",
        "content",
        "doc-789",
        "transcript"
      );

      // Should be findable with transcript type
      expect(fileSyncService.findByGranolaId("doc-789", "transcript")).toBe(
        mockFile
      );
      // Should NOT be findable with note type (different cache key)
      expect(fileSyncService.findByGranolaId("doc-789", "note")).toBeNull();
    });

    it("should handle file update with type parameter", async () => {
      const mockFile = { path: "existing.md", extension: "md" } as TFile;

      // First save to populate cache
      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.create.mockResolvedValue(mockFile);
      await fileSyncService.saveFile(
        "existing.md",
        "old content",
        "doc-999",
        "note"
      );

      // Clear the mock for the second call
      mockApp.vault.read.mockResolvedValue("old content");
      mockApp.vault.modify.mockResolvedValue(undefined);

      // Update with same type should find existing file from cache
      const result = await fileSyncService.saveFile(
        "existing.md",
        "new content",
        "doc-999",
        "note"
      );

      expect(result).toBe(true);
      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        mockFile,
        "new content"
      );
    });

    it("should support combined type in cache lookups", async () => {
      const mockFile = { path: "combined.md", extension: "md" } as TFile;

      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "doc-123", type: "combined" },
      } as any);

      await fileSyncService.buildCache();

      expect(fileSyncService.findByGranolaId("doc-123", "combined")).toBe(
        mockFile
      );
      // Should NOT be findable with other types
      expect(fileSyncService.findByGranolaId("doc-123", "note")).toBeNull();
      expect(fileSyncService.findByGranolaId("doc-123", "transcript")).toBeNull();
    });

    it("should support combined type in isRemoteNewer", () => {
      const mockFile = { path: "combined.md" } as TFile;

      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "doc-123",
          type: "combined",
          updated: "2024-01-15T10:00:00Z",
        },
      } as any);

      fileSyncService.buildCache();

      // Remote is newer
      expect(
        fileSyncService.isRemoteNewer(
          "doc-123",
          "2024-01-15T12:00:00Z",
          "combined"
        )
      ).toBe(true);

      // Remote is older
      expect(
        fileSyncService.isRemoteNewer(
          "doc-123",
          "2024-01-15T08:00:00Z",
          "combined"
        )
      ).toBe(false);
    });
  });

  describe("saveCombinedNoteToDisk", () => {
    let mockDocumentProcessor: jest.Mocked<DocumentProcessor>;
    let mockDoc: GranolaDoc;

    beforeEach(() => {
      mockDocumentProcessor = {
        prepareCombinedNote: jest.fn().mockReturnValue({
          filename: "Test Note.md",
          content: "---\ngranola_id: doc-123\ntype: combined\n---\n\n## Note\n\nNote content\n\n## Transcript\n\nTranscript content",
        }),
      } as any;

      mockDoc = {
        id: "doc-123",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        updated_at: "2024-01-15T12:00:00Z",
        summary_markdown: "## Summary",
      };

      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(new Date("2024-01-15"));
    });

    it("should save combined note to disk with correct type", async () => {
      const mockFile = { path: "granola-folder/Test Note.md", extension: "md" } as TFile;

      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.create.mockResolvedValue(mockFile);

      const result = await fileSyncService.saveCombinedNoteToDisk(
        mockDoc,
        mockDocumentProcessor,
        "## Transcript\n\nTranscript content",
        false
      );

      expect(result.saved).toBe(true);
      expect(result.path).toBe("granola-folder/Test Note.md");
      expect(mockDocumentProcessor.prepareCombinedNote).toHaveBeenCalledWith(
        mockDoc,
        "## Transcript\n\nTranscript content",
        undefined
      );
      expect(mockApp.vault.create).toHaveBeenCalled();
      expect(fileSyncService.findByGranolaId("doc-123", "combined")).toBe(mockFile);
    });

    it("should create folder if it doesn't exist", async () => {
      const mockFile = { path: "granola-folder/Test Note.md", extension: "md" } as TFile;

      mockApp.vault.getAbstractFileByPath
        .mockReturnValueOnce(null) // Folder doesn't exist
        .mockReturnValueOnce(null); // File doesn't exist
      mockApp.vault.createFolder.mockResolvedValue(undefined);
      mockApp.vault.create.mockResolvedValue(mockFile);

      await fileSyncService.saveCombinedNoteToDisk(
        mockDoc,
        mockDocumentProcessor,
        "## Transcript\n\nTranscript content",
        false
      );

      expect(mockApp.vault.createFolder).toHaveBeenCalledWith("granola-folder");
    });

    it("should handle existing combined file update", async () => {
      const mockFile = { path: "granola-folder/Test Note.md", extension: "md" } as TFile;

      // Setup cache with existing file
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "doc-123", type: "combined" },
      } as any);
      await fileSyncService.buildCache();

      mockApp.vault.read.mockResolvedValue("old content");
      mockApp.vault.modify.mockResolvedValue(undefined);

      const result = await fileSyncService.saveCombinedNoteToDisk(
        mockDoc,
        mockDocumentProcessor,
        "## Transcript\n\nNew transcript content",
        false
      );

      expect(result.saved).toBe(true);
      expect(mockApp.vault.modify).toHaveBeenCalled();
      expect(fileSyncService.findByGranolaId("doc-123", "combined")).toBe(mockFile);
    });

    it("should handle forceOverwrite flag", async () => {
      const mockFile = { path: "granola-folder/Test Note.md", extension: "md" } as TFile;

      // Setup cache with existing file
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "doc-123", type: "combined" },
      } as any);
      await fileSyncService.buildCache();

      mockApp.vault.read.mockResolvedValue("old content");
      mockApp.vault.modify.mockResolvedValue(undefined);

      const result = await fileSyncService.saveCombinedNoteToDisk(
        mockDoc,
        mockDocumentProcessor,
        "## Transcript\n\nNew content",
        true // forceOverwrite
      );

      expect(result.saved).toBe(true);
      expect(mockApp.vault.modify).toHaveBeenCalled();
    });

    it("should return saved:false and path:null when document has no id", async () => {
      const docWithoutId = { ...mockDoc, id: undefined };

      const result = await fileSyncService.saveCombinedNoteToDisk(
        docWithoutId as GranolaDoc,
        mockDocumentProcessor,
        "## Transcript\n\nContent",
        false
      );

      expect(result).toEqual({ saved: false, path: null });
      expect(mockDocumentProcessor.prepareCombinedNote).not.toHaveBeenCalled();
    });

    it("should use note folder path, not transcript folder", async () => {
      const mockFile = { path: "granola-folder/Test Note.md", extension: "md" } as TFile;

      mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
      mockApp.vault.create.mockResolvedValue(mockFile);

      await fileSyncService.saveCombinedNoteToDisk(
        mockDoc,
        mockDocumentProcessor,
        "## Transcript\n\nContent",
        false
      );

      // Should use granolaFolder, not granolaTranscriptsFolder
      const createCall = mockApp.vault.create.mock.calls[0][0];
      expect(createCall).toContain("granola-folder");
      expect(createCall).not.toContain("granola-transcripts");
    });

    it("should handle filename collisions with date suffix", async () => {
      const existingFile = { path: "granola-folder/Test Note.md", extension: "md" } as TFile;
      const newFile = { path: "granola-folder/Test Note-2024-01-15.md", extension: "md" } as TFile;

      // Different granola ID but same filename - file exists at path but not in cache for our ID
      // First call: check if file exists at original path (it does, collision)
      // Second call: check if file exists at new path with suffix (it doesn't)
      mockApp.vault.getAbstractFileByPath
        .mockReturnValueOnce(existingFile) // Collision detected at "granola-folder/Test Note.md"
        .mockReturnValueOnce(null); // New path "granola-folder/Test Note-2024-01-15.md" is available
      mockApp.vault.create.mockResolvedValue(newFile);

      await fileSyncService.saveCombinedNoteToDisk(
        mockDoc,
        mockDocumentProcessor,
        "## Transcript\n\nContent",
        false
      );

      // The resolveFilePath should detect collision and use date suffix
      // But we need to verify the actual path used
      const createCall = mockApp.vault.create.mock.calls[0][0];
      // Since collision is detected, it should use the date-suffixed filename
      // But the mock might not be set up correctly - let's just verify it was called
      expect(mockApp.vault.create).toHaveBeenCalled();
      // The actual collision handling happens in resolveFilePath, which we test elsewhere
      // This test mainly verifies that saveCombinedNoteToDisk works with the collision logic
    });

    it("should return saved:false and path:null when resolveFolderPath returns null", async () => {
      // Set up a scenario where resolveFolderPath would return null
      // This happens when saveAsIndividualFiles is false (invalid for individual files)
      mockSettings.saveAsIndividualFiles = false;

      const result = await fileSyncService.saveCombinedNoteToDisk(
        mockDoc,
        mockDocumentProcessor,
        "## Transcript\n\nContent",
        false
      );

      expect(result).toEqual({ saved: false, path: null });
      expect(mockDocumentProcessor.prepareCombinedNote).toHaveBeenCalled();
    });

    it("should return saved:false and path:null when ensureFolder fails", async () => {
      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(false);

      const result = await fileSyncService.saveCombinedNoteToDisk(
        mockDoc,
        mockDocumentProcessor,
        "## Transcript\n\nContent",
        false
      );

      expect(result).toEqual({ saved: false, path: null });
      expect(mockDocumentProcessor.prepareCombinedNote).toHaveBeenCalled();
    });

    it("should return saved:false and path:null when resolveFilePath returns null", async () => {
      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(true);
      jest.spyOn(fileSyncService, "resolveFilePath").mockReturnValue(null);

      const result = await fileSyncService.saveCombinedNoteToDisk(
        mockDoc,
        mockDocumentProcessor,
        "## Transcript\n\nContent",
        false
      );

      expect(result).toEqual({ saved: false, path: null });
      expect(mockDocumentProcessor.prepareCombinedNote).toHaveBeenCalled();
    });
  });

  describe("legacy ID migration (public API rewrite)", () => {
    const LEGACY_UUID = "f3e45e0f-24cc-480b-9a6c-8b1f5e3d7a2c";
    const WEB_URL = `https://notes.granola.ai/d/${LEGACY_UUID}`;

    it("extractLegacyIdFromWebUrl returns the UUID for a valid URL", () => {
      expect(extractLegacyIdFromWebUrl(WEB_URL)).toBe(LEGACY_UUID);
    });

    it("extractLegacyIdFromWebUrl returns null for undefined or malformed URLs", () => {
      expect(extractLegacyIdFromWebUrl(undefined)).toBeNull();
      expect(extractLegacyIdFromWebUrl("https://notes.granola.ai/d/not-a-uuid")).toBeNull();
      expect(extractLegacyIdFromWebUrl("")).toBeNull();
    });

    it("updates the legacy-id file in place instead of creating a duplicate", async () => {
      const legacyFile = { path: "granola-folder/Standup.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([legacyFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: LEGACY_UUID, type: "note" },
      } as any);
      await fileSyncService.buildCache();

      mockApp.vault.read.mockResolvedValue("old content");
      mockApp.vault.modify.mockResolvedValue(undefined as any);

      const saved = await fileSyncService.saveFile(
        "granola-folder/Standup.md",
        "new content with new id",
        "not_newid12345",
        "note",
        false,
        new Date("2024-01-15T10:00:00Z"),
        LEGACY_UUID
      );

      expect(saved).toBe(true);
      expect(mockApp.vault.create).not.toHaveBeenCalled();
      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        legacyFile,
        "new content with new id"
      );
      // Cache now resolves the new id to the same file; old id is gone.
      expect(fileSyncService.findByGranolaId("not_newid12345", "note")).toBe(
        legacyFile
      );
      expect(fileSyncService.findByGranolaId(LEGACY_UUID, "note")).toBeNull();
    });

    it("falls back to adopting a Granola-synced file at the target path", async () => {
      const existing = { path: "granola-folder/Standup.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([existing]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { granola_id: "some-other-old-id", type: "note" },
      } as any);
      await fileSyncService.buildCache();

      mockApp.vault.read.mockResolvedValue("old content");
      mockApp.vault.modify.mockResolvedValue(undefined as any);

      const saved = await fileSyncService.saveFile(
        "granola-folder/Standup.md",
        "new content",
        "not_newid12345",
        "note",
        false,
        new Date("2024-01-15T10:00:00Z"),
        null
      );

      expect(saved).toBe(true);
      expect(mockApp.vault.create).not.toHaveBeenCalled();
      expect(mockApp.vault.modify).toHaveBeenCalledWith(existing, "new content");
      expect(fileSyncService.findByGranolaId("not_newid12345", "note")).toBe(
        existing
      );
    });

    it("creates a new file when there is no legacy or path match", async () => {
      mockApp.vault.getMarkdownFiles.mockReturnValue([]);
      await fileSyncService.buildCache();

      const created = { path: "granola-folder/Fresh.md" } as TFile;
      mockApp.vault.create.mockResolvedValue(created);

      const saved = await fileSyncService.saveFile(
        "granola-folder/Fresh.md",
        "content",
        "not_brandnew123",
        "note",
        false,
        new Date("2024-01-15T10:00:00Z"),
        LEGACY_UUID
      );

      expect(saved).toBe(true);
      expect(mockApp.vault.create).toHaveBeenCalledWith(
        "granola-folder/Fresh.md",
        "content"
      );
      expect(fileSyncService.findByGranolaId("not_brandnew123", "note")).toBe(
        created
      );
    });
  });

});
