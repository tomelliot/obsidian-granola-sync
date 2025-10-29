import { TranscriptEntry } from "./granolaApi";

/**
 * Formats transcript data into markdown, grouped by speaker.
 *
 * @param transcriptData - Array of transcript entries from Granola API
 * @param title - Title of the note/transcript
 * @param granolaId - Granola document ID
 * @returns Formatted markdown string with frontmatter and speaker-grouped content
 */
export function formatTranscriptBySpeaker(
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
