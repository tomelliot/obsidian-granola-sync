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
 * @param includeAttendees - Whether to include attendees in frontmatter
 * @param attendeesFieldName - Name of the attendees field in frontmatter
 * @returns Formatted markdown string with frontmatter and speaker-grouped content
 */
export function formatTranscriptBySpeaker(
  transcriptData: TranscriptEntry[],
  title: string,
  granolaId: string,
  createdAt?: string,
  updatedAt?: string,
  attendees?: string[],
  includeAttendees: boolean = true,
  attendeesFieldName: string = "Attendees"
): string {
  // Add frontmatter with granola_id for transcript deduplication
  const escapedTitleForYaml = title.replace(/"/g, '\\"');
  const frontmatterLines = [
    "---",
    `granola_id: ${granolaId}`,
    `title: "${escapedTitleForYaml} - Transcript"`,
    `type: transcript`,
  ];
  if (createdAt) frontmatterLines.push(`created_at: ${createdAt}`);
  if (updatedAt) frontmatterLines.push(`updated_at: ${updatedAt}`);
  if (
    includeAttendees &&
    attendees &&
    attendees.length > 0
  ) {
    // Format attendees as YAML array using the configured field name
    const attendeesYaml = attendees.map(name => `  - ${name}`).join("\n");
    frontmatterLines.push(`${attendeesFieldName}:\n${attendeesYaml}`);
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
