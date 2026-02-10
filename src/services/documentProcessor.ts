import { GranolaDoc } from "./granolaApi";
import { convertProsemirrorToMarkdown } from "./prosemirrorMarkdown";
import {
  getTitleOrDefault,
  resolveFilenamePattern,
} from "../utils/filenameUtils";
import { PathResolver } from "./pathResolver";
import { formatAttendeesAsYaml } from "../utils/yamlUtils";

export interface DocumentProcessorSettings {
  syncTranscripts: boolean;
  includePrivateNotes: boolean;
}

/**
 * Metadata for a note document
 */
export interface NoteMetadata {
  granolaId: string;
  title: string;
  type: "note" | "combined" | "transcript";
  createdAt?: string;
  updatedAt?: string;
  attendees: string[];
  transcript?: string;
}

/**
 * Options for building note metadata
 */
export interface MetadataOptions {
  type: "note" | "combined" | "transcript";
  transcriptPath?: string;
}

/**
 * Options for building note body
 */
export interface BodyOptions {
  headingLevel: number;
}

/**
 * Service for processing Granola documents into Obsidian-ready markdown.
 * Handles frontmatter generation, transcript linking, and content formatting.
 */
export class DocumentProcessor {
  constructor(
    private settings: DocumentProcessorSettings,
    private pathResolver: PathResolver
  ) {}

  /**
   * Builds metadata for a note document.
   *
   * @param doc - The Granola document to process
   * @param options - Metadata options including type and transcript path
   * @returns Structured metadata object
   */
  buildNoteMetadata(doc: GranolaDoc, options: MetadataOptions): NoteMetadata {
    const title = getTitleOrDefault(doc);
    const granolaId = doc.id || "unknown_id";
    const attendees =
      doc.people?.attendees
        ?.map((attendee) => attendee.name || attendee.email || "Unknown")
        .filter((name) => name !== "Unknown") || [];

    const metadata: NoteMetadata = {
      granolaId,
      title,
      type: options.type,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      attendees,
    };

    // Add transcript link if provided (only for individual note files)
    if (this.settings.syncTranscripts && options.transcriptPath) {
      metadata.transcript = options.transcriptPath;
    }

    return metadata;
  }

  /**
   * Builds the body content for a note with appropriate heading levels.
   *
   * @param doc - The Granola document to process
   * @param options - Body options including heading level
   * @returns The formatted markdown body
   */
  buildNoteBody(doc: GranolaDoc, options: BodyOptions): string {
    const contentToParse = doc.last_viewed_panel?.content;
    if (
      !contentToParse ||
      typeof contentToParse === "string" ||
      contentToParse.type !== "doc"
    ) {
      throw new Error("Document has no valid content to parse");
    }

    const markdownContent = convertProsemirrorToMarkdown(contentToParse);
    const headingPrefix = "#".repeat(options.headingLevel);

    // Add private notes section if enabled and content exists
    const hasPrivateNotes =
      this.settings.includePrivateNotes &&
      doc.notes_markdown &&
      doc.notes_markdown.trim() !== "";

    let body = "";
    if (hasPrivateNotes) {
      body += `${headingPrefix} Private Notes\n\n`;
      body += doc.notes_markdown;
      body += "\n\n";
      // Add enhanced notes section heading when private notes are present
      body += `${headingPrefix} Enhanced Notes\n\n`;
    }

    body += markdownContent;

    return body;
  }

  /**
   * Prepares a note document for saving, including frontmatter and optional transcript links.
   *
   * @param doc - The Granola document to process
   * @param transcriptPath - Optional resolved transcript path (with collision detection) to include in frontmatter
   * @returns Object containing the filename and full markdown content
   */
  prepareNote(
    doc: GranolaDoc,
    transcriptPath?: string
  ): { filename: string; content: string } {
    // Build metadata using shared builder
    const metadata = this.buildNoteMetadata(doc, {
      type: "note",
      transcriptPath,
    });

    // Build body using shared builder
    const body = this.buildNoteBody(doc, { headingLevel: 2 });

    // Prepare frontmatter
    const escapedTitleForYaml = metadata.title.replace(/"/g, '\\"');
    const frontmatterLines = [
      "---",
      `granola_id: ${metadata.granolaId}`,
      `title: "${escapedTitleForYaml}"`,
      `type: ${metadata.type}`,
    ];
    if (metadata.createdAt) frontmatterLines.push(`created: ${metadata.createdAt}`);
    if (metadata.updatedAt) frontmatterLines.push(`updated: ${metadata.updatedAt}`);
    frontmatterLines.push(`attendees: ${formatAttendeesAsYaml(metadata.attendees)}`);

    // Add transcript link to frontmatter if provided
    if (metadata.transcript) {
      frontmatterLines.push(`transcript: "[[${metadata.transcript}]]"`);
    }

    frontmatterLines.push("---", "");

    const finalMarkdown = frontmatterLines.join("\n") + body;

    const filenamePattern = this.pathResolver.getNoteFilenamePattern();
    const filename = resolveFilenamePattern(doc, filenamePattern);

    return { filename, content: finalMarkdown };
  }

  /**
   * Prepares a transcript document for saving.
   *
   * @param doc - The Granola document
   * @param transcriptContent - The formatted transcript content
   * @returns Object containing the filename and content
   */
  prepareTranscript(
    doc: GranolaDoc,
    transcriptContent: string
  ): { filename: string; content: string } {
    const filenamePattern =
      this.pathResolver.computeTranscriptFilenamePattern();
    const filename = resolveFilenamePattern(doc, filenamePattern);

    return { filename, content: transcriptContent };
  }

  /**
   * Prepares a combined note and transcript document for saving.
   * Combines note content and transcript content in a single file with separate headings.
   *
   * @param doc - The Granola document to process
   * @param transcriptContent - The formatted transcript body content (without frontmatter)
   * @returns Object containing the filename and full markdown content
   */
  prepareCombinedNote(
    doc: GranolaDoc,
    transcriptContent: string
  ): { filename: string; content: string } {
    // Build metadata using shared builder
    const metadata = this.buildNoteMetadata(doc, { type: "combined" });

    // Build body using shared builder
    const body = this.buildNoteBody(doc, { headingLevel: 2 });

    // Prepare frontmatter with type: combined
    const escapedTitleForYaml = metadata.title.replace(/"/g, '\\"');
    const frontmatterLines = [
      "---",
      `granola_id: ${metadata.granolaId}`,
      `title: "${escapedTitleForYaml}"`,
      `type: ${metadata.type}`,
    ];
    if (metadata.createdAt) frontmatterLines.push(`created: ${metadata.createdAt}`);
    if (metadata.updatedAt) frontmatterLines.push(`updated: ${metadata.updatedAt}`);
    frontmatterLines.push(`attendees: ${formatAttendeesAsYaml(metadata.attendees)}`);

    // Note: Combined files do NOT include transcript or note link fields in frontmatter
    frontmatterLines.push("---", "");

    let finalMarkdown = frontmatterLines.join("\n");

    // Check if private notes were added
    const hasPrivateNotes =
      this.settings.includePrivateNotes &&
      doc.notes_markdown &&
      doc.notes_markdown.trim() !== "";

    if (!hasPrivateNotes) {
      // When no private notes, use the original "## Note" heading for combined notes
      finalMarkdown += "## Note\n\n";
    }

    finalMarkdown += body;
    finalMarkdown += "\n\n";

    // Add transcript content at the end with heading
    finalMarkdown += "## Transcript\n\n";
    finalMarkdown += transcriptContent;

    const filenamePattern = this.pathResolver.getNoteFilenamePattern();
    const filename = resolveFilenamePattern(doc, filenamePattern);

    return { filename, content: finalMarkdown };
  }

  /**
   * Extracts note information for daily note sections.
   *
   * @param doc - The Granola document
   * @param transcriptLink - Optional transcript link (e.g., "[[#Transcript]]" for daily note sections)
   * @returns Note data for daily note section building with full metadata
   */
  extractNoteForDailyNote(
    doc: GranolaDoc,
    transcriptLink?: string
  ): {
    title: string;
    docId: string;
    type: string;
    createdAt?: string;
    updatedAt?: string;
    attendees: string[];
    transcript?: string;
    markdown: string;
  } | null {
    try {
      // Build metadata using shared builder
      const metadata = this.buildNoteMetadata(doc, {
        type: "note",
        transcriptPath: transcriptLink,
      });

      // Build body using shared builder with heading level 3
      // (one level deeper than the note title heading added by buildDailyNoteSectionContent)
      const body = this.buildNoteBody(doc, { headingLevel: 3 });

      return {
        title: metadata.title,
        docId: metadata.granolaId,
        type: metadata.type,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        attendees: metadata.attendees,
        transcript: metadata.transcript,
        markdown: body,
      };
    } catch {
      // If buildNoteBody throws an error (no valid content), return null
      return null;
    }
  }
}
