import { FileSyncService } from "../../src/services/fileSyncService";
import { TFile, Vault, MetadataCache, normalizePath } from "obsidian";

// Mock Obsidian
jest.mock("obsidian", () => ({
  normalizePath: jest.fn((path: string) => path),
  Notice: jest.fn(),
  TFile: jest.fn(),
  Vault: jest.fn(),
  MetadataCache: jest.fn(),
}));

describe("FileSyncService", () => {
  let service: FileSyncService;
  let mockVault: jest.Mocked<Vault>;
  let mockMetadataCache: jest.Mocked<MetadataCache>;

  beforeEach(() => {
    mockVault = {
      getMarkdownFiles: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      createFolder: jest.fn(),
      read: jest.fn(),
      modify: jest.fn(),
      create: jest.fn(),
      rename: jest.fn(),
    } as any;

    mockMetadataCache = {
      getFileCache: jest.fn(),
    } as any;

    service = new FileSyncService(mockVault, mockMetadataCache);
  });

  describe("buildCache", () => {
    it("should build cache from markdown files with granola_id", async () => {
      const mockFile1 = { path: "file1.md" } as TFile;
      const mockFile2 = { path: "file2.md" } as TFile;
      const mockFile3 = { path: "file3.md" } as TFile;

      mockVault.getMarkdownFiles.mockReturnValue([mockFile1, mockFile2, mockFile3]);
      mockMetadataCache.getFileCache
        .mockReturnValueOnce({ frontmatter: { granola_id: "id-1" } } as any)
        .mockReturnValueOnce({ frontmatter: { granola_id: "id-2" } } as any)
        .mockReturnValueOnce({ frontmatter: {} } as any);

      await service.buildCache();

      expect(service.findByGranolaId("id-1")).toBe(mockFile1);
      expect(service.findByGranolaId("id-2")).toBe(mockFile2);
      expect(service.findByGranolaId("id-3")).toBeNull();
    });

    it("should handle files without frontmatter", async () => {
      const mockFile = { path: "file.md" } as TFile;
      mockVault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockMetadataCache.getFileCache.mockReturnValue(null);

      await service.buildCache();

      expect(service.findByGranolaId("any-id")).toBeNull();
    });

    it("should handle errors when reading frontmatter", async () => {
      const mockFile = { path: "file.md" } as TFile;
      mockVault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockMetadataCache.getFileCache.mockImplementation(() => {
        throw new Error("Read error");
      });

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await service.buildCache();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should clear existing cache before building", async () => {
      const mockFile1 = { path: "file1.md" } as TFile;
      const mockFile2 = { path: "file2.md" } as TFile;

      // First build
      mockVault.getMarkdownFiles.mockReturnValue([mockFile1]);
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: { granola_id: "id-1" } } as any);
      await service.buildCache();

      // Second build with different files
      mockVault.getMarkdownFiles.mockReturnValue([mockFile2]);
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: { granola_id: "id-2" } } as any);
      await service.buildCache();

      expect(service.findByGranolaId("id-1")).toBeNull();
      expect(service.findByGranolaId("id-2")).toBe(mockFile2);
    });
  });

  describe("findByGranolaId", () => {
    it("should return file if exists in cache", async () => {
      const mockFile = { path: "file.md" } as TFile;
      mockVault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: { granola_id: "id-1" } } as any);

      await service.buildCache();

      expect(service.findByGranolaId("id-1")).toBe(mockFile);
    });

    it("should return null if not in cache", async () => {
      mockVault.getMarkdownFiles.mockReturnValue([]);
      await service.buildCache();

      expect(service.findByGranolaId("nonexistent-id")).toBeNull();
    });
  });

  describe("updateCache", () => {
    it("should update cache with granola ID", () => {
      const mockFile = { path: "file.md" } as TFile;

      service.updateCache("id-1", mockFile);

      expect(service.findByGranolaId("id-1")).toBe(mockFile);
    });

    it("should not update cache if granola ID is undefined", () => {
      const mockFile = { path: "file.md" } as TFile;

      service.updateCache(undefined, mockFile);

      expect(service.findByGranolaId("undefined")).toBeNull();
    });
  });

  describe("ensureFolder", () => {
    it("should return true if folder already exists", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue({} as any);

      const result = await service.ensureFolder("existing/folder");

      expect(result).toBe(true);
      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it("should create folder if it does not exist", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.createFolder.mockResolvedValue(undefined as any);

      const result = await service.ensureFolder("new/folder");

      expect(result).toBe(true);
      expect(mockVault.createFolder).toHaveBeenCalledWith("new/folder");
    });

    it("should return false and show notice on error", async () => {
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.createFolder.mockRejectedValue(new Error("Creation failed"));

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const result = await service.ensureFolder("error/folder");

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("saveFile", () => {
    it("should create new file if none exists", async () => {
      const mockFile = { path: "new/file.md" } as TFile;
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      mockVault.create.mockResolvedValue(mockFile);

      const result = await service.saveFile("new/file.md", "content", "id-1");

      expect(result).toBe(true);
      expect(mockVault.create).toHaveBeenCalledWith("new/file.md", "content");
      expect(service.findByGranolaId("id-1")).toBe(mockFile);
    });

    it("should update existing file with different content", async () => {
      const mockFile = { path: "existing.md" } as TFile;
      // First, cache the file by granola ID
      service.updateCache("id-1", mockFile);
      mockVault.read.mockResolvedValue("old content");
      mockVault.modify.mockResolvedValue(undefined);

      const result = await service.saveFile("existing.md", "new content", "id-1");

      expect(result).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, "new content");
    });

    it("should not update file with same content", async () => {
      const mockFile = { path: "existing.md" } as TFile;
      service.updateCache("id-1", mockFile);
      mockVault.read.mockResolvedValue("same content");

      const result = await service.saveFile("existing.md", "same content", "id-1");

      expect(result).toBe(false);
      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should rename file if path changed", async () => {
      const mockFile = { path: "old/path.md" } as TFile;
      service.updateCache("id-1", mockFile);
      mockVault.read.mockResolvedValue("old content");
      mockVault.modify.mockResolvedValue(undefined);
      mockVault.rename.mockResolvedValue(undefined);

      const result = await service.saveFile("new/path.md", "new content", "id-1");

      expect(result).toBe(true);
      expect(mockVault.rename).toHaveBeenCalledWith(mockFile, "new/path.md");
    });

    it("should handle rename errors gracefully", async () => {
      const mockFile = { path: "old/path.md" } as TFile;
      service.updateCache("id-1", mockFile);
      mockVault.read.mockResolvedValue("old content");
      mockVault.modify.mockResolvedValue(undefined);
      mockVault.rename.mockRejectedValue(new Error("Rename failed"));

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      const result = await service.saveFile("new/path.md", "new content", "id-1");

      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should find file by granola ID before checking path", async () => {
      const mockFile = { path: "original/path.md" } as TFile;
      service.updateCache("id-1", mockFile);
      mockVault.read.mockResolvedValue("content");

      await service.saveFile("different/path.md", "content", "id-1");

      // Should find by ID, not by path
      expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
    });

    it("should return false on error", async () => {
      mockVault.getAbstractFileByPath.mockImplementation(() => {
        throw new Error("Vault error");
      });

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const result = await service.saveFile("path.md", "content");

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });
  });
});
