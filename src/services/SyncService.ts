import { Notice } from 'obsidian';
import { GranolaDoc } from '../types';
import { IGranolaApi, IFileSystem, IMarkdownConverter } from '../interfaces';
import { GranolaSyncSettings, SyncDestination, TranscriptDestination } from '../settings';

export interface ISyncService {
  syncNotes(documents: GranolaDoc[]): Promise<number>;
  syncTranscripts(documents: GranolaDoc[]): Promise<number>;
}

export class SyncService implements ISyncService {
  constructor(
    protected apiService: IGranolaApi,
    protected fileSystem: IFileSystem,
    protected markdownConverter: IMarkdownConverter,
    protected settings: GranolaSyncSettings
  ) {}

  async syncNotes(documents: GranolaDoc[]): Promise<number> {
    if (!this.settings.syncNotes) {
      return 0;
    }

    let syncedCount = 0;

    if (this.settings.syncDestination === SyncDestination.DAILY_NOTES) {
      syncedCount = await this.syncNotesToDailyNotes(documents);
    } else {
      syncedCount = await this.syncNotesToIndividualFiles(documents);
    }

    return syncedCount;
  }

  async syncTranscripts(documents: GranolaDoc[]): Promise<number> {
    if (!this.settings.syncTranscripts) {
      return 0;
    }

    let syncedCount = 0;

    for (const doc of documents) {
      try {
        const transcriptContent = await this.fetchTranscriptForDocument(doc.id);
        if (transcriptContent) {
          const transcriptMd = this.formatTranscriptBySpeaker(transcriptContent, doc.title || 'Untitled');
          if (await this.saveTranscriptToDisk(doc, transcriptMd)) {
            syncedCount++;
          }
        }
      } catch (error) {
        new Notice(`Error syncing transcript for: ${doc.title}`, 7000);
        console.error(`Transcript sync error for doc ${doc.id}:`, error);
      }
    }

    return syncedCount;
  }

  protected async syncNotesToDailyNotes(documents: GranolaDoc[]): Promise<number> {
    // Group documents by date
    const dailyNotesMap = this.groupDocumentsByDate(documents);
    let syncedCount = 0;

    for (const [dateKey, notesForDay] of dailyNotesMap) {
      try {
        await this.updateDailyNoteWithNotes(dateKey, notesForDay);
        syncedCount += notesForDay.length;
      } catch (error) {
        new Notice(`Error updating daily note for ${dateKey}`, 7000);
        console.error(`Daily note update error for ${dateKey}:`, error);
      }
    }

    return syncedCount;
  }

  protected async syncNotesToIndividualFiles(documents: GranolaDoc[]): Promise<number> {
    let syncedCount = 0;

    for (const doc of documents) {
      try {
        const contentToParse = doc.last_viewed_panel?.content;
        if (!contentToParse || contentToParse.type !== 'doc') {
          continue;
        }

        const markdownContent = this.markdownConverter.convertProsemirrorToMarkdown(contentToParse);
        if (await this.saveNoteToDisk(doc, markdownContent)) {
          syncedCount++;
        }
      } catch (error) {
        new Notice(`Error syncing note: ${doc.title}`, 7000);
        console.error(`Note sync error for doc ${doc.id}:`, error);
      }
    }

    return syncedCount;
  }

  protected groupDocumentsByDate(documents: GranolaDoc[]): Map<string, Array<{
    title: string;
    docId: string;
    createdAt?: string;
    updatedAt?: string;
    markdown: string;
  }>> {
    const dailyNotesMap = new Map();

    for (const doc of documents) {
      const contentToParse = doc.last_viewed_panel?.content;
      if (!contentToParse || contentToParse.type !== 'doc') {
        continue;
      }

      const markdownContent = this.markdownConverter.convertProsemirrorToMarkdown(contentToParse);
      const noteDate = this.getDocumentDate(doc);
      const dateKey = this.formatDateKey(noteDate);

      if (!dailyNotesMap.has(dateKey)) {
        dailyNotesMap.set(dateKey, []);
      }

      dailyNotesMap.get(dateKey)?.push({
        title: doc.title || 'Untitled Granola Note',
        docId: doc.id || 'unknown_id',
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        markdown: markdownContent,
      });
    }

    return dailyNotesMap;
  }

  protected getDocumentDate(doc: GranolaDoc): Date {
    if (doc.created_at) return new Date(doc.created_at);
    if (doc.updated_at) return new Date(doc.updated_at);
    return new Date();
  }

  protected formatDateKey(date: Date): string {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  protected async updateDailyNoteWithNotes(dateKey: string, notesForDay: any[]): Promise<void> {
    // This method would need to be implemented with specific Obsidian daily notes logic
    // For now, it's a placeholder that would be implemented in the concrete service
    throw new Error('updateDailyNoteWithNotes must be implemented by concrete service');
  }

  protected async saveNoteToDisk(doc: GranolaDoc, markdownContent: string): Promise<boolean> {
    try {
      const filename = this.sanitizeFilename(doc.title || 'Untitled') + '.md';
      const noteDate = this.getDocumentDate(doc);
      const folderPath = this.computeNoteFolderPath(noteDate);
      
      const frontmatter = this.createNoteFrontmatter(doc);
      let finalMarkdown = frontmatter;
      
      if (this.shouldCreateTranscriptLink()) {
        const transcriptPath = this.computeTranscriptPath(doc.title || 'Untitled', noteDate);
        finalMarkdown += `[Transcript](${transcriptPath})\n\n`;
      }
      
      finalMarkdown += markdownContent;
      
      const filePath = `${folderPath}/${filename}`;
      await this.fileSystem.write(filePath, finalMarkdown);
      return true;
    } catch (error) {
      console.error('Error saving note to disk:', error);
      return false;
    }
  }

  protected async saveTranscriptToDisk(doc: GranolaDoc, transcriptContent: string): Promise<boolean> {
    try {
      const filename = this.sanitizeFilename(doc.title || 'Untitled') + '-transcript.md';
      const noteDate = this.getDocumentDate(doc);
      const folderPath = this.computeTranscriptFolderPath(noteDate);
      const filePath = `${folderPath}/${filename}`;
      
      await this.fileSystem.write(filePath, transcriptContent);
      return true;
    } catch (error) {
      console.error('Error saving transcript to disk:', error);
      return false;
    }
  }

  protected createNoteFrontmatter(doc: GranolaDoc): string {
    const title = doc.title || 'Untitled Granola Note';
    const escapedTitle = title.replace(/"/g, '\\"');
    
    const frontmatterLines = [
      '---',
      `granola_id: ${doc.id || 'unknown_id'}`,
      `title: "${escapedTitle}"`,
    ];
    
    if (doc.created_at) frontmatterLines.push(`created_at: ${doc.created_at}`);
    if (doc.updated_at) frontmatterLines.push(`updated_at: ${doc.updated_at}`);
    
    frontmatterLines.push('---', '');
    return frontmatterLines.join('\n');
  }

  protected shouldCreateTranscriptLink(): boolean {
    return this.settings.syncTranscripts && this.settings.createLinkFromNoteToTranscript;
  }

  protected computeNoteFolderPath(noteDate: Date): string {
    switch (this.settings.syncDestination) {
      case SyncDestination.DAILY_NOTE_FOLDER_STRUCTURE:
        return this.computeDailyNoteFolderPath(noteDate);
      case SyncDestination.GRANOLA_FOLDER:
        return this.settings.granolaFolder;
      default:
        return this.settings.granolaFolder;
    }
  }

  protected computeTranscriptFolderPath(noteDate: Date): string {
    switch (this.settings.transcriptDestination) {
      case TranscriptDestination.DAILY_NOTE_FOLDER_STRUCTURE:
        return this.computeDailyNoteFolderPath(noteDate);
      case TranscriptDestination.GRANOLA_TRANSCRIPTS_FOLDER:
        return this.settings.granolaTranscriptsFolder;
      default:
        return this.settings.granolaTranscriptsFolder;
    }
  }

  protected computeDailyNoteFolderPath(noteDate: Date): string {
    // This would need to integrate with Obsidian's daily notes settings
    // For now, return a basic date-based path
    const year = noteDate.getFullYear();
    const month = String(noteDate.getMonth() + 1).padStart(2, '0');
    return `Daily Notes/${year}/${month}`;
  }

  protected computeTranscriptPath(title: string, noteDate: Date): string {
    const filename = this.sanitizeFilename(title) + '-transcript.md';
    const folderPath = this.computeTranscriptFolderPath(noteDate);
    return `${folderPath}/${filename}`;
  }

  protected sanitizeFilename(title: string): string {
    const invalidChars = /[<>:"/\\|?*]/g;
    let filename = title.replace(invalidChars, '');
    filename = filename.replace(/\s+/g, '_');
    
    const maxLength = 200;
    if (filename.length > maxLength) {
      filename = filename.substring(0, maxLength);
    }
    
    return filename;
  }

  protected async fetchTranscriptForDocument(documentId: string): Promise<any[]> {
    // This would be implemented by calling the API service
    // For now, it's a placeholder
    throw new Error('fetchTranscriptForDocument must be implemented');
  }

  protected formatTranscriptBySpeaker(transcriptData: any[], title: string): string {
    let transcriptMd = `# Transcript for: ${title}\n\n`;
    let currentSpeaker: string | null = null;
    let currentStart: string | null = null;
    let currentText: string[] = [];

    const getSpeaker = (source: string) => 
      source === 'microphone' ? 'Tom Elliot' : 'Guest';

    for (const entry of transcriptData) {
      const speaker = getSpeaker(entry.source);

      if (currentSpeaker === null) {
        currentSpeaker = speaker;
        currentStart = entry.start_timestamp;
        currentText = [entry.text];
      } else if (speaker === currentSpeaker) {
        currentText.push(entry.text);
      } else {
        // Write previous block
        transcriptMd += `## ${currentSpeaker} (${currentStart})\n\n`;
        transcriptMd += currentText.join(' ') + '\n\n';
        
        // Start new block
        currentSpeaker = speaker;
        currentStart = entry.start_timestamp;
        currentText = [entry.text];
      }
    }

    // Write last block
    if (currentSpeaker !== null) {
      transcriptMd += `## ${currentSpeaker} (${currentStart})\n\n`;
      transcriptMd += currentText.join(' ') + '\n\n';
    }

    return transcriptMd;
  }
}