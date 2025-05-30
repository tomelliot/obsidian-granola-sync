import { App, Notice, requestUrl } from 'obsidian';
import {
  createDailyNote,
  getDailyNote,
  getAllDailyNotes,
  getDailyNoteSettings,
} from 'obsidian-daily-notes-interface';
import moment from 'moment';
import { SyncService } from './SyncService';
import { ICredentialService } from './CredentialService';
import { IGranolaApi, IFileSystem, IMarkdownConverter } from '../interfaces';
import { GranolaSyncSettings, SyncDestination, TranscriptDestination } from '../settings';
import { updateSection } from '../textUtils';
import { GranolaDoc } from '../types';

export class ObsidianSyncService extends SyncService {
  constructor(
    apiService: IGranolaApi,
    fileSystem: IFileSystem,
    markdownConverter: IMarkdownConverter,
    settings: GranolaSyncSettings,
    private app: App,
    private credentialService: ICredentialService
  ) {
    super(apiService, fileSystem, markdownConverter, settings);
  }

  protected async updateDailyNoteWithNotes(dateKey: string, notesForDay: any[]): Promise<void> {
    const noteMoment = moment(dateKey, 'YYYY-MM-DD');
    let dailyNoteFile = getDailyNote(noteMoment as any, getAllDailyNotes());

    if (!dailyNoteFile) {
      dailyNoteFile = await createDailyNote(noteMoment as any);
    }

    const sectionHeading = this.settings.dailyNoteSectionHeading.trim();
    let fullSectionContent = sectionHeading;

    if (notesForDay.length > 0) {
      for (const note of notesForDay) {
        fullSectionContent += `\n### ${note.title}\n`;
        fullSectionContent += `**Granola ID:** ${note.docId}\n`;
        
        if (note.createdAt) {
          fullSectionContent += `**Created:** ${note.createdAt}\n`;
        }
        if (note.updatedAt) {
          fullSectionContent += `**Updated:** ${note.updatedAt}\n`;
        }

        // Add transcript link if enabled
        if (this.shouldCreateTranscriptLink()) {
          const noteDate = note.createdAt ? new Date(note.createdAt) : 
                          note.updatedAt ? new Date(note.updatedAt) : 
                          new Date(dateKey);
          
          const transcriptPath = this.computeTranscriptPath(note.title, noteDate);
          fullSectionContent += `**Transcript:** [[${transcriptPath}]]\n`;
        }

        fullSectionContent += `\n${note.markdown}\n`;
      }
    }

    const completeSectionText = fullSectionContent.trim() + '\n';

    try {
      await updateSection(this.app, dailyNoteFile, sectionHeading, completeSectionText);
    } catch (error) {
      new Notice(`Error updating section in ${dailyNoteFile.path}`, 7000);
      throw error;
    }
  }

  protected computeDailyNoteFolderPath(noteDate: Date): string {
    const dailyNoteSettings = getDailyNoteSettings();
    const noteMoment = moment(noteDate);

    // Format the date according to the daily note format
    const formattedPath = noteMoment.format(dailyNoteSettings.format || 'YYYY-MM-DD');

    // Extract just the folder part (everything except the filename)
    const pathParts = formattedPath.split('/');
    const folderParts = pathParts.slice(0, -1);

    // Combine with the base daily notes folder
    const baseFolder = dailyNoteSettings.folder || '';
    if (folderParts.length > 0) {
      return this.fileSystem.normalizePath(`${baseFolder}/${folderParts.join('/')}`);
    } else {
      return this.fileSystem.normalizePath(baseFolder);
    }
  }

  protected async fetchTranscriptForDocument(documentId: string): Promise<any[]> {
    const accessToken = this.credentialService.getAccessToken();
    if (!accessToken) {
      throw new Error('No access token available');
    }

    const response = await requestUrl({
      url: 'https://api.granola.ai/v1/get-document-transcript',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'User-Agent': 'GranolaObsidianPlugin/0.1.7',
        'X-Client-Version': 'ObsidianPlugin-0.1.7',
      },
      body: JSON.stringify({ document_id: documentId }),
      throw: true,
    });

    const transcriptData = response.json as Array<{
      document_id: string;
      start_timestamp: string;
      text: string;
      source: string;
      id: string;
      is_final: boolean;
      end_timestamp: string;
    }>;

    if (!Array.isArray(transcriptData) || transcriptData.length === 0) {
      return [];
    }

    return transcriptData;
  }

  private shouldCreateTranscriptLink(): boolean {
    return this.settings.syncTranscripts && this.settings.createLinkFromNoteToTranscript;
  }

  private computeTranscriptPath(title: string, noteDate: Date): string {
    const filename = this.sanitizeFilename(title) + '-transcript.md';
    const folderPath = this.computeTranscriptFolderPath(noteDate);
    return `${folderPath}/${filename}`;
  }

  private computeTranscriptFolderPath(noteDate: Date): string {
    switch (this.settings.transcriptDestination) {
      case TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE:
        return this.computeDailyNoteFolderPath(noteDate);
      case TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER:
        return this.settings.granolaTranscriptsFolder;
      default:
        return this.settings.granolaTranscriptsFolder;
    }
  }

  private sanitizeFilename(title: string): string {
    const invalidChars = /[<>:"/\\|?*]/g;
    let filename = title.replace(invalidChars, '');
    filename = filename.replace(/\s+/g, '_');
    
    const maxLength = 200;
    if (filename.length > maxLength) {
      filename = filename.substring(0, maxLength);
    }
    
    return filename;
  }
}