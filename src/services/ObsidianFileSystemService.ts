import { App, normalizePath, Notice } from 'obsidian';
import { IFileSystem } from '../interfaces';

export class ObsidianFileSystemService implements IFileSystem {
  constructor(private app: App) {}

  async exists(path: string): Promise<boolean> {
    try {
      return await this.app.vault.adapter.exists(normalizePath(path));
    } catch (error) {
      console.error(`Error checking if path exists: ${path}`, error);
      return false;
    }
  }

  async read(path: string): Promise<string> {
    try {
      return await this.app.vault.adapter.read(normalizePath(path));
    } catch (error) {
      console.error(`Error reading file: ${path}`, error);
      throw new Error(`Failed to read file: ${path}`);
    }
  }

  async write(path: string, content: string): Promise<void> {
    try {
      const normalizedPath = normalizePath(path);
      
      // Ensure the directory exists first
      await this.ensureDirectoryExists(normalizedPath);
      
      await this.app.vault.adapter.write(normalizedPath, content);
    } catch (error) {
      console.error(`Error writing file: ${path}`, error);
      throw new Error(`Failed to write file: ${path}`);
    }
  }

  async createFolder(path: string): Promise<void> {
    try {
      const normalizedPath = normalizePath(path);
      if (!(await this.exists(normalizedPath))) {
        await this.app.vault.createFolder(normalizedPath);
      }
    } catch (error) {
      console.error(`Error creating folder: ${path}`, error);
      throw new Error(`Failed to create folder: ${path}`);
    }
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const pathParts = filePath.split('/');
    if (pathParts.length <= 1) {
      return; // No directory to create for files in root
    }

    // Remove the filename (last part) to get the directory path
    const directoryPath = pathParts.slice(0, -1).join('/');
    
    if (directoryPath && !(await this.exists(directoryPath))) {
      await this.createFolder(directoryPath);
    }
  }

  /**
   * Creates nested folders recursively
   */
  async createNestedFolders(path: string): Promise<boolean> {
    try {
      const pathParts = normalizePath(path).split('/').filter(part => part.length > 0);
      let currentPath = '';

      for (const part of pathParts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        if (!(await this.exists(currentPath))) {
          await this.createFolder(currentPath);
        }
      }
      
      return true;
    } catch (error) {
      new Notice(`Error creating folders for path: ${path}`, 7000);
      console.error('Nested folder creation error:', error);
      return false;
    }
  }

  /**
   * Gets the directory path from a full file path
   */
  getDirectoryPath(filePath: string): string {
    const pathParts = filePath.split('/');
    return pathParts.slice(0, -1).join('/');
  }

  /**
   * Gets the filename from a full file path
   */
  getFileName(filePath: string): string {
    const pathParts = filePath.split('/');
    return pathParts[pathParts.length - 1];
  }

  /**
   * Checks if a path represents a file (has an extension)
   */
  isFile(path: string): boolean {
    const fileName = this.getFileName(path);
    return fileName.includes('.');
  }

  /**
   * Normalizes a path using Obsidian's path normalization
   */
  normalizePath(path: string): string {
    return normalizePath(path);
  }
}