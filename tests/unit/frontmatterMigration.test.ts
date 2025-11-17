import { FrontmatterMigrationService } from "../../src/services/frontmatterMigration";
import { App, TFile } from "obsidian";

describe("FrontmatterMigrationService", () => {
  let mockApp: jest.Mocked<App>;
  let migrationService: FrontmatterMigrationService;

  beforeEach(() => {
    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
    } as unknown as jest.Mocked<App>;

    migrationService = new FrontmatterMigrationService(mockApp);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("migrateLegacyFrontmatter", () => {
    it("should migrate transcript file with -transcript suffix", async () => {
      const mockFile = { path: "transcript.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "doc-123-transcript",
          title: "Test Transcript",
        },
      } as never);

      const oldContent = `---
granola_id: doc-123-transcript
title: "Test Transcript"
---

# Transcript for: Test Meeting`;

      const expectedContent = `---
granola_id: doc-123
title: "Test Transcript"
type: transcript
---

# Transcript for: Test Meeting`;

      mockApp.vault.read.mockResolvedValue(oldContent);

      await migrationService.migrateLegacyFrontmatter();

      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        mockFile,
        expectedContent
      );
    });

    it("should add type field to note without type", async () => {
      const mockFile = { path: "note.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "doc-456",
          title: "Test Note",
        },
      } as never);

      const oldContent = `---
granola_id: doc-456
title: "Test Note"
---

Content here`;

      const expectedContent = `---
granola_id: doc-456
title: "Test Note"
type: note
---

Content here`;

      mockApp.vault.read.mockResolvedValue(oldContent);

      await migrationService.migrateLegacyFrontmatter();

      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        mockFile,
        expectedContent
      );
    });

    it("should not modify files already in new format", async () => {
      const mockFile = { path: "note.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "doc-123",
          title: "Test Note",
          type: "note",
        },
      } as never);

      const content = `---
granola_id: doc-123
title: "Test Note"
type: note
---

Content`;

      mockApp.vault.read.mockResolvedValue(content);

      await migrationService.migrateLegacyFrontmatter();

      expect(mockApp.vault.modify).not.toHaveBeenCalled();
    });

    it("should skip files without granola_id", async () => {
      const mockFile = { path: "other.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          title: "Other Note",
        },
      } as never);

      await migrationService.migrateLegacyFrontmatter();

      expect(mockApp.vault.read).not.toHaveBeenCalled();
      expect(mockApp.vault.modify).not.toHaveBeenCalled();
    });

    it("should skip files without frontmatter", async () => {
      const mockFile = { path: "plain.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      await migrationService.migrateLegacyFrontmatter();

      expect(mockApp.vault.read).not.toHaveBeenCalled();
      expect(mockApp.vault.modify).not.toHaveBeenCalled();
    });

    it("should handle both -transcript suffix and missing type", async () => {
      const mockFile = { path: "transcript.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "doc-789-transcript",
          title: "Meeting Transcript",
        },
      } as never);

      const oldContent = `---
granola_id: doc-789-transcript
title: "Meeting Transcript"
---

# Transcript for: Meeting`;

      const expectedContent = `---
granola_id: doc-789
title: "Meeting Transcript"
type: transcript
---

# Transcript for: Meeting`;

      mockApp.vault.read.mockResolvedValue(oldContent);

      await migrationService.migrateLegacyFrontmatter();

      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        mockFile,
        expectedContent
      );
    });

    it("should handle errors gracefully and continue processing other files", async () => {
      const mockFile1 = { path: "file1.md" } as TFile;
      const mockFile2 = { path: "file2.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile1, mockFile2]);

      // First file will error
      mockApp.metadataCache.getFileCache
        .mockReturnValueOnce({
          frontmatter: {
            granola_id: "doc-1",
          },
        } as never)
        .mockReturnValueOnce({
          frontmatter: {
            granola_id: "doc-2",
            title: "File 2",
          },
        } as never);

      mockApp.vault.read
        .mockRejectedValueOnce(new Error("Read error"))
        .mockResolvedValueOnce(`---
granola_id: doc-2
title: "File 2"
---
Content`);

      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await migrationService.migrateLegacyFrontmatter();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Granola Sync]",
        "Error migrating frontmatter for file1.md:",
        expect.any(Error)
      );
      expect(mockApp.vault.modify).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });

    it("should detect transcript type from content when suffix is missing", async () => {
      const mockFile = { path: "transcript.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "doc-999",
          title: "Transcript",
        },
      } as never);

      const oldContent = `---
granola_id: doc-999
title: "Transcript"
---

# Transcript for: Some Meeting`;

      const expectedContent = `---
granola_id: doc-999
title: "Transcript"
type: transcript
---

# Transcript for: Some Meeting`;

      mockApp.vault.read.mockResolvedValue(oldContent);

      await migrationService.migrateLegacyFrontmatter();

      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        mockFile,
        expectedContent
      );
    });

    it("should insert type field after granola_id when title is missing", async () => {
      const mockFile = { path: "note.md" } as TFile;
      mockApp.vault.getMarkdownFiles.mockReturnValue([mockFile]);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          granola_id: "doc-111",
          created_at: "2024-01-15T10:00:00Z",
        },
      } as never);

      const oldContent = `---
granola_id: doc-111
created_at: 2024-01-15T10:00:00Z
---

Content`;

      const expectedContent = `---
granola_id: doc-111
type: note
created_at: 2024-01-15T10:00:00Z
---

Content`;

      mockApp.vault.read.mockResolvedValue(oldContent);

      await migrationService.migrateLegacyFrontmatter();

      expect(mockApp.vault.modify).toHaveBeenCalledWith(
        mockFile,
        expectedContent
      );
    });
  });
});
