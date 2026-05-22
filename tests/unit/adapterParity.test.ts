import {
  adaptPublicNoteToGranolaDoc,
  adaptTranscript,
} from "../../src/services/granolaDocAdapter";
import { formatTranscriptBody } from "../../src/services/transcriptFormatter";
import type { GranolaDoc, TranscriptEntry } from "../../src/services/granolaApi";
import type { PublicNote } from "../../src/services/publicApiSchemas";

jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

/**
 * Adapter byte-identical parity tests.
 *
 * Goal: prove that the *stable* parts of a synced file (transcript body,
 * canonical id, attendees) come out identically whether the source data is a
 * desktop `GranolaDoc` or a Public API `PublicNote` for the same meeting.
 *
 * Allowed differences: note body content may legitimately differ
 * (ProseMirror vs `summary_markdown`); this test does not assert equality
 * there. It does assert the transcript section is byte-for-byte equal,
 * because the formatter operates on the same internal `TranscriptEntry[]`
 * shape in both modes.
 */

describe("Adapter parity — desktop GranolaDoc vs Public API note", () => {
  const meetingUuid = "00000000-0000-0000-0000-000000000001";

  // Desktop side: what /v2/get-documents returned for the meeting.
  const desktopDoc: GranolaDoc = {
    id: meetingUuid,
    title: "Quarterly Strategy",
    created_at: "2026-05-21T15:00:00.000Z",
    updated_at: "2026-05-21T15:42:13.000Z",
    last_viewed_panel: {
      content: { type: "doc", content: [] },
      updated_at: "2026-05-21T15:42:13.000Z",
    },
    people: {
      attendees: [
        { name: "Alice Example", email: "alice@example.com" },
        { name: "Bob Example", email: "bob@example.com" },
      ],
    },
  };

  // Public API side: what /v1/notes/{not_id}?include=transcript returned.
  const publicNote: PublicNote = {
    id: "not_AAAAAAAAAAAAAA",
    title: "Quarterly Strategy",
    created_at: "2026-05-21T15:00:00.000Z",
    updated_at: "2026-05-21T15:42:13.000Z",
    web_url: `https://notes.granola.ai/d/${meetingUuid}`,
    owner: { name: "Alice Example", email: "alice@example.com" },
    attendees: [
      { name: "Alice Example", email: "alice@example.com" },
      { name: "Bob Example", email: "bob@example.com" },
    ],
    summary_markdown: "## Notes\n\n- ai summary content",
    summary_text: "Plain text summary",
    transcript: [
      {
        id: "trn_1",
        start_time: "2026-05-21T15:00:05.000Z",
        end_time: "2026-05-21T15:00:09.000Z",
        text: "Good morning everyone.",
        speaker: { source: "speaker" },
      },
      {
        id: "trn_2",
        start_time: "2026-05-21T15:00:10.000Z",
        end_time: "2026-05-21T15:00:15.000Z",
        text: "I have the agenda pulled up.",
        speaker: { source: "microphone" },
      },
    ],
  };

  it("produces the same canonical granola_id from both sources", () => {
    const adapted = adaptPublicNoteToGranolaDoc(publicNote);
    expect(adapted.id).toBe(desktopDoc.id);
  });

  it("produces the same attendees in the same order", () => {
    const adapted = adaptPublicNoteToGranolaDoc(publicNote);
    expect(adapted.people?.attendees).toEqual(desktopDoc.people?.attendees);
  });

  it("produces the same created_at / updated_at strings", () => {
    const adapted = adaptPublicNoteToGranolaDoc(publicNote);
    expect(adapted.created_at).toBe(desktopDoc.created_at);
    expect(adapted.updated_at).toBe(desktopDoc.updated_at);
  });

  it("produces a transcript body byte-identical to one built from the equivalent desktop entries", () => {
    // Simulate the same meeting reaching us via the desktop transcript endpoint.
    const desktopTranscript: TranscriptEntry[] = [
      {
        id: "trn_1",
        document_id: meetingUuid,
        start_timestamp: "2026-05-21T15:00:05.000Z",
        end_timestamp: "2026-05-21T15:00:09.000Z",
        text: "Good morning everyone.",
        source: "speaker",
        is_final: true,
      },
      {
        id: "trn_2",
        document_id: meetingUuid,
        start_timestamp: "2026-05-21T15:00:10.000Z",
        end_timestamp: "2026-05-21T15:00:15.000Z",
        text: "I have the agenda pulled up.",
        source: "microphone",
        is_final: true,
      },
    ];
    const adaptedTranscript = adaptTranscript(meetingUuid, publicNote.transcript);

    expect(adaptedTranscript).toEqual(desktopTranscript);
    expect(formatTranscriptBody(adaptedTranscript)).toBe(
      formatTranscriptBody(desktopTranscript)
    );
  });

  it("falls back to the not_ id only when the web_url UUID is missing — confirms the bridge", () => {
    const adapted = adaptPublicNoteToGranolaDoc(publicNote);
    const withoutUrl = adaptPublicNoteToGranolaDoc({
      ...publicNote,
      web_url: null,
    });

    expect(adapted.id).toBe(meetingUuid);
    expect(withoutUrl.id).toBe(publicNote.id);
  });
});
