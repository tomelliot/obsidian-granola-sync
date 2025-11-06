import { GranolaDoc } from "./granolaApi";
import { convertProsemirrorToMarkdown } from "./prosemirrorMarkdown";
import { sanitizeFilename } from "../utils/filenameUtils";
import { getNoteDate } from "../utils/dateUtils";
import { PathResolver } from "./pathResolver";
import { TranscriptSettings, FrontmatterSettings } from "../settings";

/**
 * Service for processing Granola documents into Obsidian-ready markdown.
 * Handles frontmatter generation, transcript linking, and content formatting.
 */
export class DocumentProcessor {
  constructor(
    private settings: Pick<
      TranscriptSettings,
      "syncTranscripts" | "createLinkFromNoteToTranscript"
    > & Pick<FrontmatterSettings, "includeAttendees" | "attendeesFieldName">,
    private pathResolver: PathResolver
  ) {}

  /**
   * Prepares a note document for saving, including frontmatter and optional transcript links.
   *
   * @param doc - The Granola document to process
   * @returns Object containing the filename and full markdown content
   */
  prepareNote(doc: GranolaDoc): { filename: string; content: string } {
    const contentToParse = doc.last_viewed_panel?.content;
    if (
      !contentToParse ||
      typeof contentToParse === "string" ||
      contentToParse.type !== "doc"
    ) {
      throw new Error("Document has no valid content to parse");
    }

    const title = doc.title || "Untitled Granola Note";
    const docId = doc.id || "unknown_id";
    const markdownContent = convertProsemirrorToMarkdown(contentToParse);

    // Prepare frontmatter
    const escapedTitleForYaml = title.replace(/"/g, '\\"');
    const frontmatterLines = [
      "---",
      `granola_id: ${docId}`,
      `title: "${escapedTitleForYaml}"`,
      `type: note`,
    ];
    if (doc.created_at) frontmatterLines.push(`created_at: ${doc.created_at}`);
    if (doc.updated_at) frontmatterLines.push(`updated_at: ${doc.updated_at}`);
    if (
      this.settings.includeAttendees &&
      doc.attendees &&
      doc.attendees.length > 0
    ) {
      // Format attendees as YAML array using the configured field name
      const attendeesYaml = doc.attendees.map(name => `  - ${name}`).join("\n");
      const fieldName = this.settings.attendeesFieldName || "Attendees";
      frontmatterLines.push(`${fieldName}:\n${attendeesYaml}`);
    }
    frontmatterLines.push("---", "");

    let finalMarkdown = frontmatterLines.join("\n");

    // Add transcript link if enabled
    if (
      this.settings.syncTranscripts &&
      this.settings.createLinkFromNoteToTranscript
    ) {
      const noteDate = getNoteDate(doc);
      const transcriptPath = this.pathResolver.computeTranscriptPath(
        title,
        noteDate
      );
      finalMarkdown += `[Transcript](${transcriptPath})\n\n`;
    }

    // Add the actual note content
    finalMarkdown += markdownContent;

    const filename = sanitizeFilename(title) + ".md";

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
    const title = doc.title || "Untitled Granola Note";
    const filename = sanitizeFilename(title) + "-transcript.md";

    return { filename, content: transcriptContent };
  }

  /**
   * Extracts note information for daily note sections.
   *
   * @param doc - The Granola document
   * @returns Note data for daily note section building
   */
  extractNoteForDailyNote(doc: GranolaDoc): {
    title: string;
    docId: string;
    createdAt?: string;
    updatedAt?: string;
    markdown: string;
  } | null {
    const contentToParse = doc.last_viewed_panel?.content;
    if (
      !contentToParse ||
      typeof contentToParse === "string" ||
      contentToParse.type !== "doc"
    ) {
      return null;
    }

    const title = doc.title || "Untitled Granola Note";
    const docId = doc.id || "unknown_id";
    const markdownContent = convertProsemirrorToMarkdown(contentToParse);

    return {
      title,
      docId,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      markdown: markdownContent,
    };
  }
}
