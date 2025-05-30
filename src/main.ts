import { App, Editor, MarkdownView, Modal, Notice, Plugin, requestUrl, normalizePath } from 'obsidian';
import {
	createDailyNote,
	getDailyNote,
	getAllDailyNotes,
} from "obsidian-daily-notes-interface";
import { updateSection } from "./textUtils";
import { GranolaSyncSettings, DEFAULT_SETTINGS, GranolaSyncSettingTab } from './settings';
import moment from 'moment';
import { MarkdownConverterService } from './services/MarkdownConverterService';
import { ProseMirrorDoc } from './types';

// Helper interfaces for ProseMirror and API responses
interface GranolaDoc {
	id: string;
	title: string;
	created_at?: string;
	updated_at?: string;
	last_viewed_panel?: {
		content?: ProseMirrorDoc;
	};
}

interface GranolaApiResponse {
	docs: GranolaDoc[];
}

export default class GranolaSync extends Plugin {
	settings: GranolaSyncSettings;
	syncIntervalId: number | null = null;
	private readonly markdownConverter = new MarkdownConverterService();

	async onload() {
		await this.loadSettings();

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Granola Sync Idle'); // Updated status bar text

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'sync-granola-notes',
			name: 'Sync Notes from Granola', // Updated command name
			callback: async () => {
				new Notice('Granola Sync: Starting manual sync...');
				statusBarItemEl.setText('Granola Sync: Syncing...');
				await this.syncGranolaNotes();
				statusBarItemEl.setText(`Granola Sync: Last synced ${new Date(this.settings.latestSyncTime).toLocaleString()}`);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GranolaSyncSettingTab(this.app, this));

		// Setup periodic sync based on settings
		this.setupPeriodicSync();

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// Example: this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
		// We handle our interval manually with setupPeriodicSync and clearPeriodicSync
	}

	onunload() {
		this.clearPeriodicSync();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Re-evaluate periodic sync when settings change (e.g., interval or enabled status)
		this.setupPeriodicSync();
	}

	setupPeriodicSync() {
		this.clearPeriodicSync(); // Clear any existing interval first
		if (this.settings.isSyncEnabled && this.settings.syncInterval > 0) {
			this.syncIntervalId = window.setInterval(async () => {
				const statusBarItemEl = this.app.workspace.containerEl.querySelector('.status-bar-item .status-bar-item-segment');
				if (statusBarItemEl) statusBarItemEl.setText('Granola Sync: Auto-syncing...');
				await this.syncGranolaNotes();
				if (statusBarItemEl) statusBarItemEl.setText(`Granola Sync: Last synced ${new Date(this.settings.latestSyncTime).toLocaleString()}`);
			}, this.settings.syncInterval * 1000);
			this.registerInterval(this.syncIntervalId); // Register with Obsidian to auto-clear on disable
		}
	}

	clearPeriodicSync() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
	}

	// Helper to escape strings for use in regex
	private escapeRegExp(string: string): string {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
	}

	private sanitizeFilename(title: string): string {
		const invalidChars = /[<>:"/\\|?*]/g;
		let filename = title.replace(invalidChars, '');
		filename = filename.replace(/\s+/g, '_'); // Replace one or more spaces with a single underscore
		// Truncate filename if too long (e.g., 200 chars, common limit)
		const maxLength = 200;
		if (filename.length > maxLength) {
			filename = filename.substring(0, maxLength);
		}
		return filename;
	}

	async syncGranolaNotes() {
		new Notice("Granola Sync: Starting sync...", 5000);

		// 1. Load Credentials
		let accessToken: string | null = null;
		try {
			if (!this.settings.tokenPath) {
				new Notice("Granola Sync Error: Token path is not configured in settings.", 10000);
				return;
			}
			
			// Check if the token path is an absolute path (likely problematic)
			if (this.settings.tokenPath.startsWith('/') || this.settings.tokenPath.match(/^[A-Za-z]:\\/)) {
				new Notice(
					"Granola Sync Warning: Token path appears to be an absolute path. " +
					"Please ensure it's a path relative to your vault root, e.g., 'configs/supabase.json'. " +
					"Plugins typically cannot access arbitrary file system locations.", 15000);
			}
			
			if (!await this.app.vault.adapter.exists(normalizePath(this.settings.tokenPath))) {
				new Notice(`Granola Sync Error: Credentials file not found at '${this.settings.tokenPath}'. Please check the path in settings.`, 10000);
				return;
			}

			const tokenFileContent = await this.app.vault.adapter.read(normalizePath(this.settings.tokenPath));
			try {
				const tokenData = JSON.parse(tokenFileContent);
				const cognitoTokens = JSON.parse(tokenData.cognito_tokens); // Assuming cognito_tokens is a stringified JSON
				accessToken = cognitoTokens.access_token;

				if (!accessToken) {
					new Notice("Granola Sync Error: No access token found in credentials file. The token may have expired.", 10000);
					return;
				}
			} catch (parseError) {
				new Notice("Granola Sync Error: Invalid JSON format in credentials file. Please ensure the file is properly formatted.", 10000);
				console.error("Token file parse error:", parseError);
				return;
			}

		} catch (error) {
			new Notice("Granola Sync Error: Failed to load credentials. Please check if the file exists and is accessible.", 10000);
			console.error("Credentials loading error:", error);
			return;
		}

		// 2. Fetch Documents
		let documents: GranolaDoc[] = [];
		try {
			const response = await requestUrl({
				url: "https://api.granola.ai/v2/get-documents",
				method: "POST",
				headers: {
					"Authorization": `Bearer ${accessToken}`,
					"Content-Type": "application/json",
					"Accept": "*/*",
					"User-Agent": "GranolaObsidianPlugin/0.1.7",
					"X-Client-Version": "ObsidianPlugin-0.1.7"
				},
				body: JSON.stringify({
					"limit": 100,
					"offset": 0,
					"include_last_viewed_panel": true
				}),
				throw: true
			});

			const apiResponse = response.json as GranolaApiResponse;
			if (!apiResponse || !apiResponse.docs) {
				new Notice("Granola Sync Error: Invalid API response format. Please try again later.", 10000);
				return;
			}
			documents = apiResponse.docs;

		} catch (error: any) {
			if (error.status === 401) {
				new Notice("Granola Sync Error: Authentication failed. Your access token may have expired. Please update your credentials file.", 10000);
			} else if (error.status === 403) {
				new Notice("Granola Sync Error: Access forbidden. Please check your permissions.", 10000);
			} else if (error.status === 404) {
				new Notice("Granola Sync Error: API endpoint not found. Please check for updates.", 10000);
			} else if (error.status >= 500) {
				new Notice("Granola Sync Error: Granola API server error. Please try again later.", 10000);
			} else {
				new Notice("Granola Sync Error: Failed to fetch documents from Granola API. Please check your internet connection.", 10000);
			}
			console.error("API request error:", error);
			return;
		}

		// 3. Process and Save Documents
		if (!this.settings.granolaFolder && !this.settings.syncToDailyNotes) { // Adjusted condition
			new Notice("Granola Sync Error: Granola folder is not configured and not syncing to daily notes.", 10000);
			return;
		}
		
		const granolaFolderPath = normalizePath(this.settings.granolaFolder);

		if (!this.settings.syncToDailyNotes) { // Create folder only if not syncing to daily notes
			try {
				if (!await this.app.vault.adapter.exists(granolaFolderPath)) {
					await this.app.vault.createFolder(granolaFolderPath);
				}
			} catch (error) {
				new Notice(`Granola Sync Error: Could not create folder '${granolaFolderPath}'. Check console.`, 10000);
				return;
			}
		}

		let syncedCount = 0;

		if (this.settings.syncToDailyNotes) {
			const dailyNotesMap: Map<string, { title: string; docId: string; createdAt?: string; updatedAt?: string; markdown: string }[]> = new Map();

			for (const doc of documents) {
				const title = doc.title || "Untitled Granola Note";
				const docId = doc.id || "unknown_id";
				const contentToParse = doc.last_viewed_panel?.content;

				if (!contentToParse || contentToParse.type !== "doc") {
					continue;
				}
				const markdownContent = this.markdownConverter.convertProsemirrorToMarkdown(contentToParse);

				let noteDateSource: Date;
				if (doc.created_at) noteDateSource = new Date(doc.created_at);
				else if (doc.updated_at) noteDateSource = new Date(doc.updated_at);
				else noteDateSource = new Date();
				
				const noteMoment = moment(noteDateSource);
				const mapKey = noteMoment.format("YYYY-MM-DD"); // Use date string as key

				if (!dailyNotesMap.has(mapKey)) {
					dailyNotesMap.set(mapKey, []);
				}
				dailyNotesMap.get(mapKey)?.push({
					title,
					docId,
					createdAt: doc.created_at,
					updatedAt: doc.updated_at,
					markdown: markdownContent
				});
			}

			const sectionHeadingSetting = this.settings.dailyNoteSectionHeading.trim(); // Trim the setting value

			for (const [dateKey, notesForDay] of dailyNotesMap) {
				const noteMoment = moment(dateKey, "YYYY-MM-DD");
				let dailyNoteFile = getDailyNote(noteMoment, getAllDailyNotes());

				if (!dailyNoteFile) {
					dailyNoteFile = await createDailyNote(noteMoment);
				}

				let fullSectionContent = sectionHeadingSetting; // Use trimmed version here
				if (notesForDay.length > 0) { // Only add note content if there are notes
					for (const note of notesForDay) {
						// Each note block starts with a newline, ensuring separation from heading or previous note
						fullSectionContent += `\n### ${note.title}\n`;
						fullSectionContent += `**Granola ID:** ${note.docId}\n`;
						if (note.createdAt) fullSectionContent += `**Created:** ${note.createdAt}\n`;
						if (note.updatedAt) fullSectionContent += `**Updated:** ${note.updatedAt}\n`;
						fullSectionContent += `\n${note.markdown}\n`;
					}
				} else {
					// If there are no notes for the day, the section will just be the heading.
				}

				// Prepare the final content for the section, ensuring it ends with a single newline.
				const completeSectionText = fullSectionContent.trim() + "\n";

				// Use updateSection from textUtils.ts
				try {
					await updateSection(this.app, dailyNoteFile, sectionHeadingSetting, completeSectionText);
				} catch (error) {
					new Notice(`Error updating section in ${dailyNoteFile.path}. Check console.`, 7000);
				}
				
				syncedCount += notesForDay.length;
			}

		} else {
			// Original logic for syncing to individual files
			for (const doc of documents) {
				const title = doc.title || "Untitled Granola Note";
				const docId = doc.id || "unknown_id";

				const contentToParse = doc.last_viewed_panel?.content;
				if (!contentToParse || contentToParse.type !== "doc") {
					continue;
				}

				try {
					const markdownContent = this.markdownConverter.convertProsemirrorToMarkdown(contentToParse);
					const escapedTitleForYaml = title.replace(/"/g, '\\"');

					const frontmatterLines = [
						"---",
						`granola_id: ${docId}`,
						`title: "${escapedTitleForYaml}"`
					];
					if (doc.created_at) frontmatterLines.push(`created_at: ${doc.created_at}`);
					if (doc.updated_at) frontmatterLines.push(`updated_at: ${doc.updated_at}`);
					frontmatterLines.push("---", "");

					const finalMarkdown = frontmatterLines.join('\n') + markdownContent;
					const filename = this.sanitizeFilename(title) + ".md";
					const filePath = normalizePath(`${granolaFolderPath}/${filename}`);

					await this.app.vault.adapter.write(filePath, finalMarkdown);
					syncedCount++;
				} catch (e) {
					new Notice(`Error processing document: ${title}. Check console.`, 7000);
				}
			}
		}

		this.settings.latestSyncTime = Date.now();
		await this.saveSettings(); // Save settings to persist latestSyncTime

		new Notice(`Granola Sync: Complete. ${syncedCount} notes synced to '${granolaFolderPath}'.`, 7000);
		
		const statusBarItemEl = this.app.workspace.containerEl.querySelector('.status-bar-item .status-bar-item-segment');
		if (statusBarItemEl) statusBarItemEl.setText(`Granola Sync: Last synced ${new Date(this.settings.latestSyncTime).toLocaleString()}`);
	}
}

