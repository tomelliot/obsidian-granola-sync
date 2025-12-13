import { GranolaDoc } from "./granolaApi";
import { convertProsemirrorToMarkdown } from "./prosemirrorMarkdown";
import { sanitizeFilename, getTitleOrDefault } from "../utils/filenameUtils";
import { escapeYamlString } from "../utils/yamlUtils";
import { PathResolver } from "./pathResolver";
import { TranscriptSettings } from "../settings";

/**
 * Service for processing Granola documents into Obsidian-ready markdown.
 * Handles frontmatter generation, transcript linking, and content formatting.
 */
export class DocumentProcessor {
  constructor(
    private settings: Pick<TranscriptSettings, "syncTranscripts">,
    private pathResolver: PathResolver
  ) {}

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
    if (doc.created_at) frontmatterLines.push(`created: ${doc.created_at}`);
    if (doc.updated_at) frontmatterLines.push(`updated: ${doc.updated_at}`);
    const attendees =
      doc.people?.attendees
        ?.map((attendee) => attendee.name || attendee.email || "Unknown")
        .filter((name) => name !== "Unknown") || [];
    if (attendees.length > 0) {
      const attendeesYaml = attendees.map((name) => `  - ${escapeYamlString(name)}`).join("\n");
      frontmatterLines.push(`attendees:\n${attendeesYaml}`);
    } else {
      frontmatterLines.push(`attendees: []`);
    }

    // Add transcript link to frontmatter if path provided
    // Path is only provided for individual note files (not for DAILY_NOTES destination)
    if (this.settings.syncTranscripts && transcriptPath) {
      // Use wiki-style links in frontmatter
      frontmatterLines.push(`transcript: "[[${transcriptPath}]]"`);
    }

    frontmatterLines.push("---", "");

    let finalMarkdown = frontmatterLines.join("\n");

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

    // Prepare frontmatter with type: combined
    const escapedTitleForYaml = title.replace(/"/g, '\\"');
    const frontmatterLines = [
      "---",
      `granola_id: ${docId}`,
      `title: "${escapedTitleForYaml}"`,
      `type: combined`,
    ];
    if (doc.created_at) frontmatterLines.push(`created: ${doc.created_at}`);
    if (doc.updated_at) frontmatterLines.push(`updated: ${doc.updated_at}`);
    const attendees =
      doc.people?.attendees
        ?.map((attendee) => attendee.name || attendee.email || "Unknown")
        .filter((name) => name !== "Unknown") || [];
    if (attendees.length > 0) {
      const attendeesYaml = attendees.map((name) => `  - ${escapeYamlString(name)}`).join("\n");
      frontmatterLines.push(`attendees:\n${attendeesYaml}`);
    } else {
      frontmatterLines.push(`attendees: []`);
    }

    // Note: Combined files do NOT include transcript or note link fields in frontmatter
    frontmatterLines.push("---", "");

    let finalMarkdown = frontmatterLines.join("\n");

    // Add note content with heading
    finalMarkdown += "## Note\n\n";
    finalMarkdown += markdownContent;
    finalMarkdown += "\n\n";

    // Add transcript content at the end with heading
    finalMarkdown += "## Transcript\n\n";
    finalMarkdown += transcriptContent;

    const filename = sanitizeFilename(title) + ".md";

    return { filename, content: finalMarkdown };
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
