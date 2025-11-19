import { GranolaDoc } from "./granolaApi";
import { convertProsemirrorToMarkdown } from "./prosemirrorMarkdown";
import { sanitizeFilename, getTitleOrDefault } from "../utils/filenameUtils";
import { getNoteDate } from "../utils/dateUtils";
import { PathResolver } from "./pathResolver";
import {
  TranscriptSettings,
  NoteSettings,
  TranscriptLinkLocation,
} from "../settings";

/**
 * Service for processing Granola documents into Obsidian-ready markdown.
 * Handles frontmatter generation, transcript linking, and content formatting.
 */
export class DocumentProcessor {
  constructor(
    private settings: Pick<
      TranscriptSettings & NoteSettings,
      "syncTranscripts" | "transcriptLinkLocation" | "createNoteHeading"
    >,
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

    const title = getTitleOrDefault(doc);
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
    const attendees =
      doc.people?.attendees
        ?.map((attendee) => attendee.name || attendee.email || "Unknown")
        .filter((name) => name !== "Unknown") || [];
    if (attendees.length > 0) {
      const attendeesYaml = attendees.map((name) => `  - ${name}`).join("\n");
      frontmatterLines.push(`attendees:\n${attendeesYaml}`);
    } else {
      frontmatterLines.push(`attendees: []`);
    }

    // Add transcript link in YAML if enabled and set to properties
    if (
      this.settings.syncTranscripts &&
      this.settings.transcriptLinkLocation ===
        TranscriptLinkLocation.LINK_AT_PROPERTIES
    ) {
      const transcriptFilename = sanitizeFilename(title) + "-transcript";
      frontmatterLines.push(`transcript: "[[${transcriptFilename}]]"`);
    }

    frontmatterLines.push("---", "");

    let finalMarkdown = frontmatterLines.join("\n");

    if (this.settings.createNoteHeading) {
      finalMarkdown += `# ${title}\n\n`;
    }

    // Add transcript link at top if enabled and set to top
    if (
      this.settings.syncTranscripts &&
      this.settings.transcriptLinkLocation === TranscriptLinkLocation.LINK_AT_TOP
    ) {
      const noteDate = getNoteDate(doc);
      const transcriptPath = this.pathResolver.computeTranscriptPath(
        title,
        noteDate
      );

      finalMarkdown += `[Transcript](<${transcriptPath}>)\n\n`;
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
    const title = getTitleOrDefault(doc);
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

    const title = getTitleOrDefault(doc);
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
