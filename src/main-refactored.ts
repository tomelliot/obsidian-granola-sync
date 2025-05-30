import { Notice, Plugin } from "obsidian";
import { GranolaSyncSettings, DEFAULT_SETTINGS, GranolaSyncSettingTab } from "./settings";
import { GranolaApiService } from "./services/GranolaApiService";
import { MarkdownConverterService } from "./services/MarkdownConverterService";
import { ObsidianFileSystemService } from "./services/ObsidianFileSystemService";
import { CredentialService, ICredentialService } from "./services/CredentialService";
import { ObsidianSyncService } from "./services/ObsidianSyncService";
import { ISyncService } from "./services/SyncService";

/**
 * GranolaSync Plugin - Refactored for better maintainability
 * 
 * This refactored version separates concerns into dedicated services:
 * - CredentialService: Handles authentication and token management
 * - SyncService: Manages the core sync logic for notes and transcripts
 * - FileSystemService: Abstracts file operations
 * - ApiService: Handles API communications
 * - MarkdownConverter: Converts ProseMirror to Markdown
 */
export default class GranolaSync extends Plugin {
  settings: GranolaSyncSettings;
  private credentialService: ICredentialService;
  private syncService: ISyncService;
  private syncIntervalId: number | null = null;
  private statusBarElement: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    this.initializeServices();
    this.setupUI();
    this.setupCommands();
    this.setupPeriodicSync();
  }

  onunload() {
    this.clearPeriodicSync();
  }

  /**
   * Initialize all the services with proper dependency injection
   */
  private initializeServices() {
    // File system service
    const fileSystemService = new ObsidianFileSystemService(this.app);
    
    // Credential service
    this.credentialService = new CredentialService(fileSystemService);
    
    // API service
    const apiService = new GranolaApiService();
    
    // Markdown converter service
    const markdownConverter = new MarkdownConverterService();
    
    // Sync service with all dependencies
    this.syncService = new ObsidianSyncService(
      apiService,
      fileSystemService,
      markdownConverter,
      this.settings,
      this.app,
      this.credentialService
    );
  }

  /**
   * Setup UI elements like status bar
   */
  private setupUI() {
    this.statusBarElement = this.addStatusBarItem();
    this.updateStatusBar("Granola Sync Idle");
    
    // Add settings tab
    this.addSettingTab(new GranolaSyncSettingTab(this.app, this));
  }

  /**
   * Setup plugin commands
   */
  private setupCommands() {
    this.addCommand({
      id: "sync-granola",
      name: "Sync from Granola",
      callback: async () => {
        await this.performManualSync();
      },
    });
  }

  /**
   * Perform a manual sync operation
   */
  private async performManualSync() {
    try {
      new Notice("Granola Sync: Starting manual sync.");
      this.updateStatusBar("Granola Sync: Syncing...");

      await this.performSync();
      
      new Notice("Granola Sync: Manual sync complete.");
      this.updateStatusBar(`Granola Sync: Last synced ${new Date(this.settings.latestSyncTime).toLocaleString()}`);
      
    } catch (error) {
      new Notice("Granola Sync: Manual sync failed. Check console for details.", 10000);
      console.error("Manual sync error:", error);
      this.updateStatusBar("Granola Sync: Sync failed");
    }
  }

  /**
   * Core sync logic that orchestrates the sync process
   */
  private async performSync(): Promise<void> {
    // Load credentials
    const credentialResult = await this.credentialService.loadCredentials(this.settings.tokenPath);
    if (credentialResult.error) {
      new Notice(`Granola Sync Error: ${credentialResult.error}`, 10000);
      return;
    }

    if (!credentialResult.accessToken) {
      new Notice("Granola Sync Error: No access token available.", 10000);
      return;
    }

    // Fetch documents from API
    const apiService = new GranolaApiService();
    let documents;
    try {
      documents = await apiService.getDocuments(credentialResult.accessToken);
    } catch (error) {
      this.handleApiError(error);
      return;
    }

    if (!documents || documents.length === 0) {
      new Notice("Granola Sync: No documents found.", 5000);
      return;
    }

    // Perform sync operations
    let totalSynced = 0;

    if (this.settings.syncTranscripts) {
      try {
        const transcriptsSynced = await this.syncService.syncTranscripts(documents);
        totalSynced += transcriptsSynced;
      } catch (error) {
        new Notice("Error syncing transcripts. Check console for details.", 7000);
        console.error("Transcript sync error:", error);
      }
    }

    if (this.settings.syncNotes) {
      try {
        const notesSynced = await this.syncService.syncNotes(documents);
        totalSynced += notesSynced;
      } catch (error) {
        new Notice("Error syncing notes. Check console for details.", 7000);
        console.error("Notes sync error:", error);
      }
    }

    // Check if no sync options are enabled
    if (!this.settings.syncNotes && !this.settings.syncTranscripts) {
      new Notice("Granola Sync: No sync options enabled. Please enable notes or transcripts in settings.", 7000);
      return;
    }

    // Update sync time
    this.settings.latestSyncTime = Date.now();
    await this.saveSettings();

    new Notice(`Granola Sync: Synced ${totalSynced} items successfully.`, 5000);
  }

  /**
   * Handle API errors with appropriate user feedback
   */
  private handleApiError(error: any) {
    if (error.status === 401) {
      new Notice("Granola Sync Error: Authentication failed. Your access token may have expired.", 10000);
    } else if (error.status === 403) {
      new Notice("Granola Sync Error: Access forbidden. Please check your permissions.", 10000);
    } else if (error.status === 404) {
      new Notice("Granola Sync Error: API endpoint not found. Please check for updates.", 10000);
    } else if (error.status >= 500) {
      new Notice("Granola Sync Error: Server error. Please try again later.", 10000);
    } else {
      new Notice("Granola Sync Error: Failed to fetch documents. Please check your connection.", 10000);
    }
    console.error("API request error:", error);
  }

  /**
   * Setup periodic sync based on settings
   */
  setupPeriodicSync() {
    this.clearPeriodicSync();
    
    if (this.settings.isSyncEnabled && this.settings.syncInterval > 0) {
      this.syncIntervalId = window.setInterval(async () => {
        this.updateStatusBar("Granola Sync: Auto-syncing...");
        
        try {
          await this.performSync();
          this.updateStatusBar(`Granola Sync: Last synced ${new Date(this.settings.latestSyncTime).toLocaleString()}`);
        } catch (error) {
          console.error("Auto-sync error:", error);
          this.updateStatusBar("Granola Sync: Auto-sync failed");
        }
      }, this.settings.syncInterval * 1000);
      
      this.registerInterval(this.syncIntervalId);
    }
  }

  /**
   * Clear the periodic sync interval
   */
  private clearPeriodicSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  /**
   * Update the status bar text
   */
  private updateStatusBar(text: string) {
    if (this.statusBarElement) {
      this.statusBarElement.setText(text);
    }
  }

  /**
   * Load plugin settings
   */
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /**
   * Save plugin settings and refresh services
   */
  async saveSettings() {
    await this.saveData(this.settings);
    
    // Reinitialize services with new settings
    if (this.syncService) {
      this.initializeServices();
    }
    
    // Re-evaluate periodic sync when settings change
    this.setupPeriodicSync();
  }
}