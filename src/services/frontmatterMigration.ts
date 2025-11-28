import { App, TFile } from "obsidian";
import { log } from "../utils/logger";

/**
 * Service for migrating legacy frontmatter formats to the new standard.
 *
 * This migration handles:
 * - Removing `-transcript` suffix from granola_id in transcript files
 * - Adding `type` field to all files (note/transcript)
 * - Adding timestamps to transcript files when possible
 *
 * @deprecated This migration function will be removed in version 2.0.0,
 * breaking backward compatibility with pre-migration frontmatter formats.
 * All users should run this migration before upgrading to 2.0.0.
 */
export class FrontmatterMigrationService {
  constructor(private app: App) {}

  /**
   * Migrates legacy frontmatter format to new standard.
   * Runs silently in the background on plugin load.
   *
   * Updates:
   * - Removes `-transcript` suffix from granola_id in transcript files
   * - Adds `type` field to all files (note/transcript)
   * - Adds missing timestamps to transcript files (if available)
   */
  async migrateLegacyFrontmatter(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      try {
        await this.migrateFile(file);
      } catch (error) {
        // Silently fail for individual files to avoid disrupting the plugin load
        log.error(`Error migrating frontmatter for ${file.path}:`, error);
      }
    }
  }

  /**
   * Migrates a single file's frontmatter if needed.
   */
  private async migrateFile(file: TFile): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);

    // Skip files without frontmatter or granola_id
    if (!cache?.frontmatter?.granola_id) {
      return;
    }

    const frontmatter = cache.frontmatter;
    const granolaId = frontmatter.granola_id as string;

    // Determine if this file needs migration
    const hasTranscriptSuffix = granolaId.endsWith("-transcript");
    const missingTypeField = !frontmatter.type;

    if (!hasTranscriptSuffix && !missingTypeField) {
      // File is already in new format
      return;
    }

    // Read the file content
    const content = await this.app.vault.read(file);

    // Parse and update frontmatter
    const updatedContent = this.updateFrontmatter(
      content,
      granolaId,
      hasTranscriptSuffix,
      missingTypeField
    );

    // Only write if content changed
    if (updatedContent !== content) {
      await this.app.vault.modify(file, updatedContent);
    }
  }

  /**
   * Updates the frontmatter in a file's content.
   */
  private updateFrontmatter(
    content: string,
    granolaId: string,
    hasTranscriptSuffix: boolean,
    missingTypeField: boolean
  ): string {
    // Extract frontmatter section
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatterMatch) {
      return content;
    }

    const frontmatterContent = frontmatterMatch[1];
    let updatedFrontmatter = frontmatterContent;

    // Update granola_id if it has -transcript suffix
    if (hasTranscriptSuffix) {
      const cleanId = granolaId.replace(/-transcript$/, "");
      updatedFrontmatter = updatedFrontmatter.replace(
        /granola_id: .*-transcript/,
        `granola_id: ${cleanId}`
      );
    }

    // Add type field if missing
    if (missingTypeField) {
      const type =
        hasTranscriptSuffix || content.includes("# Transcript for:")
          ? "transcript"
          : "note";

      // Insert type field after title (or after granola_id if no title)
      const lines = updatedFrontmatter.split("\n");
      let insertIndex = -1;

      // Find where to insert the type field
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("title:")) {
          insertIndex = i + 1;
          break;
        } else if (lines[i].startsWith("granola_id:") && insertIndex === -1) {
          insertIndex = i + 1;
        }
      }

      if (insertIndex !== -1) {
        lines.splice(insertIndex, 0, `type: ${type}`);
        updatedFrontmatter = lines.join("\n");
      } else {
        // Fallback: append at the end
        updatedFrontmatter += `\ntype: ${type}`;
      }
    }

    // Replace the frontmatter in the original content
    return content.replace(
      /^---\n[\s\S]*?\n---\n/,
      `---\n${updatedFrontmatter}\n---\n`
    );
  }
}
