import { App, TFile, MarkdownView } from "obsidian";
import { getEditorForFile } from "../../src/utils/fileUtils";

describe("fileUtils", () => {
  describe("getEditorForFile", () => {
    let mockApp: jest.Mocked<App>;
    let mockFile: TFile;

    beforeEach(() => {
      mockFile = {
        path: "test.md",
        extension: "md",
      } as TFile;

      mockApp = {
        workspace: {
          iterateAllLeaves: jest.fn(),
        },
      } as any;
    });


    it("should return null when file is not open", () => {
      const mockLeaf = {
        view: {
          file: { path: "other.md" } as TFile,
          editor: { cmEditor: {} },
        },
      };

      (mockApp.workspace.iterateAllLeaves as jest.Mock).mockImplementation(
        (callback) => {
          callback(mockLeaf);
        }
      );

      const result = getEditorForFile(mockApp, mockFile);

      expect(result).toBeNull();
    });

    it("should return null when no leaves exist", () => {
      (mockApp.workspace.iterateAllLeaves as jest.Mock).mockImplementation(
        () => {
          // No callback invocation
        }
      );

      const result = getEditorForFile(mockApp, mockFile);

      expect(result).toBeNull();
    });

    it("should return null when view is not a MarkdownView", () => {
      const mockLeaf = {
        view: {
          file: mockFile,
          // Not a MarkdownView, so editor won't match
        },
      };

      (mockApp.workspace.iterateAllLeaves as jest.Mock).mockImplementation(
        (callback) => {
          callback(mockLeaf);
        }
      );

      const result = getEditorForFile(mockApp, mockFile);

      expect(result).toBeNull();
    });


    it("should handle leaves with null or undefined views", () => {
      const mockLeaf1 = { view: null };
      const mockLeaf2 = { view: undefined };
      const mockLeaf3 = {
        view: {
          file: mockFile,
          editor: { cmEditor: { getValue: jest.fn() } },
        },
      };

      (mockApp.workspace.iterateAllLeaves as jest.Mock).mockImplementation(
        (callback) => {
          callback(mockLeaf1);
          callback(mockLeaf2);
          callback(mockLeaf3);
        }
      );

      const result = getEditorForFile(mockApp, mockFile);

      expect(result).toBeDefined();
    });
  });
});
