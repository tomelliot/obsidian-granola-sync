import GranolaSync from '../../src/main';
import { Notice } from 'obsidian';
import { updateSection } from '../../src/textUtils';

// Mock external dependencies
jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  Plugin: class MockPlugin {
    app: any;
    manifest: any;
    constructor(app: any, manifest: any) {
      this.app = app;
      this.manifest = manifest;
    }
    loadData = jest.fn();
    saveData = jest.fn();
    registerInterval = jest.fn();
    addCommand = jest.fn();
    addStatusBarItem = jest.fn(() => ({ setText: jest.fn() }));
    addSettingTab = jest.fn();
  },
  requestUrl: jest.fn(),
  normalizePath: jest.fn((path: string) => path),
}));

jest.mock('obsidian-daily-notes-interface', () => ({
  createDailyNote: jest.fn(),
  getDailyNote: jest.fn(),
  getAllDailyNotes: jest.fn(),
  getDailyNoteSettings: jest.fn(() => ({ format: 'YYYY-MM-DD', folder: 'Daily Notes' })),
}));

jest.mock('../../src/textUtils', () => ({
  updateSection: jest.fn(),
}));

jest.mock('../../src/settings', () => ({
  DEFAULT_SETTINGS: {
    tokenPath: 'configs/supabase.json',
    granolaFolder: 'Granola',
    granolaTranscriptsFolder: 'Granola/Transcripts',
    latestSyncTime: 0,
    isSyncEnabled: false,
    syncInterval: 1800,
    syncNotes: true,
    syncTranscripts: false,
    syncDestination: 'daily_notes',
    transcriptDestination: 'granola_transcripts_folder',
    createLinkFromNoteToTranscript: false,
    dailyNoteSectionHeading: '## Granola Notes',
  },
  GranolaSyncSettingTab: jest.fn(),
  SyncDestination: {
    DAILY_NOTES: 'daily_notes',
    DAILY_NOTE_FOLDER_STRUCTURE: 'daily_note_folder_structure',
    GRANOLA_FOLDER: 'granola_folder',
  },
  TranscriptDestination: {
    DAILY_NOTE_FOLDER_STRUCTURE: 'daily_note_folder_structure',
    GRANOLA_TRANSCRIPTS_FOLDER: 'granola_transcripts_folder',
  },
}));

const { requestUrl } = require('obsidian');
const { TranscriptDestination } = require('../../src/settings');

describe('GranolaSync Main Plugin Tests', () => {
  let plugin: GranolaSync;
  let mockApp: any;
  let mockManifest: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      vault: {
        adapter: {
          exists: jest.fn(),
          read: jest.fn(),
          write: jest.fn(),
        },
        createFolder: jest.fn(),
        modify: jest.fn(),
      },
      workspace: {
        containerEl: {
          querySelector: jest.fn(() => ({ setText: jest.fn() })),
        },
      },
    };

    mockManifest = {
      id: 'granola-sync',
      name: 'Granola Sync',
      version: '0.1.7',
      minAppVersion: '0.15.0',
      author: 'Test Author',
      description: 'Test Description',
    };

    plugin = new GranolaSync(mockApp, mockManifest);
    
    // Initialize settings with default values
    plugin.settings = {
      tokenPath: 'configs/supabase.json',
      granolaFolder: 'Granola',
      granolaTranscriptsFolder: 'Granola/Transcripts',
      latestSyncTime: 0,
      isSyncEnabled: false,
      syncInterval: 1800,
      syncNotes: true,
      syncTranscripts: false,
      syncDestination: 'daily_notes',
      transcriptDestination: 'granola_transcripts_folder',
      createLinkFromNoteToTranscript: false,
      dailyNoteSectionHeading: '## Granola Notes',
    } as any;
  });

  describe('Credential Management', () => {
    it('should handle missing token path', async () => {
      plugin.settings = { ...plugin.settings, tokenPath: '' };
      
      await plugin.loadCredentials();
      
      expect(plugin.tokenLoadError).toContain('Token path is not configured');
      expect(plugin.accessToken).toBeNull();
    });

    it('should reject absolute paths', async () => {
      plugin.settings = { ...plugin.settings, tokenPath: '/absolute/path/token.json' };
      
      await plugin.loadCredentials();
      
      expect(plugin.tokenLoadError).toContain('absolute path');
      expect(plugin.accessToken).toBeNull();
    });

    it('should handle non-existent credential files', async () => {
      plugin.settings = { ...plugin.settings, tokenPath: 'config/missing.json' };
      mockApp.vault.adapter.exists.mockResolvedValueOnce(false);
      
      await plugin.loadCredentials();
      
      expect(plugin.tokenLoadError).toContain('not found');
      expect(plugin.accessToken).toBeNull();
    });

    it('should successfully load valid credentials', async () => {
      const mockCredentials = {
        cognito_tokens: JSON.stringify({ access_token: 'valid_token_123' })
      };
      
      plugin.settings = { ...plugin.settings, tokenPath: 'config/valid.json' };
      mockApp.vault.adapter.exists.mockResolvedValueOnce(true);
      mockApp.vault.adapter.read.mockResolvedValueOnce(JSON.stringify(mockCredentials));
      
      await plugin.loadCredentials();
      
      expect(plugin.accessToken).toBe('valid_token_123');
      expect(plugin.tokenLoadError).toBeNull();
    });

    it('should handle malformed JSON in credentials', async () => {
      plugin.settings = { ...plugin.settings, tokenPath: 'config/invalid.json' };
      mockApp.vault.adapter.exists.mockResolvedValueOnce(true);
      mockApp.vault.adapter.read.mockResolvedValueOnce('invalid json');
      
      await plugin.loadCredentials();
      
      expect(plugin.tokenLoadError).toContain('Invalid JSON format');
      expect(plugin.accessToken).toBeNull();
    });
  });

  describe('File Path Utilities', () => {
    it('should sanitize filenames correctly', () => {
      const testCases = [
        ['normal file', 'normal_file'],
        ['file<with>invalid:chars', 'filewithinvalidchars'],
        ['file/with\\slashes', 'filewithslashes'],
        ['file with    multiple   spaces', 'file_with_multiple_spaces'],
      ];

      testCases.forEach(([input, expected]) => {
        const result = plugin['sanitizeFilename'](input);
        expect(result).toBe(expected);
      });
    });

    it('should truncate long filenames', () => {
      const longName = 'a'.repeat(300);
      const result = plugin['sanitizeFilename'](longName);
      expect(result.length).toBeLessThanOrEqual(200);
    });

    it('should compute transcript paths correctly', () => {
      const noteDate = new Date('2023-12-01');
      
      // Test daily note folder structure
      plugin.settings.transcriptDestination = TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE;
      const dailyNotePath = plugin['computeTranscriptPath']('Test Note', noteDate);
      expect(dailyNotePath).toContain('Test_Note-transcript.md');
      
      // Test granola transcripts folder
      plugin.settings.transcriptDestination = TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER;
      plugin.settings.granolaTranscriptsFolder = 'Transcripts';
      const granolaPath = plugin['computeTranscriptPath']('Test Note', noteDate);
      expect(granolaPath).toBe('Transcripts/Test_Note-transcript.md');
    });
  });

  describe('ProseMirror to Markdown Conversion', () => {
    it('should handle empty or null documents', () => {
      expect(plugin['convertProsemirrorToMarkdown'](null)).toBe('');
      expect(plugin['convertProsemirrorToMarkdown'](undefined)).toBe('');
      expect(plugin['convertProsemirrorToMarkdown']({ type: 'doc', content: [] })).toBe('');
    });

    it('should convert headings correctly', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'My Heading' }]
          }
        ]
      };
      
      const result = plugin['convertProsemirrorToMarkdown'](doc as any);
      expect(result).toBe('## My Heading');
    });

    it('should convert paragraphs correctly', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'First paragraph' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Second paragraph' }]
          }
        ]
      };
      
      const result = plugin['convertProsemirrorToMarkdown'](doc as any);
      expect(result).toBe('First paragraph\n\nSecond paragraph');
    });

    it('should convert bullet lists correctly', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'First item' }] }
                ]
              },
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Second item' }] }
                ]
              }
            ]
          }
        ]
      };
      
      const result = plugin['convertProsemirrorToMarkdown'](doc as any);
      expect(result).toContain('- First item');
      expect(result).toContain('- Second item');
    });
  });

  describe('API Error Handling', () => {
    beforeEach(() => {
      plugin.accessToken = 'valid_token';
      plugin.tokenLoadError = null;
    });

    it('should handle 401 authentication errors', async () => {
      const error = { status: 401 };
      requestUrl.mockRejectedValueOnce(error);

      const result = await plugin['fetchDocuments']('invalid_token');
      
      expect(result).toBeNull();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed'),
        10000
      );
    });

    it('should handle 403 permission errors', async () => {
      const error = { status: 403 };
      requestUrl.mockRejectedValueOnce(error);

      const result = await plugin['fetchDocuments']('valid_token');
      
      expect(result).toBeNull();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Access forbidden'),
        10000
      );
    });

    it('should handle 500 server errors', async () => {
      const error = { status: 500 };
      requestUrl.mockRejectedValueOnce(error);

      const result = await plugin['fetchDocuments']('valid_token');
      
      expect(result).toBeNull();
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('server error'),
        10000
      );
    });

    it('should handle successful API responses', async () => {
      const mockResponse = {
        json: {
          docs: [
            { id: '1', title: 'Test Doc', created_at: '2023-12-01' }
          ]
        }
      };
      requestUrl.mockResolvedValueOnce(mockResponse);

      const result = await plugin['fetchDocuments']('valid_token');
      
      expect(result).toEqual(mockResponse.json.docs);
    });
  });

  describe('Folder Management', () => {
    it('should create folders when they don\'t exist', async () => {
      mockApp.vault.adapter.exists.mockResolvedValueOnce(false);
      mockApp.vault.createFolder.mockResolvedValueOnce(undefined);

      const result = await plugin['ensureFolderExists']('test/folder');
      
      expect(mockApp.vault.createFolder).toHaveBeenCalledWith('test/folder');
      expect(result).toBe(true);
    });

    it('should skip creation if folder already exists', async () => {
      mockApp.vault.adapter.exists.mockResolvedValueOnce(true);

      const result = await plugin['ensureFolderExists']('existing/folder');
      
      expect(mockApp.vault.createFolder).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should handle folder creation errors', async () => {
      mockApp.vault.adapter.exists.mockResolvedValueOnce(false);
      mockApp.vault.createFolder.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await plugin['ensureFolderExists']('test/folder');
      
      expect(result).toBe(false);
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Could not create folder'),
        10000
      );
    });
  });

  describe('Transcript Formatting', () => {
    it('should format transcript data by speaker', () => {
      const transcriptData = [
        {
          document_id: '1',
          start_timestamp: '00:01',
          text: 'Hello there',
          source: 'microphone',
          id: '1',
          is_final: true,
          end_timestamp: '00:02'
        },
        {
          document_id: '1', 
          start_timestamp: '00:02',
          text: 'How are you?',
          source: 'microphone',
          id: '2',
          is_final: true,
          end_timestamp: '00:03'
        },
        {
          document_id: '1',
          start_timestamp: '00:03', 
          text: 'I am fine',
          source: 'system',
          id: '3',
          is_final: true,
          end_timestamp: '00:04'
        }
      ];

      const result = plugin['formatTranscriptBySpeaker'](transcriptData, 'Test Meeting');
      
      expect(result).toContain('# Transcript for: Test Meeting');
      expect(result).toContain('## Tom Elliot (00:01)');
      expect(result).toContain('Hello there How are you?');
      expect(result).toContain('## Guest (00:03)');
      expect(result).toContain('I am fine');
    });
  });

  describe('Settings Persistence', () => {
    it('should save settings and update sync configuration', async () => {
      plugin.saveData = jest.fn().mockResolvedValueOnce(undefined);
      const setupSyncSpy = jest.spyOn(plugin, 'setupPeriodicSync');
      
      await plugin.saveSettings();
      
      expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
      expect(setupSyncSpy).toHaveBeenCalled();
    });
  });

  describe('Periodic Sync Management', () => {
    it('should set up periodic sync when enabled', () => {
      plugin.settings.isSyncEnabled = true;
      plugin.settings.syncInterval = 300; // 5 minutes
      
      const setIntervalSpy = jest.spyOn(window, 'setInterval');
      
      plugin.setupPeriodicSync();
      
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000);
      expect(plugin.registerInterval).toHaveBeenCalled();
    });

    it('should not set up sync when disabled', () => {
      plugin.settings.isSyncEnabled = false;
      
      const setIntervalSpy = jest.spyOn(window, 'setInterval');
      
      plugin.setupPeriodicSync();
      
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(plugin.syncIntervalId).toBeNull();
    });

    it('should clear existing intervals before setting new ones', () => {
      plugin.syncIntervalId = 123;
      const clearIntervalSpy = jest.spyOn(window, 'clearInterval');
      
      plugin.setupPeriodicSync();
      
      expect(clearIntervalSpy).toHaveBeenCalledWith(123);
    });
  });
});