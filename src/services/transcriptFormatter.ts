import { TranscriptEntry } from "./granolaApi";

/**
 * Formats transcript data into markdown, grouped by speaker.
 *
 * @param transcriptData - Array of transcript entries from Granola API
 * @param title - Title of the note/transcript
 * @param granolaId - Granola document ID
 * @param createdAt - Optional creation timestamp
 * @param updatedAt - Optional update timestamp
 * @param attendees - Optional array of attendee names
 * @param notePath - Optional resolved note path (with collision detection) to include in frontmatter
 * @returns Formatted markdown string with frontmatter and speaker-grouped content
 */
export function formatTranscriptBySpeaker(
  transcriptData: TranscriptEntry[],
  title: string,
  granolaId: string,
  createdAt?: string,
  updatedAt?: string,
  attendees?: string[],
  notePath?: string
): string {
  // Add frontmatter with granola_id for transcript deduplication
  const escapedTitleForYaml = title.replace(/"/g, '\\"');
  const frontmatterLines = [
    "---",
    `granola_id: ${granolaId}`,
    `title: "${escapedTitleForYaml} - Transcript"`,
    `type: transcript`,
  ];
  if (createdAt) frontmatterLines.push(`created: ${createdAt}`);
  if (updatedAt) frontmatterLines.push(`updated: ${updatedAt}`);
  const attendeesArray = attendees || [];
  if (attendeesArray.length > 0) {
    const attendeesYaml = attendeesArray
      .map((name) => `  - ${name}`)
      .join("\n");
    frontmatterLines.push(`attendees:\n${attendeesYaml}`);
  } else {
    frontmatterLines.push(`attendees: []`);
  }

  // Add note link to frontmatter if path provided
  // Path is only provided when notes are synced to individual files (not DAILY_NOTES)
  if (notePath) {
    // Use wiki-style links in frontmatter
    frontmatterLines.push(`note: "[[${notePath}]]"`);
  }

  frontmatterLines.push("---", "");

  let transcriptMd = frontmatterLines.join("\n") + "\n";

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
