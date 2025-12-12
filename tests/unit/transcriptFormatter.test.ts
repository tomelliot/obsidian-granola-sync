import {
  formatTranscriptBySpeaker,
  formatTranscriptBody,
} from "../../src/services/transcriptFormatter";
import { TranscriptEntry } from "../../src/services/granolaApi";

describe("formatTranscriptBySpeaker", () => {
  it("should format a basic transcript with alternating speakers", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Hello, how are you?",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:06",
        end_timestamp: "00:00:10",
        text: "I'm doing great, thanks!",
        source: "speaker",
        id: "entry2",
        is_final: true,
      },
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
      "Test Meeting",
      "test-id"
    );

    expect(result).toContain("---");
    expect(result).toContain("granola_id: test-id");
    expect(result).toContain('title: "Test Meeting - Transcript"');
    expect(result).toContain("type: transcript");
    expect(result).toContain("# Transcript for: Test Meeting");
    expect(result).toContain("## You (00:00:01)");
    expect(result).toContain("Hello, how are you?");
    expect(result).toContain("## Guest (00:00:06)");
    expect(result).toContain("I'm doing great, thanks!");
  });

  it("should group consecutive entries from the same speaker", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:03",
        text: "First sentence.",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:04",
        end_timestamp: "00:00:06",
        text: "Second sentence.",
        source: "microphone",
        id: "entry2",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:07",
        end_timestamp: "00:00:09",
        text: "Third sentence.",
        source: "microphone",
        id: "entry3",
        is_final: true,
      },
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
    const transcriptData: TranscriptEntry[] = [];

    const result = formatTranscriptBySpeaker(
      transcriptData,
      "Empty",
      "empty-id"
    );

    expect(result).toContain("---");
    expect(result).toContain("granola_id: empty-id");
    expect(result).toContain("type: transcript");
    expect(result).toContain("# Transcript for: Empty");
    // Should not have any speaker sections
    expect(result).not.toContain("## You");
    expect(result).not.toContain("## Guest");
  });

  it("should escape quotes in title for YAML frontmatter", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Test text",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
      'Meeting "Project Alpha"',
      "test-id"
    );

    expect(result).toContain(
      'title: "Meeting \\"Project Alpha\\" - Transcript"'
    );
  });

  it("should distinguish between microphone and speaker sources", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:03",
        text: "I'm speaking.",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:04",
        end_timestamp: "00:00:06",
        text: "I'm the guest.",
        source: "speaker",
        id: "entry2",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:07",
        end_timestamp: "00:00:09",
        text: "Another source.",
        source: "other-source",
        id: "entry3",
        is_final: true,
      },
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
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:02",
        text: "A",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:03",
        end_timestamp: "00:00:04",
        text: "B",
        source: "speaker",
        id: "entry2",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:05",
        end_timestamp: "00:00:06",
        text: "C",
        source: "microphone",
        id: "entry3",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:07",
        end_timestamp: "00:00:08",
        text: "D",
        source: "speaker",
        id: "entry4",
        is_final: true,
      },
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
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "01:23:45",
        end_timestamp: "01:23:50",
        text: "Long timestamp test",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
      "Timestamp Test",
      "ts-id"
    );

    expect(result).toContain("## You (01:23:45)");
  });

  it("should include created_at and updated_at in frontmatter when provided", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Test text",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
    ];

    const createdAt = "2024-01-15T10:00:00Z";
    const updatedAt = "2024-01-15T12:00:00Z";

    const result = formatTranscriptBySpeaker(
      transcriptData,
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
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Test text",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
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
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Test text",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
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
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Test text",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
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
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Test text",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
    ];

    const result = formatTranscriptBySpeaker(
      transcriptData,
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
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Test text",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
    ];

    const resultWithFrontmatter = formatTranscriptBySpeaker(
      transcriptData,
      "Test Meeting",
      "test-id",
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );

    const resultWithoutFrontmatter = formatTranscriptBySpeaker(
      transcriptData,
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
  it("should format transcript body without frontmatter", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Hello, how are you?",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:06",
        end_timestamp: "00:00:10",
        text: "I'm doing great, thanks!",
        source: "speaker",
        id: "entry2",
        is_final: true,
      },
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
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:03",
        text: "First sentence.",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:04",
        end_timestamp: "00:00:06",
        text: "Second sentence.",
        source: "microphone",
        id: "entry2",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:07",
        end_timestamp: "00:00:09",
        text: "Third sentence.",
        source: "microphone",
        id: "entry3",
        is_final: true,
      },
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
    const transcriptData: TranscriptEntry[] = [];

    const result = formatTranscriptBody(transcriptData);

    expect(result).toBe("");
    expect(result).not.toContain("## You");
    expect(result).not.toContain("## Guest");
  });

  it("should distinguish between microphone and speaker sources", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:03",
        text: "I'm speaking.",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:04",
        end_timestamp: "00:00:06",
        text: "I'm the guest.",
        source: "speaker",
        id: "entry2",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:07",
        end_timestamp: "00:00:09",
        text: "Another source.",
        source: "other-source",
        id: "entry3",
        is_final: true,
      },
    ];

    const result = formatTranscriptBody(transcriptData);

    expect(result).toContain("## You (00:00:01)");
    expect(result).toContain("I'm speaking.");
    expect(result).toContain("## Guest (00:00:04)");
    expect(result).toContain("I'm the guest. Another source.");
  });

  it("should handle multiple speaker switches", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:02",
        text: "A",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:03",
        end_timestamp: "00:00:04",
        text: "B",
        source: "speaker",
        id: "entry2",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:05",
        end_timestamp: "00:00:06",
        text: "C",
        source: "microphone",
        id: "entry3",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:07",
        end_timestamp: "00:00:08",
        text: "D",
        source: "speaker",
        id: "entry4",
        is_final: true,
      },
    ];

    const result = formatTranscriptBody(transcriptData);

    const youSections = result.match(/## You \(/g);
    const guestSections = result.match(/## Guest \(/g);
    expect(youSections).toHaveLength(2);
    expect(guestSections).toHaveLength(2);
  });

  it("should preserve timestamp in speaker headers", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "01:23:45",
        end_timestamp: "01:23:50",
        text: "Long timestamp test",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
    ];

    const result = formatTranscriptBody(transcriptData);

    expect(result).toContain("## You (01:23:45)");
  });

  it("should use level 3 headings (###) for speaker headings", () => {
    const transcriptData: TranscriptEntry[] = [
      {
        document_id: "doc1",
        start_timestamp: "00:00:01",
        end_timestamp: "00:00:05",
        text: "Hello, how are you?",
        source: "microphone",
        id: "entry1",
        is_final: true,
      },
      {
        document_id: "doc1",
        start_timestamp: "00:00:06",
        end_timestamp: "00:00:10",
        text: "I'm doing great, thanks!",
        source: "speaker",
        id: "entry2",
        is_final: true,
      },
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
