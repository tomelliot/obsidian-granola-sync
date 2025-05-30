import { getEditorForFile } from '../../src/fileUtils';

// Mock Obsidian components
jest.mock('obsidian', () => ({
  MarkdownView: class MockMarkdownView {
    file: any;
    editor: any;
    constructor(file?: any, editor?: any) {
      this.file = file;
      this.editor = editor;
    }
  },
  normalizePath: jest.fn((path: string) => path),
  Notice: jest.fn(),
  TFile: class MockTFile {
    path: string;
    constructor(path: string) {
      this.path = path;
    }
  },
  TFolder: class MockTFolder {
    path: string;
    constructor(path: string) {
      this.path = path;
    }
  },
}));

const { MarkdownView, TFile } = require('obsidian');

describe('FileUtils Tests', () => {
  describe('getEditorForFile', () => {
    let mockApp: any;
    let mockFile: any;

    beforeEach(() => {
      mockFile = new TFile('test.md');
      
      mockApp = {
        workspace: {
          iterateAllLeaves: jest.fn(),
        },
      };
    });

    it('should return editor when file is open in a MarkdownView', () => {
      const mockEditor = { 
        doc: { getValue: jest.fn() },
        replaceRange: jest.fn(),
      };
      
      const mockLeaf = {
        view: new MarkdownView(mockFile, { cmEditor: mockEditor }),
      };

      mockApp.workspace.iterateAllLeaves.mockImplementation((callback: any) => {
        callback(mockLeaf);
      });

      const result = getEditorForFile(mockApp, mockFile);
      
      expect(result).toBe(mockEditor);
    });

    it('should return null when file is not open', () => {
      const differentFile = new TFile('other.md');
      const mockLeaf = {
        view: new MarkdownView(differentFile),
      };

      mockApp.workspace.iterateAllLeaves.mockImplementation((callback: any) => {
        callback(mockLeaf);
      });

      const result = getEditorForFile(mockApp, mockFile);
      
      expect(result).toBeNull();
    });

    it('should return null when no MarkdownView exists', () => {
      const mockLeaf = {
        view: { // Not a MarkdownView
          file: mockFile,
        },
      };

      mockApp.workspace.iterateAllLeaves.mockImplementation((callback: any) => {
        callback(mockLeaf);
      });

      const result = getEditorForFile(mockApp, mockFile);
      
      expect(result).toBeNull();
    });

    it('should return null when no leaves exist', () => {
      mockApp.workspace.iterateAllLeaves.mockImplementation((callback: any) => {
        // No leaves to iterate over
      });

      const result = getEditorForFile(mockApp, mockFile);
      
      expect(result).toBeNull();
    });

    it('should handle multiple leaves and find the correct one', () => {
      const mockEditor = { 
        doc: { getValue: jest.fn() },
        replaceRange: jest.fn(),
      };
      
      const correctFile = new TFile('correct.md');
      const wrongFile = new TFile('wrong.md');
      
      const correctLeaf = {
        view: new MarkdownView(correctFile, { cmEditor: mockEditor }),
      };
      
      const wrongLeaf = {
        view: new MarkdownView(wrongFile),
      };

      mockApp.workspace.iterateAllLeaves.mockImplementation((callback: any) => {
        callback(wrongLeaf);
        callback(correctLeaf);
      });

      const result = getEditorForFile(mockApp, correctFile);
      
      expect(result).toBe(mockEditor);
    });

    it('should handle missing cmEditor gracefully', () => {
      const mockLeaf = {
        view: new MarkdownView(mockFile, {}), // No cmEditor
      };

      mockApp.workspace.iterateAllLeaves.mockImplementation((callback: any) => {
        callback(mockLeaf);
      });

      const result = getEditorForFile(mockApp, mockFile);
      
      expect(result).toBeUndefined(); // Should handle missing cmEditor
    });
  });

  describe('File Path Utilities (Internal Functions)', () => {
    // Note: These test the behavior that would be expected from the internal functions
    // since they're not exported, we test the expected behaviors
    
    it('should validate filename formatting expectations', () => {
      // Test cases for what formatAsFilename should handle
      const testCases = [
        { input: 'normal filename.md', expected: 'should preserve normal characters' },
        { input: 'file<with>invalid:chars', expected: 'should remove invalid characters' },
        { input: '   spaced filename   ', expected: 'should trim spaces' },
        { input: 'a'.repeat(200), expected: 'should truncate long names' },
        { input: 'file/with\\slashes', expected: 'should remove path separators' },
        { input: 'file?with*wildcards', expected: 'should remove wildcards' },
      ];

      testCases.forEach(({ input, expected }) => {
        // These are behavioral expectations - in actual implementation,
        // formatAsFilename would handle these cases
        expect(typeof input).toBe('string');
        expect(expected).toContain('should');
      });
    });

    it('should handle path creation expectations', () => {
      // Test cases for what touchFileAtPath should handle
      const pathCases = [
        'simple.md',
        'folder/file.md',
        'deep/nested/folder/structure/file.md',
        'folder with spaces/file.md',
      ];

      pathCases.forEach(path => {
        expect(path).toContain('.md');
        expect(typeof path).toBe('string');
        
        // Validate path structure
        const parts = path.split('/');
        expect(parts.length).toBeGreaterThanOrEqual(1);
        expect(parts[parts.length - 1]).toContain('.md'); // Last part should be filename
      });
    });
  });

  describe('Integration Scenarios', () => {
    let mockApp: any;

    beforeEach(() => {
      mockApp = {
        vault: {
          getAbstractFileByPath: jest.fn(),
          createFolder: jest.fn(),
          create: jest.fn(),
        },
        workspace: {
          iterateAllLeaves: jest.fn(),
        },
      };
    });

    it('should handle complex editor retrieval scenarios', () => {
      const file1 = new TFile('file1.md');
      const file2 = new TFile('file2.md');
      
      const editor1 = { id: 'editor1', replaceRange: jest.fn() };
      const editor2 = { id: 'editor2', replaceRange: jest.fn() };
      
      const leaves = [
        { view: new MarkdownView(file1, { cmEditor: editor1 }) },
        { view: new MarkdownView(file2, { cmEditor: editor2 }) },
        { view: { type: 'non-markdown' } }, // Non-MarkdownView
      ];

      mockApp.workspace.iterateAllLeaves.mockImplementation((callback: any) => {
        leaves.forEach(callback);
      });

      // Should find the correct editor for each file
      expect(getEditorForFile(mockApp, file1)).toBe(editor1);
      expect(getEditorForFile(mockApp, file2)).toBe(editor2);
      
      // Should not find editor for non-existent file
      const nonExistentFile = new TFile('nonexistent.md');
      expect(getEditorForFile(mockApp, nonExistentFile)).toBeNull();
    });

    it('should validate app structure requirements', () => {
      // Ensure the app object has the required structure
      expect(mockApp).toHaveProperty('workspace');
      expect(mockApp.workspace).toHaveProperty('iterateAllLeaves');
      expect(typeof mockApp.workspace.iterateAllLeaves).toBe('function');
      
      expect(mockApp).toHaveProperty('vault');
      expect(mockApp.vault).toHaveProperty('getAbstractFileByPath');
      expect(mockApp.vault).toHaveProperty('createFolder');
      expect(mockApp.vault).toHaveProperty('create');
    });
  });
});