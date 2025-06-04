/* @ts-nocheck */
import { GranolaSyncService } from '../../src/services/GranolaSyncService';
import { GranolaDoc } from '../../src/types';
import { GranolaSyncSettings } from '../../src/settings';
import { IGranolaApi } from '../../src/interfaces';
import { IMarkdownConverter } from '../../src/interfaces';

// Mock external helpers
jest.mock('../../src/textUtils', () => ({
  updateSection: jest.fn()
}));

jest.mock('obsidian-daily-notes-interface', () => ({
  getDailyNote: jest.fn().mockReturnValue(null),
  createDailyNote: jest.fn().mockResolvedValue({ path: 'daily.md' }),
  getAllDailyNotes: jest.fn().mockReturnValue({})
}));

describe('GranolaSyncService', () => {
  let mockApp: any;
  let mockSettings: GranolaSyncSettings;
  let mockApi: jest.Mocked<IGranolaApi>;
  let mockConverter: jest.Mocked<IMarkdownConverter>;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    mockApp = {
      vault: {
        adapter: {
          exists: jest.fn().mockResolvedValue(true),
          read: jest.fn().mockResolvedValue('{"cognito_tokens":"{\\"access_token\\":\\"abc\\"}"}'),
          write: jest.fn()
        },
        createFolder: jest.fn()
      },
      workspace: {
        containerEl: document.createElement('div')
      }
    };

    mockSettings = {
      tokenPath: 'configs/supabase.json',
      granolaFolder: 'Granola',
      latestSyncTime: 0,
      isSyncEnabled: false,
      syncInterval: 1800,
      syncToDailyNotes: false,
      dailyNoteSectionHeading: '## Granola Notes'
    } as GranolaSyncSettings;

    mockApi = {
      getDocuments: jest.fn()
    } as unknown as jest.Mocked<IGranolaApi>;

    mockConverter = {
      convertProsemirrorToMarkdown: jest.fn().mockReturnValue('ConvertedMD')
    } as unknown as jest.Mocked<IMarkdownConverter>;
  });

  it('should convert each document and write to vault when syncing to folder', async () => {
    const docs: GranolaDoc[] = [
      {
        id: '1',
        title: 'Meeting Notes',
        last_viewed_panel: {
          content: { type: 'doc', content: [] }
        }
      }
    ];

    mockApi.getDocuments.mockResolvedValueOnce(docs);

    const service = new GranolaSyncService(mockApp, mockSettings, mockApi, mockConverter);
    await service.sync();

    expect(mockConverter.convertProsemirrorToMarkdown).toHaveBeenCalledTimes(docs.length);
    expect(mockApp.vault.adapter.write).toHaveBeenCalledTimes(docs.length);
  });

  it('should use updateSection when syncing to daily notes', async () => {
    const { updateSection } = require('../../src/textUtils');
    mockSettings.syncToDailyNotes = true;

    const docs: GranolaDoc[] = [
      {
        id: '2',
        title: 'Daily Doc',
        created_at: '2024-05-30T00:00:00Z',
        last_viewed_panel: {
          content: { type: 'doc', content: [] }
        }
      }
    ];
    mockApi.getDocuments.mockResolvedValueOnce(docs);

    const service = new GranolaSyncService(mockApp, mockSettings, mockApi, mockConverter);
    await service.sync();

    expect(updateSection).toHaveBeenCalled();
  });
});