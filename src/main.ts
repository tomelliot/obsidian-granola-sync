import { App, Notice, Plugin } from 'obsidian';
import { GranolaSyncSettings, DEFAULT_SETTINGS, GranolaSyncSettingTab } from './settings';
import { MarkdownConverterService } from './services/MarkdownConverterService';
import { GranolaApiService } from './services/GranolaApiService';
import { GranolaSyncService } from './services/GranolaSyncService';
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
		const apiService = new GranolaApiService();
		const syncService = new GranolaSyncService(this.app, this.settings, apiService, this.markdownConverter);
		await syncService.sync();
		await this.saveSettings();
	}
}

