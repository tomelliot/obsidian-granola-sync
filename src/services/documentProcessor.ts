import { GranolaDoc, TranscriptEntry } from "./granolaApi";
import { sanitizeFilename } from "../utils/filenameUtils";
import { getNoteDate } from "../utils/dateUtils";

/**
 * Service for processing Granola documents and transcripts into markdown format.
 */
export class DocumentProcessor {
  /**
   * Processes a Granola note document into markdown format with frontmatter.
   *
   * @param doc - The Granola document to process
   * @param markdownContent - The converted markdown content from ProseMirror
   * @param includeTranscriptLink - Whether to include a link to the transcript
   * @param computeTranscriptPath - Function to compute transcript path
   * @returns An object containing the filename and final markdown content
   */
  processNote(
    doc: GranolaDoc,
    markdownContent: string,
    includeTranscriptLink: boolean = false,
    computeTranscriptPath?: (title: string, noteDate: Date) => string
  ): { filename: string; content: string; noteDate: Date } {
    const title = doc.title || "Untitled Granola Note";
    const docId = doc.id || "unknown_id";

    // Prepare frontmatter
    const escapedTitleForYaml = title.replace(/"/g, '\\"');
    const frontmatterLines = [
      "---",
      `granola_id: ${docId}`,
      `title: "${escapedTitleForYaml}"`,
    ];
    if (doc.created_at) frontmatterLines.push(`created_at: ${doc.created_at}`);
    if (doc.updated_at) frontmatterLines.push(`updated_at: ${doc.updated_at}`);
    frontmatterLines.push("---", "");

    let finalMarkdown = frontmatterLines.join("\n");

    // Add transcript link if enabled
    if (includeTranscriptLink && computeTranscriptPath) {
      const noteDate = getNoteDate(doc);
      const transcriptPath = computeTranscriptPath(title, noteDate);
      finalMarkdown += `[Transcript](${transcriptPath})\n\n`;
    }

    // Add the actual note content
    finalMarkdown += markdownContent;

    const filename = sanitizeFilename(title) + ".md";
    const noteDate = getNoteDate(doc);

    return { filename, content: finalMarkdown, noteDate };
  }

  /**
   * Processes a transcript for a Granola document.
   *
   * @param doc - The Granola document
   * @param transcriptContent - The formatted transcript content
   * @returns An object containing the filename, content, and note date
   */
  processTranscript(
    doc: GranolaDoc,
    transcriptContent: string
  ): { filename: string; content: string; noteDate: Date; transcriptId: string } {
    const title = doc.title || "Untitled Granola Note";
    const docId = doc.id || "unknown_id";
    const filename = sanitizeFilename(title) + "-transcript.md";
    const noteDate = getNoteDate(doc);
    const transcriptId = `${docId}-transcript`;

    return { filename, content: transcriptContent, noteDate, transcriptId };
  }

  /**
   * Formats transcript data by grouping consecutive entries from the same speaker.
   *
   * @param transcriptData - Array of transcript entries
   * @param title - The title of the document
   * @param granolaId - The Granola document ID
   * @returns Formatted markdown string
   */
  formatTranscript(
    transcriptData: TranscriptEntry[],
    title: string,
    granolaId: string
  ): string {
    // Add frontmatter with granola_id for transcript deduplication
    const escapedTitleForYaml = title.replace(/"/g, '\\"');
    let transcriptMd = `---\ngranola_id: ${granolaId}-transcript\ntitle: "${escapedTitleForYaml} - Transcript"\n---\n\n`;

    transcriptMd += `# Transcript for: ${title}\n\n`;
    let currentSpeaker: string | null = null;
    let currentStart: string | null = null;
    let currentText: string[] = [];
    const getSpeaker = (source: string) =>
      source === "microphone" ? "You" : "Guest";

    for (let i = 0; i < transcriptData.length; i++) {
      const entry = transcriptData[i];
      const speaker = getSpeaker(entry.source);

      if (currentSpeaker === null) {
        currentSpeaker = speaker;
        currentStart = entry.start_timestamp;
        currentText = [entry.text];
      } else if (speaker === currentSpeaker) {
        currentText.push(entry.text);
      } else {
        // Write previous block
        transcriptMd += `## ${currentSpeaker} (${currentStart})\n\n`;
        transcriptMd += currentText.join(" ") + "\n\n";
        // Start new block
        currentSpeaker = speaker;
        currentStart = entry.start_timestamp;
        currentText = [entry.text];
      }
    }

    // Write last block
    if (currentSpeaker !== null) {
      transcriptMd += `## ${currentSpeaker} (${currentStart})\n\n`;
      transcriptMd += currentText.join(" ") + "\n\n";
    }

    return transcriptMd;
  }
}
