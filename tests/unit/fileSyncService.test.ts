import { App, TFile } from "obsidian";
import { FileSyncService } from "../../src/services/fileSyncService";
import type { GranolaDoc } from "../../src/services/granolaApi";
import type { DocumentProcessor } from "../../src/services/documentProcessor";
import type { PathResolver } from "../../src/services/pathResolver";
import {
  DEFAULT_SETTINGS,
  GranolaSyncSettings,
  SyncDestination,
  TranscriptDestination,
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

    // Create a mock app with vault and metadataCache
    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn(),
        getAbstractFileByPath: jest.fn(),
        createFolder: jest.fn(),
        create: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
        rename: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
    } as any;

    mockPathResolver = {
      computeDailyNoteFolderPath: jest.fn().mockReturnValue("daily-folder"),
      computeTranscriptPath: jest.fn(),
    } as unknown as jest.Mocked<PathResolver>;

    mockSettings = {
      ...DEFAULT_SETTINGS,
      syncDestination: SyncDestination.GRANOLA_FOLDER,
      granolaFolder: "granola-folder",
      transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
      granolaTranscriptsFolder: "granola-transcripts",
    };

    fileSyncService = new FileSyncService(
      mockApp,
      mockPathResolver,
      () => mockSettings
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  describe("saveToDisk", () => {
    it("should return false when folder path cannot be resolved", async () => {
      mockSettings.syncDestination = "invalid" as SyncDestination;
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
      mockSettings.syncDestination = SyncDestination.GRANOLA_FOLDER;
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
        "note"
      );
    });

    it("should append created date when filename already exists", async () => {
      jest.spyOn(fileSyncService, "ensureFolder").mockResolvedValue(true);
      const existingFile = new TFile("granola-folder/note.md");
      mockApp.vault.getAbstractFileByPath.mockReturnValue(existingFile);
      const saveFileSpy = jest
        .spyOn(fileSyncService, "saveFile")
        .mockResolvedValue(true);
      jest
        .spyOn(dateUtils, "formatDateForFilename")
        .mockReturnValue("2024-01-01 10-30");

      const noteDate = new Date("2024-01-01T10:30:00Z");
      await fileSyncService.saveToDisk(
        "note.md",
        "content",
        noteDate,
        "doc-1"
      );

      expect(saveFileSpy).toHaveBeenCalledWith(
        "granola-folder/note-2024-01-01_10-30.md",
        "content",
        "doc-1",
        "note"
      );
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

    it("should return false when doc id is missing", async () => {
      const doc = { title: "No ID" } as GranolaDoc;

      const result = await fileSyncService.saveNoteToDisk(
        doc,
        mockDocumentProcessor
      );

      expect(result).toBe(false);
      expect(mockDocumentProcessor.prepareNote).not.toHaveBeenCalled();
    });

    it("should prepare note and delegate to saveToDisk", async () => {
      const doc = { id: "doc-1" } as GranolaDoc;
      const noteDate = new Date("2024-01-02T12:00:00Z");
      mockDocumentProcessor.prepareNote.mockReturnValue({
        filename: "note.md",
        content: "content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);
      const saveToDiskSpy = jest
        .spyOn(fileSyncService, "saveToDisk")
        .mockResolvedValue(true);

      const result = await fileSyncService.saveNoteToDisk(
        doc,
        mockDocumentProcessor
      );

      expect(result).toBe(true);
      expect(mockDocumentProcessor.prepareNote).toHaveBeenCalledWith(doc);
      expect(saveToDiskSpy).toHaveBeenCalledWith(
        "note.md",
        "content",
        noteDate,
        "doc-1",
        false
      );
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

    it("should return false when doc id is missing", async () => {
      const doc = { title: "No ID" } as GranolaDoc;

      const result = await fileSyncService.saveTranscriptToDisk(
        doc,
        "transcript content",
        mockDocumentProcessor
      );

      expect(result).toBe(false);
      expect(mockDocumentProcessor.prepareTranscript).not.toHaveBeenCalled();
    });

    it("should prepare transcript and delegate to saveToDisk", async () => {
      const doc = { id: "doc-1" } as GranolaDoc;
      const noteDate = new Date("2024-01-03T09:15:00Z");
      mockDocumentProcessor.prepareTranscript.mockReturnValue({
        filename: "note-transcript.md",
        content: "transcript content",
      });
      jest.spyOn(dateUtils, "getNoteDate").mockReturnValue(noteDate);
      const saveToDiskSpy = jest
        .spyOn(fileSyncService, "saveToDisk")
        .mockResolvedValue(true);

      const result = await fileSyncService.saveTranscriptToDisk(
        doc,
        "transcript content",
        mockDocumentProcessor
      );

      expect(result).toBe(true);
      expect(mockDocumentProcessor.prepareTranscript).toHaveBeenCalledWith(
        doc,
        "transcript content"
      );
      expect(saveToDiskSpy).toHaveBeenCalledWith(
        "note-transcript.md",
        "transcript content",
        noteDate,
        "doc-1",
        true
      );
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
  });
});
