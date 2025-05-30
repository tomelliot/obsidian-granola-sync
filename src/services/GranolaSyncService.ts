import { App, Notice, normalizePath } from 'obsidian';
import {
  createDailyNote,
  getDailyNote,
  getAllDailyNotes,
} from 'obsidian-daily-notes-interface';
import moment from 'moment';
import { updateSection } from '../textUtils';
import { GranolaSyncSettings } from '../settings';
import { IGranolaApi, IMarkdownConverter } from '../interfaces';
import { GranolaDoc } from '../types';

export class GranolaSyncService {
  constructor(
    private readonly app: App,
    private readonly settings: GranolaSyncSettings,
    private readonly apiService: IGranolaApi,
    private readonly markdownConverter: IMarkdownConverter
  ) {}

  /**
   * Perform a full sync. Returns the number of notes synced.
   */
  async sync(): Promise<number> {
    new Notice('Granola Sync: Starting sync...', 5000);

    const accessToken = await this.loadAccessToken();
    if (!accessToken) return 0;

    const documents = await this.fetchDocuments(accessToken);
    if (!documents.length) return 0;

    if (!this.settings.granolaFolder && !this.settings.syncToDailyNotes) {
      new Notice('Granola Sync Error: Granola folder is not configured and not syncing to daily notes.', 10000);
      return 0;
    }

    const syncedCount = this.settings.syncToDailyNotes
      ? await this.syncToDailyNotes(documents)
      : await this.syncToFolder(documents);

    this.settings.latestSyncTime = Date.now();
    new Notice(`Granola Sync: Complete. ${syncedCount} notes synced.`, 7000);
    return syncedCount;
  }

  // ----------------- Helper Methods -----------------
  private async loadAccessToken(): Promise<string | null> {
    if (!this.settings.tokenPath) {
      new Notice('Granola Sync Error: Token path is not configured in settings.', 10000);
      return null;
    }

    if (
      this.settings.tokenPath.startsWith('/') ||
      this.settings.tokenPath.match(/^[A-Za-z]:\\/)
    ) {
      new Notice(
        'Granola Sync Warning: Token path appears to be an absolute path. ' +
          "Please ensure it's a path relative to your vault root, e.g., 'configs/supabase.json'. " +
          'Plugins typically cannot access arbitrary file system locations.',
        15000
      );
    }

    const { vault } = this.app;
    const adapter = vault.adapter;

    if (!(await adapter.exists(normalizePath(this.settings.tokenPath)))) {
      new Notice(
        `Granola Sync Error: Credentials file not found at '${this.settings.tokenPath}'. Please check the path in settings.`,
        10000
      );
      return null;
    }

    try {
      const tokenFileContent = await adapter.read(normalizePath(this.settings.tokenPath));
      const tokenData = JSON.parse(tokenFileContent);
      const cognitoTokens = JSON.parse(tokenData.cognito_tokens);
      const accessToken = cognitoTokens.access_token;
      if (!accessToken) {
        new Notice('Granola Sync Error: No access token found in credentials file. The token may have expired.', 10000);
        return null;
      }
      return accessToken;
    } catch (err) {
      new Notice('Granola Sync Error: Invalid JSON format in credentials file.', 10000);
      return null;
    }
  }

  private async fetchDocuments(accessToken: string): Promise<GranolaDoc[]> {
    try {
      return await this.apiService.getDocuments(accessToken);
    } catch (error: any) {
      new Notice('Granola Sync Error: Failed to fetch documents from Granola API.', 10000);
      return [];
    }
  }

  private async syncToFolder(documents: GranolaDoc[]): Promise<number> {
    const adapter = this.app.vault.adapter;
    const granolaFolderPath = normalizePath(this.settings.granolaFolder);

    if (!(await adapter.exists(granolaFolderPath))) {
      await this.app.vault.createFolder(granolaFolderPath);
    }

    let synced = 0;

    for (const doc of documents) {
      const title = doc.title || 'Untitled Granola Note';
      const docId = doc.id || 'unknown_id';
      const contentToParse = doc.last_viewed_panel?.content;
      if (!contentToParse || contentToParse.type !== 'doc') continue;

      const markdownContent = this.markdownConverter.convertProsemirrorToMarkdown(contentToParse);
      const escapedTitleForYaml = title.replace(/"/g, '\\"');
      const frontmatterLines = [
        '---',
        `granola_id: ${docId}`,
        `title: "${escapedTitleForYaml}"`,
      ];
      if (doc.created_at) frontmatterLines.push(`created_at: ${doc.created_at}`);
      if (doc.updated_at) frontmatterLines.push(`updated_at: ${doc.updated_at}`);
      frontmatterLines.push('---', '');

      const finalMarkdown = frontmatterLines.join('\n') + markdownContent;
      const filename = this.sanitizeFilename(title) + '.md';
      const filePath = normalizePath(`${granolaFolderPath}/${filename}`);

      await adapter.write(filePath, finalMarkdown);
      synced++;
    }

    return synced;
  }

  private async syncToDailyNotes(documents: GranolaDoc[]): Promise<number> {
    const dailyNotesMap: Map<
      string,
      { title: string; docId: string; createdAt?: string; updatedAt?: string; markdown: string }[]
    > = new Map();

    for (const doc of documents) {
      const title = doc.title || 'Untitled Granola Note';
      const docId = doc.id || 'unknown_id';
      const contentToParse = doc.last_viewed_panel?.content;
      if (!contentToParse || contentToParse.type !== 'doc') continue;

      const markdownContent = this.markdownConverter.convertProsemirrorToMarkdown(contentToParse);
      let noteDateSource: Date;
      if (doc.created_at) noteDateSource = new Date(doc.created_at);
      else if (doc.updated_at) noteDateSource = new Date(doc.updated_at);
      else noteDateSource = new Date();

      const noteMoment = moment(noteDateSource);
      const mapKey = noteMoment.format('YYYY-MM-DD');

      if (!dailyNotesMap.has(mapKey)) dailyNotesMap.set(mapKey, []);
      dailyNotesMap.get(mapKey)?.push({ title, docId, createdAt: doc.created_at, updatedAt: doc.updated_at, markdown: markdownContent });
    }

    const sectionHeading = this.settings.dailyNoteSectionHeading.trim();
    let synced = 0;

    for (const [dateKey, notesForDay] of dailyNotesMap) {
      const noteMoment = moment(dateKey, 'YYYY-MM-DD');
      let dailyNoteFile = getDailyNote(noteMoment, getAllDailyNotes());
      if (!dailyNoteFile) dailyNoteFile = await createDailyNote(noteMoment);

      let fullSectionContent = sectionHeading;
      for (const note of notesForDay) {
        fullSectionContent += `\n### ${note.title}\n`;
        fullSectionContent += `**Granola ID:** ${note.docId}\n`;
        if (note.createdAt) fullSectionContent += `**Created:** ${note.createdAt}\n`;
        if (note.updatedAt) fullSectionContent += `**Updated:** ${note.updatedAt}\n`;
        fullSectionContent += `\n${note.markdown}\n`;
      }

      const completeSectionText = fullSectionContent.trim() + '\n';
      await updateSection(this.app, dailyNoteFile, sectionHeading, completeSectionText);
      synced += notesForDay.length;
    }

    return synced;
  }

  // ----------------- Utility -----------------
  private sanitizeFilename(title: string): string {
    const invalidChars = /[<>:"/\\|?*]/g;
    let filename = title.replace(invalidChars, '');
    filename = filename.replace(/\s+/g, '_');
    const maxLength = 200;
    if (filename.length > maxLength) filename = filename.substring(0, maxLength);
    return filename;
  }
}