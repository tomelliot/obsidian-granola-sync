import { GranolaDoc } from "./granolaApi";
import {
  getTitleOrDefault,
  resolveFilenamePattern,
} from "../utils/filenameUtils";
import { getEffectiveUpdatedAt } from "../utils/dateUtils";
import { PathResolver } from "./pathResolver";
import {
  buildTitleYaml,
  formatAttendeesAsYaml,
  formatStringListAsYaml,
} from "../utils/yamlUtils";

export interface DocumentProcessorSettings {
  syncTranscripts: boolean;
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
  folders?: string[];
  webUrl?: string;
}

/**
 * Options for building note metadata
 */
export interface MetadataOptions {
  type: "note" | "combined" | "transcript";
  transcriptPath?: string;
  folders?: string[];
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
      updatedAt: getEffectiveUpdatedAt(doc),
      attendees,
      webUrl: doc.web_url,
    };

    // Add transcript link if provided (only for individual note files)
    if (this.settings.syncTranscripts && options.transcriptPath) {
      metadata.transcript = options.transcriptPath;
    }

    // Add folder paths if provided and non-empty
    if (options.folders && options.folders.length > 0) {
      metadata.folders = options.folders;
    }

    return metadata;
  }

  /**
   * Builds the body content for a note.
   *
   * The public API returns the AI summary as ready-made markdown, so the body
   * is `summary_markdown` verbatim, falling back to the plain `summary_text`.
   *
   * @param doc - The Granola document to process
   * @param _options - Kept for signature stability; the API's own markdown
   *   defines heading levels now.
   * @returns The markdown body, or null when the note has no summary content
   */
  buildNoteBody(doc: GranolaDoc, _options: BodyOptions): string | null {
    if (doc.summary_markdown?.trim()) {
      return doc.summary_markdown;
    }
    if (doc.summary_text?.trim()) {
      return doc.summary_text;
    }
    return null;
  }

  /**
   * Prepares a note document for saving, including frontmatter.
   *
   * The transcript link is not set here: for separate-file transcripts it is
   * written post-hoc by updateCrossLinks() using the actual on-disk path (which
   * may differ from the computed path after collision resolution).
   *
   * @param doc - The Granola document to process
   * @returns Object containing the filename and full markdown content
   */
  prepareNote(
    doc: GranolaDoc,
    folders?: string[]
  ): { filename: string; content: string } | null {
    // Build body first — if there's no summary content, bail out early
    const body = this.buildNoteBody(doc, { headingLevel: 2 });
    if (body === null) {
      return null;
    }

    // Build metadata using shared builder
    const metadata = this.buildNoteMetadata(doc, {
      type: "note",
      folders,
    });

    // Prepare frontmatter
    const frontmatterLines = [
      "---",
      `granola_id: ${metadata.granolaId}`,
      buildTitleYaml(metadata.title),
      `type: ${metadata.type}`,
    ];
    if (metadata.createdAt) frontmatterLines.push(`created: ${metadata.createdAt}`);
    if (metadata.updatedAt) frontmatterLines.push(`updated: ${metadata.updatedAt}`);
    frontmatterLines.push(`attendees: ${formatAttendeesAsYaml(metadata.attendees)}`);
    if (metadata.webUrl) frontmatterLines.push(`web_url: ${metadata.webUrl}`);

    // Add transcript link to frontmatter if provided
    if (metadata.transcript) {
      frontmatterLines.push(`transcript: "[[${metadata.transcript}]]"`);
    }

    // Add folder paths if present
    if (metadata.folders && metadata.folders.length > 0) {
      frontmatterLines.push(
        `folders: ${formatStringListAsYaml(metadata.folders)}`
      );
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
    transcriptContent: string,
    folders?: string[]
  ): { filename: string; content: string } | null {
    // Build body first — if there's no summary content, bail out early
    const body = this.buildNoteBody(doc, { headingLevel: 2 });
    if (body === null) {
      return null;
    }

    // Build metadata using shared builder
    const metadata = this.buildNoteMetadata(doc, { type: "combined", folders });

    // Prepare frontmatter with type: combined
    const frontmatterLines = [
      "---",
      `granola_id: ${metadata.granolaId}`,
      buildTitleYaml(metadata.title),
      `type: ${metadata.type}`,
    ];
    if (metadata.createdAt) frontmatterLines.push(`created: ${metadata.createdAt}`);
    if (metadata.updatedAt) frontmatterLines.push(`updated: ${metadata.updatedAt}`);
    frontmatterLines.push(`attendees: ${formatAttendeesAsYaml(metadata.attendees)}`);
    if (metadata.webUrl) frontmatterLines.push(`web_url: ${metadata.webUrl}`);

    // Note: Combined files do NOT include transcript or note link fields in frontmatter

    // Add folder paths if present
    if (metadata.folders && metadata.folders.length > 0) {
      frontmatterLines.push(
        `folders: ${formatStringListAsYaml(metadata.folders)}`
      );
    }

    frontmatterLines.push("---", "");

    let finalMarkdown = frontmatterLines.join("\n");

    finalMarkdown += "## Note\n\n";
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
    transcriptLink?: string,
    folders?: string[]
  ): {
    title: string;
    docId: string;
    type: string;
    createdAt?: string;
    updatedAt?: string;
    attendees: string[];
    transcript?: string;
    folders?: string[];
    markdown: string;
  } | null {
    // Build body first — if there's no summary content, bail out early
    const body = this.buildNoteBody(doc, { headingLevel: 3 });
    if (body === null) {
      return null;
    }

    // Build metadata using shared builder
    const metadata = this.buildNoteMetadata(doc, {
      type: "note",
      transcriptPath: transcriptLink,
      folders,
    });

    return {
      title: metadata.title,
      docId: metadata.granolaId,
      type: metadata.type,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      attendees: metadata.attendees,
      transcript: metadata.transcript,
      folders: metadata.folders,
      markdown: body,
    };
  }
}
