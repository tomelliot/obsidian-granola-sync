import GranolaSync from '../../src/main';
import { GranolaApiService } from '../../src/services/GranolaApiService';
import { FileSystemService } from '../../src/services/FileSystemService';
import { MarkdownConverterService } from '../../src/services/MarkdownConverterService';
import { GranolaDoc } from '../../src/types';

jest.mock('../../src/services/GranolaApiService');
jest.mock('../../src/services/FileSystemService');
jest.mock('../../src/services/MarkdownConverterService');

// Mock the serve functions to prevent actual server operations during tests
jest.mock('../../src/serve', () => ({
  startGranolaCredentialsServer: jest.fn(),
  stopGranolaCredentialsServer: jest.fn(() => Promise.resolve()),
}));

// Mock obsidian-daily-notes-interface
jest.mock('obsidian-daily-notes-interface', () => ({
  createDailyNote: jest.fn(),
  getDailyNote: jest.fn(),
  getAllDailyNotes: jest.fn(() => ({})),
  getDailyNoteSettings: jest.fn(() => ({ format: 'YYYY-MM-DD', folder: '' })),
}));

// Mock textUtils
jest.mock('../../src/textUtils', () => ({
  updateSection: jest.fn(),
}));

// Mock moment
jest.mock('moment', () => {
  const moment = () => ({
    format: jest.fn(() => '2024-01-01'),
  });
  return moment;
});

// Mock settings
jest.mock('../../src/settings', () => ({
  DEFAULT_SETTINGS: {
    tokenPath: 'test/token.json',
    granolaFolder: 'Granola',
    latestSyncTime: 0,
    isSyncEnabled: true,
    syncInterval: 1800,
    syncToDailyNotes: false,
    dailyNoteSectionHeading: '## Granola Notes',
    syncNotes: true,
    syncTranscripts: false,
    syncDestination: 'GRANOLA_FOLDER',
    transcriptDestination: 'GRANOLA_TRANSCRIPTS_FOLDER',
    granolaTranscriptsFolder: 'Granola Transcripts',
    createLinkFromNoteToTranscript: false,
  },
  GranolaSyncSettingTab: jest.fn(),
  SyncDestination: {
    GRANOLA_FOLDER: 'GRANOLA_FOLDER',
    DAILY_NOTE_FOLDER_STRUCTURE: 'DAILY_NOTE_FOLDER_STRUCTURE',
    DAILY_NOTES: 'DAILY_NOTES',
  },
  TranscriptDestination: {
    GRANOLA_TRANSCRIPTS_FOLDER: 'GRANOLA_TRANSCRIPTS_FOLDER',
    DAILY_NOTE_FOLDER_STRUCTURE: 'DAILY_NOTE_FOLDER_STRUCTURE',
  },
}));

// Mock requestUrl to prevent actual HTTP requests
jest.mock('obsidian', () => ({
  requestUrl: jest.fn(() => Promise.reject(new Error('No server in tests'))),
  Plugin: class MockPlugin {
    constructor(public app: any, public manifest: any) {}
    loadData = jest.fn().mockResolvedValue({});
    saveData = jest.fn().mockResolvedValue(undefined);
    registerInterval = jest.fn();
    addCommand = jest.fn();
    addStatusBarItem = jest.fn(() => ({ setText: jest.fn() }));
    addSettingTab = jest.fn();
  },
  Setting: jest.fn(),
  PluginSettingTab: jest.fn(),
  Notice: jest.fn(),
  normalizePath: jest.fn((path: string) => path),
  moment: jest.fn(),
  getDailyNoteSettings: jest.fn(() => ({ format: 'YYYY-MM-DD', folder: '' })),
}));

describe('GranolaSync', () => {
  let plugin: GranolaSync;
  let mockApp: any;
  let mockApiService: jest.Mocked<GranolaApiService>;
  let mockFileSystem: jest.Mocked<FileSystemService>;
  let mockMarkdownConverter: jest.Mocked<MarkdownConverterService>;

  beforeEach(() => {
    mockApp = {
      vault: {
        adapter: {
          exists: jest.fn(),
          read: jest.fn(),
          write: jest.fn()
        },
        createFolder: jest.fn()
      },
      workspace: {
        containerEl: document.createElement('div')
      }
    };

    mockApiService = new GranolaApiService() as jest.Mocked<GranolaApiService>;
    mockFileSystem = new FileSystemService(mockApp.vault) as jest.Mocked<FileSystemService>;
    mockMarkdownConverter = new MarkdownConverterService() as jest.Mocked<MarkdownConverterService>;

    // Create a mock manifest
    const mockManifest = {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      minAppVersion: '0.15.0',
      author: 'Test Author',
      description: 'Test Description'
    };

    plugin = new GranolaSync(mockApp, mockManifest);
    
    // Mock the Plugin class methods
    plugin.loadData = jest.fn().mockResolvedValue({});
    plugin.saveData = jest.fn().mockResolvedValue(undefined);
    plugin.registerInterval = jest.fn();

    plugin.settings = {
      tokenPath: 'test/token.json',
      granolaFolder: 'Granola',
      latestSyncTime: 0,
      isSyncEnabled: true,
      syncInterval: 1800,
      syncToDailyNotes: false,
      dailyNoteSectionHeading: '## Granola Notes'
    };

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should load settings on startup', async () => {
    const mockSettings = { test: 'settings' };
    (plugin.loadData as jest.Mock).mockResolvedValueOnce(mockSettings);

    await plugin.loadSettings();

    expect(plugin.settings).toEqual(expect.objectContaining(mockSettings));
  });

  it('should save settings', async () => {
    await plugin.saveSettings();

    expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
  });

  it('should setup periodic sync when enabled', () => {
    plugin.settings.isSyncEnabled = true;
    plugin.settings.syncInterval = 1800;

    plugin.setupPeriodicSync();

    expect(plugin.syncIntervalId).not.toBeNull();
    expect(plugin.registerInterval).toHaveBeenCalled();
  });

  it('should not setup periodic sync when disabled', () => {
    plugin.settings.isSyncEnabled = false;

    plugin.setupPeriodicSync();

    expect(plugin.syncIntervalId).toBeNull();
    expect(plugin.registerInterval).not.toHaveBeenCalled();
  });

  it('should clear periodic sync', () => {
    plugin.syncIntervalId = 123;
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval');

    plugin.clearPeriodicSync();

    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
    expect(plugin.syncIntervalId).toBeNull();
  });

  it('should sanitize filenames', () => {
    const invalidFilename = 'test/file:name*with?invalid<chars>';
    const result = plugin['sanitizeFilename'](invalidFilename);

    expect(result).toBe('testfilenamewithinvalidchars');
  });

  it('should escape regex strings', () => {
    const specialChars = '.*+?^${}()|[]\\';
    const result = plugin['escapeRegExp'](specialChars);

    expect(result).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });
}); 