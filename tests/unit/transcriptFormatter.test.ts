import { formatTranscriptBySpeaker } from "../../src/services/transcriptFormatter";
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
    expect(result).toContain("First sentence. Second sentence. Third sentence.");
  });

  it("should handle empty transcript data", () => {
    const transcriptData: TranscriptEntry[] = [];

    const result = formatTranscriptBySpeaker(transcriptData, "Empty", "empty-id");

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

    expect(result).toContain('title: "Meeting \\"Project Alpha\\" - Transcript"');
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
    expect(result).toContain(`created_at: ${createdAt}`);
    expect(result).toContain(`updated_at: ${updatedAt}`);
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
    expect(result).not.toContain("created_at:");
    expect(result).not.toContain("updated_at:");
    expect(result).toContain("---");
  });

  it("should add note field to frontmatter when enabled and path provided", () => {
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
      "Granola/Test Meeting.md",
      true
    );

    expect(result).toContain("note: <Granola/Test Meeting.md>");
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
      undefined,
      true
    );

    expect(result).not.toContain("note:");
  });

  it("should not add note field when linking disabled", () => {
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
      "Granola/Test Meeting.md",
      false
    );

    expect(result).not.toContain("note:");
  });

  it("should wrap note paths with spaces in angle brackets", () => {
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
      "Granola/My Meeting Note.md",
      true
    );

    expect(result).toContain("note: <Granola/My Meeting Note.md>");
  });
});
