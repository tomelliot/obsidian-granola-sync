import {
  formatTranscriptBySpeaker,
  formatTranscriptBody,
} from "../../src/services/transcriptFormatter";
import { TranscriptEntry } from "../../src/services/granolaApi";
import { parseFrontmatter, TRICKY_TITLES } from "../helpers/frontmatter";

/** Builds a v1 transcript entry. */
const entry = (
  source: string,
  text: string,
  start: string,
  speakerExtras: { name?: string; diarization_label?: string } = {}
): TranscriptEntry => ({
  speaker: { source, ...speakerExtras },
  text,
  start_time: start,
  end_time: start,
});

const SINGLE_ENTRY: TranscriptEntry[] = [
  entry("microphone", "Test text", "00:00:01"),
];

describe("formatTranscriptBySpeaker", () => {
  beforeEach(() => {
    // Use fake timers to ensure consistent behavior across timezones
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-15T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should format a basic transcript with alternating speakers", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("microphone", "Hello, how are you?", "00:00:01"),
      entry("speaker", "I'm doing great, thanks!", "00:00:06"),
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
      "Test Meeting",
      "test-id"
    );

    expect(result).toContain("---");
    expect(result).toContain("granola_id: test-id");
    expect(result).toContain("title: Test Meeting - Transcript");
    expect(result).toContain("type: transcript");
    expect(result).toContain("# Transcript for: Test Meeting");
    expect(result).toContain("## You (00:00:01)");
    expect(result).toContain("Hello, how are you?");
    expect(result).toContain("## Guest (00:00:06)");
    expect(result).toContain("I'm doing great, thanks!");
  });

  it("should group consecutive entries from the same speaker", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("microphone", "First sentence.", "00:00:01"),
      entry("microphone", "Second sentence.", "00:00:04"),
      entry("microphone", "Third sentence.", "00:00:07"),
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
      "Monologue",
      "mono-id"
    );

    // Should only have one "You" section
    const youSections = result.match(/## You \(/g);
    expect(youSections).toHaveLength(1);
    expect(result).toContain("## You (00:00:01)");
    expect(result).toContain(
      "First sentence. Second sentence. Third sentence."
    );
  });

  it("should handle empty transcript data", () => {
    const result = formatTranscriptBySpeaker([], "Empty", "empty-id");

    expect(result).toContain("---");
    expect(result).toContain("granola_id: empty-id");
    expect(result).toContain("type: transcript");
    expect(result).toContain("# Transcript for: Empty");
    // Should not have any speaker sections
    expect(result).not.toContain("## You");
    expect(result).not.toContain("## Guest");
  });

  it("should escape quotes in title for YAML frontmatter", () => {
    const result = formatTranscriptBySpeaker(
      SINGLE_ENTRY,
      'Meeting "Project Alpha"',
      "test-id"
    );

    const fm = parseFrontmatter(result);
    expect(fm.title).toBe('Meeting "Project Alpha" - Transcript');
  });

  it.each(TRICKY_TITLES)(
    "should write valid YAML frontmatter for a title with %s (issue #139)",
    (_label, title) => {
      const result = formatTranscriptBySpeaker(SINGLE_ENTRY, title, "test-id");

      // parseFrontmatter throws on invalid YAML — the #139 failure mode.
      const fm = parseFrontmatter(result);
      // granola_id must remain readable so transcript dedup keeps working.
      expect(fm.granola_id).toBe("test-id");
      // Title is preserved exactly, with the " - Transcript" suffix appended.
      expect(fm.title).toBe(`${title} - Transcript`);
    }
  );

  it("should distinguish between microphone and speaker sources", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("microphone", "I'm speaking.", "00:00:01"),
      entry("speaker", "I'm the guest.", "00:00:04"),
      entry("other-source", "Another source.", "00:00:07"),
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
      "Mixed Sources",
      "mixed-id"
    );

    expect(result).toContain("## You (00:00:01)");
    expect(result).toContain("I'm speaking.");
    expect(result).toContain("## Guest (00:00:04)");
    // Both guest entries should be grouped together since they're both non-microphone sources
    expect(result).toContain("I'm the guest. Another source.");
  });

  it("should handle multiple speaker switches", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("microphone", "A", "00:00:01"),
      entry("speaker", "B", "00:00:03"),
      entry("microphone", "C", "00:00:05"),
      entry("speaker", "D", "00:00:07"),
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
      "Rapid Exchange",
      "rapid-id"
    );

    const youSections = result.match(/## You \(/g);
    const guestSections = result.match(/## Guest \(/g);
    expect(youSections).toHaveLength(2);
    expect(guestSections).toHaveLength(2);
  });

  it("should preserve timestamp in speaker headers", () => {
    const result = formatTranscriptBySpeaker(
      [entry("microphone", "Long timestamp test", "01:23:45")],
      "Timestamp Test",
      "ts-id"
    );

    expect(result).toContain("## You (01:23:45)");
  });

  it("should include created_at and updated_at in frontmatter when provided", () => {
    const createdAt = "2024-01-15T10:00:00Z";
    const updatedAt = "2024-01-15T12:00:00Z";

    const result = formatTranscriptBySpeaker(
      SINGLE_ENTRY,
      "Meeting with Timestamps",
      "meeting-123",
      createdAt,
      updatedAt
    );

    expect(result).toContain("---");
    expect(result).toContain("granola_id: meeting-123");
    expect(result).toContain("type: transcript");
    expect(result).toContain(`created: ${createdAt}`);
    expect(result).toContain(`updated: ${updatedAt}`);
    expect(result).toContain("---");
  });

  it("should not include timestamps in frontmatter when not provided", () => {
    const result = formatTranscriptBySpeaker(
      SINGLE_ENTRY,
      "Meeting without Timestamps",
      "meeting-456"
    );

    expect(result).toContain("---");
    expect(result).toContain("granola_id: meeting-456");
    expect(result).toContain("type: transcript");
    expect(result).not.toContain("created:");
    expect(result).not.toContain("updated:");
    expect(result).toContain("---");
  });

  it("should add note field to frontmatter when path provided", () => {
    const result = formatTranscriptBySpeaker(
      SINGLE_ENTRY,
      "Test Meeting",
      "test-id",
      undefined,
      undefined,
      undefined,
      "Granola/Test Meeting.md"
    );

    expect(result).toContain('note: "[[Granola/Test Meeting.md]]"');
  });

  it("should not add note field when path not provided", () => {
    const result = formatTranscriptBySpeaker(
      SINGLE_ENTRY,
      "Test Meeting",
      "test-id",
      undefined,
      undefined,
      undefined,
      undefined
    );

    expect(result).not.toContain("note:");
  });

  it("should use wiki-style links for note paths in frontmatter", () => {
    const result = formatTranscriptBySpeaker(
      SINGLE_ENTRY,
      "Test Meeting",
      "test-id",
      undefined,
      undefined,
      undefined,
      "Granola/My Meeting Note.md"
    );

    expect(result).toContain('note: "[[Granola/My Meeting Note.md]]"');
  });

  it("should support includeFrontmatter parameter", () => {
    const resultWithFrontmatter = formatTranscriptBySpeaker(
      SINGLE_ENTRY,
      "Test Meeting",
      "test-id",
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );

    const resultWithoutFrontmatter = formatTranscriptBySpeaker(
      SINGLE_ENTRY,
      "Test Meeting",
      "test-id",
      undefined,
      undefined,
      undefined,
      undefined,
      false
    );

    expect(resultWithFrontmatter).toContain("---");
    expect(resultWithFrontmatter).toContain("granola_id: test-id");
    expect(resultWithoutFrontmatter).not.toContain("---");
    expect(resultWithoutFrontmatter).not.toContain("granola_id:");
    expect(resultWithoutFrontmatter).toContain("## You (00:00:01)");
  });
});

describe("formatTranscriptBody", () => {
  beforeEach(() => {
    // Use fake timers to ensure consistent behavior across timezones
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-15T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should format transcript body without frontmatter", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("microphone", "Hello, how are you?", "00:00:01"),
      entry("speaker", "I'm doing great, thanks!", "00:00:06"),
    ];

    const result = formatTranscriptBody(transcriptData);

    expect(result).not.toContain("---");
    expect(result).not.toContain("granola_id");
    expect(result).not.toContain("type: transcript");
    expect(result).toContain("## You (00:00:01)");
    expect(result).toContain("Hello, how are you?");
    expect(result).toContain("## Guest (00:00:06)");
    expect(result).toContain("I'm doing great, thanks!");
  });

  it("should group consecutive entries from the same speaker", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("microphone", "First sentence.", "00:00:01"),
      entry("microphone", "Second sentence.", "00:00:04"),
      entry("microphone", "Third sentence.", "00:00:07"),
    ];

    const result = formatTranscriptBody(transcriptData);

    const youSections = result.match(/## You \(/g);
    expect(youSections).toHaveLength(1);
    expect(result).toContain("## You (00:00:01)");
    expect(result).toContain(
      "First sentence. Second sentence. Third sentence."
    );
  });

  it("should handle empty transcript data", () => {
    const result = formatTranscriptBody([]);

    expect(result).toBe("");
    expect(result).not.toContain("## You");
    expect(result).not.toContain("## Guest");
  });

  it("should use resolved speaker names when present", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("speaker", "Hi there.", "00:00:01", { name: "Alice Smith" }),
      entry("speaker", "Welcome.", "00:00:04", { name: "Alice Smith" }),
      entry("microphone", "Thanks!", "00:00:07"),
    ];

    const result = formatTranscriptBody(transcriptData);

    expect(result).toContain("### Alice Smith (00:00:01)");
    expect(result).toContain("Hi there. Welcome.");
    expect(result).toContain("### You (00:00:07)");
    expect(result).not.toContain("### Guest");
  });

  it("should fall back to diarization labels before generic Guest", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("speaker", "One.", "00:00:01", { diarization_label: "Speaker A" }),
      entry("speaker", "Two.", "00:00:04", { diarization_label: "Speaker B" }),
    ];

    const result = formatTranscriptBody(transcriptData);

    expect(result).toContain("### Speaker A (00:00:01)");
    expect(result).toContain("### Speaker B (00:00:04)");
  });

  it("should distinguish between microphone and speaker sources", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("microphone", "I'm speaking.", "00:00:01"),
      entry("speaker", "I'm the guest.", "00:00:04"),
      entry("other-source", "Another source.", "00:00:07"),
    ];

    const result = formatTranscriptBody(transcriptData);

    expect(result).toContain("## You (00:00:01)");
    expect(result).toContain("I'm speaking.");
    expect(result).toContain("## Guest (00:00:04)");
    expect(result).toContain("I'm the guest. Another source.");
  });

  it("should handle multiple speaker switches", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("microphone", "A", "00:00:01"),
      entry("speaker", "B", "00:00:03"),
      entry("microphone", "C", "00:00:05"),
      entry("speaker", "D", "00:00:07"),
    ];

    const result = formatTranscriptBody(transcriptData);

    const youSections = result.match(/## You \(/g);
    const guestSections = result.match(/## Guest \(/g);
    expect(youSections).toHaveLength(2);
    expect(guestSections).toHaveLength(2);
  });

  it("should preserve timestamp in speaker headers", () => {
    const result = formatTranscriptBody([
      entry("microphone", "Long timestamp test", "01:23:45"),
    ]);

    expect(result).toContain("## You (01:23:45)");
  });

  it("should use level 3 headings (###) for speaker headings", () => {
    const transcriptData: TranscriptEntry[] = [
      entry("microphone", "Hello, how are you?", "00:00:01"),
      entry("speaker", "I'm doing great, thanks!", "00:00:06"),
    ];

    const result = formatTranscriptBody(transcriptData);

    // Verify headings start with exactly three hashes at the beginning of a line
    expect(result).toMatch(/^### You \(00:00:01\)/m);
    expect(result).toMatch(/^### Guest \(00:00:06\)/m);
    // Ensure no level 2 headings exist (pattern that starts with exactly two hashes)
    expect(result).not.toMatch(/^## You \(/m);
    expect(result).not.toMatch(/^## Guest \(/m);
  });
});
