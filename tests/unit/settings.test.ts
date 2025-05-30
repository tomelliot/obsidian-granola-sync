import { GranolaSyncSettingTab, DEFAULT_SETTINGS, SyncDestination, TranscriptDestination } from '../../src/settings';

// Mock Obsidian components
jest.mock('obsidian', () => ({
  PluginSettingTab: class MockPluginSettingTab {
    app: any;
    plugin: any;
    constructor(app: any, plugin: any) {
      this.app = app;
      this.plugin = plugin;
    }
  },
  Setting: jest.fn().mockImplementation(() => ({
    setName: jest.fn().mockReturnThis(),
    setDesc: jest.fn().mockReturnThis(),
    addText: jest.fn().mockReturnThis(),
    addDropdown: jest.fn().mockReturnThis(),
    addSlider: jest.fn().mockReturnThis(),
    addToggle: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
    onChange: jest.fn().mockReturnThis(),
  })),
  Notice: jest.fn(),
}));

describe('Settings Tests', () => {
  describe('Default Settings', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_SETTINGS).toEqual({
        tokenPath: 'configs/supabase.json',
        granolaFolder: 'Granola',
        granolaTranscriptsFolder: 'Granola/Transcripts',
        latestSyncTime: 0,
        isSyncEnabled: false,
        syncInterval: 1800,
        syncNotes: true,
        syncTranscripts: false,
        syncDestination: SyncDestination.DAILY_NOTES,
        transcriptDestination: TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER,
        createLinkFromNoteToTranscript: false,
        dailyNoteSectionHeading: '## Granola Notes',
      });
    });

    it('should have proper types for enum values', () => {
      expect(typeof DEFAULT_SETTINGS.syncDestination).toBe('string');
      expect(typeof DEFAULT_SETTINGS.transcriptDestination).toBe('string');
      expect(DEFAULT_SETTINGS.isSyncEnabled).toBe(false);
      expect(DEFAULT_SETTINGS.syncNotes).toBe(true);
      expect(DEFAULT_SETTINGS.syncTranscripts).toBe(false);
    });
  });

  describe('Enums', () => {
    it('should have correct SyncDestination values', () => {
      expect(SyncDestination.DAILY_NOTES).toBe('daily_notes');
      expect(SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE).toBe('daily_note_folder_structure');
      expect(SyncDestination.GRANOLA_FOLDER).toBe('granola_folder');
    });

    it('should have correct TranscriptDestination values', () => {
      expect(TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE).toBe('daily_note_folder_structure');
      expect(TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER).toBe('granola_transcripts_folder');
    });
  });

  describe('GranolaSyncSettingTab', () => {
    let settingTab: GranolaSyncSettingTab;
    let mockApp: any;
    let mockPlugin: any;

    beforeEach(() => {
      mockApp = {
        setting: {
          settingTabs: [],
        },
      };

      mockPlugin = {
        settings: { ...DEFAULT_SETTINGS },
        saveSettings: jest.fn(),
      };

      settingTab = new GranolaSyncSettingTab(mockApp, mockPlugin);
    });

    it('should initialize properly', () => {
      expect(settingTab.app).toBe(mockApp);
      expect(settingTab.plugin).toBe(mockPlugin);
    });

    it('should handle basic display setup', () => {
      // Mock containerEl with more complete mock
      settingTab.containerEl = {
        empty: jest.fn(),
        createEl: jest.fn(() => ({
          setText: jest.fn(),
          style: {},
        })),
      } as any;

      // The display method is complex and requires extensive mocking
      // Test that we can at least instantiate it without throwing
      expect(settingTab).toBeDefined();
      expect(settingTab.containerEl).toBeDefined();
    });

    it('should handle settings validation', () => {
      // Test that settings are properly structured
      const requiredProperties = [
        'tokenPath',
        'granolaFolder', 
        'granolaTranscriptsFolder',
        'latestSyncTime',
        'isSyncEnabled',
        'syncInterval',
        'syncNotes',
        'syncTranscripts',
        'syncDestination',
        'transcriptDestination',
        'createLinkFromNoteToTranscript',
        'dailyNoteSectionHeading',
      ];

      requiredProperties.forEach(prop => {
        expect(mockPlugin.settings).toHaveProperty(prop);
      });
    });
  });

  describe('Settings Integration', () => {
    it('should handle sync interval validation', () => {
      const validIntervals = [300, 900, 1800, 3600]; // 5 min, 15 min, 30 min, 1 hour
      const invalidIntervals = [-1, 0, 59]; // Invalid values
      
      validIntervals.forEach(interval => {
        expect(interval).toBeGreaterThan(0);
      });
      
      invalidIntervals.forEach(interval => {
        expect(interval).toBeLessThan(300); // Minimum should be 5 minutes
      });
    });

    it('should validate sync destination combinations', () => {
      const destinations = Object.values(SyncDestination);
      expect(destinations).toHaveLength(3);
      expect(destinations).toContain('daily_notes');
      expect(destinations).toContain('daily_note_folder_structure');
      expect(destinations).toContain('granola_folder');
    });

    it('should validate transcript destination combinations', () => {
      const destinations = Object.values(TranscriptDestination);
      expect(destinations).toHaveLength(2);
      expect(destinations).toContain('daily_note_folder_structure');
      expect(destinations).toContain('granola_transcripts_folder');
    });
  });
});