import { FileSyncService } from "../../src/services/fileSyncService";
import { App, TFile } from "obsidian";

describe("FileSyncService", () => {
  let mockApp: jest.Mocked<App>;
  let fileSyncService: FileSyncService;

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

    fileSyncService = new FileSyncService(mockApp);
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
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
      mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
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

      const result = await fileSyncService.saveFile("new.md", "content");

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
});
