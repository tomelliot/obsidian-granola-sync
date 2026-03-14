import {
  resolveFolderPath,
  buildFolderMap,
  diffFolderMaps,
  FolderMapData,
  FolderInfo,
} from "../../src/services/folderMapBuilder";
import {
  fetchDocumentListsMetadata,
  fetchDocumentList,
} from "../../src/services/granolaApi";

jest.mock("../../src/services/granolaApi");
jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("folderMapBuilder", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("resolveFolderPath", () => {
    it("should resolve a top-level folder path", () => {
      const folders: Record<string, FolderInfo> = {
        "folder-1": { title: "Marlu", parentId: null },
      };

      expect(resolveFolderPath("folder-1", folders)).toBe("Marlu");
    });

    it("should resolve a nested folder path", () => {
      const folders: Record<string, FolderInfo> = {
        "parent-1": { title: "Clients", parentId: null },
        "child-1": { title: "Good2Go", parentId: "parent-1" },
      };

      expect(resolveFolderPath("child-1", folders)).toBe("Clients/Good2Go");
    });

    it("should resolve a deeply nested folder path", () => {
      const folders: Record<string, FolderInfo> = {
        "grandparent": { title: "Top", parentId: null },
        "parent": { title: "Middle", parentId: "grandparent" },
        "child": { title: "Bottom", parentId: "parent" },
      };

      expect(resolveFolderPath("child", folders)).toBe("Top/Middle/Bottom");
    });

    it("should handle missing parent gracefully", () => {
      const folders: Record<string, FolderInfo> = {
        "child-1": { title: "Orphan", parentId: "missing-parent" },
      };

      // Should just return the child title since parent is not in the map
      expect(resolveFolderPath("child-1", folders)).toBe("Orphan");
    });

    it("should handle circular references", () => {
      const folders: Record<string, FolderInfo> = {
        "a": { title: "A", parentId: "b" },
        "b": { title: "B", parentId: "a" },
      };

      // Should not infinite loop — just return whatever it can resolve
      const result = resolveFolderPath("a", folders);
      expect(result).toBeTruthy();
      expect(result.split("/").length).toBeLessThanOrEqual(2);
    });

    it("should return empty string for unknown folder ID", () => {
      const folders: Record<string, FolderInfo> = {};
      expect(resolveFolderPath("unknown", folders)).toBe("");
    });
  });

  describe("buildFolderMap", () => {
    it("should build a complete folder map from API data", async () => {
      (fetchDocumentListsMetadata as jest.Mock).mockResolvedValue({
        "folder-1": {
          id: "folder-1",
          title: "Marlu",
          parent_document_list_id: null,
        },
        "folder-2": {
          id: "folder-2",
          title: "Good2Go",
          parent_document_list_id: "folder-3",
        },
        "folder-3": {
          id: "folder-3",
          title: "Clients",
          parent_document_list_id: null,
        },
      });

      (fetchDocumentList as jest.Mock)
        .mockResolvedValueOnce({
          id: "folder-1",
          title: "Marlu",
          parent_document_list_id: null,
          documents: [{ id: "doc-1" }, { id: "doc-2" }],
        })
        .mockResolvedValueOnce({
          id: "folder-2",
          title: "Good2Go",
          parent_document_list_id: "folder-3",
          documents: [{ id: "doc-2" }, { id: "doc-3" }],
        })
        .mockResolvedValueOnce({
          id: "folder-3",
          title: "Clients",
          parent_document_list_id: null,
          documents: [],
        });

      const result = await buildFolderMap("test-token");

      expect(result.folders).toEqual({
        "folder-1": { title: "Marlu", parentId: null },
        "folder-2": { title: "Good2Go", parentId: "folder-3" },
        "folder-3": { title: "Clients", parentId: null },
      });

      // doc-1 is only in Marlu
      expect(result.docFolders["doc-1"]).toEqual(["Marlu"]);
      // doc-2 is in both Marlu and Clients/Good2Go
      expect(result.docFolders["doc-2"]).toEqual(
        expect.arrayContaining(["Marlu", "Clients/Good2Go"])
      );
      // doc-3 is only in Clients/Good2Go
      expect(result.docFolders["doc-3"]).toEqual(["Clients/Good2Go"]);

      expect(result.lastUpdated).toBeGreaterThan(0);
    });

    it("should handle empty folder list", async () => {
      (fetchDocumentListsMetadata as jest.Mock).mockResolvedValue({});

      const result = await buildFolderMap("test-token");

      expect(result.folders).toEqual({});
      expect(result.docFolders).toEqual({});
      expect(fetchDocumentList).not.toHaveBeenCalled();
    });

    it("should continue when a single folder fetch fails", async () => {
      (fetchDocumentListsMetadata as jest.Mock).mockResolvedValue({
        "folder-1": {
          id: "folder-1",
          title: "Working",
          parent_document_list_id: null,
        },
        "folder-2": {
          id: "folder-2",
          title: "Broken",
          parent_document_list_id: null,
        },
      });

      (fetchDocumentList as jest.Mock)
        .mockResolvedValueOnce({
          id: "folder-1",
          title: "Working",
          parent_document_list_id: null,
          documents: [{ id: "doc-1" }],
        })
        .mockRejectedValueOnce(new Error("API error"));

      const result = await buildFolderMap("test-token");

      expect(result.docFolders["doc-1"]).toEqual(["Working"]);
      expect(Object.keys(result.folders)).toHaveLength(2);
    });

    it("should handle folders with no documents array", async () => {
      (fetchDocumentListsMetadata as jest.Mock).mockResolvedValue({
        "folder-1": {
          id: "folder-1",
          title: "Empty",
          parent_document_list_id: null,
        },
      });

      (fetchDocumentList as jest.Mock).mockResolvedValue({
        id: "folder-1",
        title: "Empty",
        parent_document_list_id: null,
        documents: [],
      });

      const result = await buildFolderMap("test-token");

      expect(result.docFolders).toEqual({});
    });
  });

  describe("diffFolderMaps", () => {
    it("should return empty diff when previous is null", () => {
      const current: FolderMapData = {
        folders: { "f1": { title: "Folder", parentId: null } },
        docFolders: {},
        lastUpdated: Date.now(),
      };

      const diff = diffFolderMaps(null, current);
      expect(diff.renamedPaths.size).toBe(0);
    });

    it("should detect a simple folder rename", () => {
      const previous: FolderMapData = {
        folders: { "f1": { title: "Old Name", parentId: null } },
        docFolders: { "doc-1": ["Old Name"] },
        lastUpdated: Date.now() - 1000,
      };

      const current: FolderMapData = {
        folders: { "f1": { title: "New Name", parentId: null } },
        docFolders: { "doc-1": ["New Name"] },
        lastUpdated: Date.now(),
      };

      const diff = diffFolderMaps(previous, current);
      expect(diff.renamedPaths.get("Old Name")).toBe("New Name");
    });

    it("should detect a folder move (parent change)", () => {
      const previous: FolderMapData = {
        folders: {
          "parent-1": { title: "Parent1", parentId: null },
          "parent-2": { title: "Parent2", parentId: null },
          "child": { title: "Child", parentId: "parent-1" },
        },
        docFolders: {},
        lastUpdated: Date.now() - 1000,
      };

      const current: FolderMapData = {
        folders: {
          "parent-1": { title: "Parent1", parentId: null },
          "parent-2": { title: "Parent2", parentId: null },
          "child": { title: "Child", parentId: "parent-2" },
        },
        docFolders: {},
        lastUpdated: Date.now(),
      };

      const diff = diffFolderMaps(previous, current);
      expect(diff.renamedPaths.get("Parent1/Child")).toBe("Parent2/Child");
    });

    it("should detect cascade rename when parent is renamed", () => {
      const previous: FolderMapData = {
        folders: {
          "parent": { title: "OldParent", parentId: null },
          "child": { title: "Child", parentId: "parent" },
        },
        docFolders: {},
        lastUpdated: Date.now() - 1000,
      };

      const current: FolderMapData = {
        folders: {
          "parent": { title: "NewParent", parentId: null },
          "child": { title: "Child", parentId: "parent" },
        },
        docFolders: {},
        lastUpdated: Date.now(),
      };

      const diff = diffFolderMaps(previous, current);
      expect(diff.renamedPaths.get("OldParent")).toBe("NewParent");
      expect(diff.renamedPaths.get("OldParent/Child")).toBe("NewParent/Child");
    });

    it("should not report unchanged folders", () => {
      const data: FolderMapData = {
        folders: {
          "f1": { title: "Same", parentId: null },
          "f2": { title: "AlsoSame", parentId: "f1" },
        },
        docFolders: {},
        lastUpdated: Date.now(),
      };

      const diff = diffFolderMaps(data, data);
      expect(diff.renamedPaths.size).toBe(0);
    });

    it("should handle new folders (no rename)", () => {
      const previous: FolderMapData = {
        folders: { "f1": { title: "Existing", parentId: null } },
        docFolders: {},
        lastUpdated: Date.now() - 1000,
      };

      const current: FolderMapData = {
        folders: {
          "f1": { title: "Existing", parentId: null },
          "f2": { title: "NewFolder", parentId: null },
        },
        docFolders: {},
        lastUpdated: Date.now(),
      };

      const diff = diffFolderMaps(previous, current);
      expect(diff.renamedPaths.size).toBe(0);
    });
  });
});
