import * as v from "valibot";
import {
  ListNotesResponseSchema,
  ListFoldersResponseSchema,
  NoteDetailSchema,
} from "../../src/services/validationSchemas";

const noteSummary = {
  id: "not_1d3tmYTlCICgjy",
  object: "note",
  title: "Quarterly yoghurt budget review",
  owner: { name: "Oat Benson", email: "oat@granola.ai" },
  created_at: "2026-01-27T15:30:00Z",
  updated_at: "2026-01-27T16:45:00Z",
};

describe("v1 schemas", () => {
  test("parses list-notes envelope", () => {
    const result = v.safeParse(ListNotesResponseSchema, {
      notes: [noteSummary],
      hasMore: false,
      cursor: null,
    });
    expect(result.success).toBe(true);
  });

  test("parses note detail with null summary_markdown and transcript", () => {
    const detail = {
      ...noteSummary,
      web_url: "https://notes.granola.ai/d/f3e45e0f-24cc-480b-9a6c-8b1f5e3d7a2c",
      calendar_event: null,
      attendees: [{ name: null, email: "raisin@granola.ai" }],
      folder_membership: [
        { id: "fol_4y6LduVdwSKC27", object: "folder", name: "Recipes", parent_folder_id: null },
      ],
      summary_text: "plain",
      summary_markdown: null,
      transcript: null,
    };
    const result = v.safeParse(NoteDetailSchema, detail);
    expect(result.success).toBe(true);
  });

  test("parses transcript entries", () => {
    const detail = {
      ...noteSummary,
      web_url: "https://notes.granola.ai/d/abc",
      calendar_event: null,
      attendees: [],
      folder_membership: [],
      summary_text: "s",
      summary_markdown: "## s",
      transcript: [
        {
          speaker: { source: "microphone" },
          text: "hello",
          start_time: "2026-01-27T15:30:00Z",
          end_time: "2026-01-27T15:30:05Z",
        },
      ],
    };
    const result = v.safeParse(NoteDetailSchema, detail);
    expect(result.success).toBe(true);
  });

  test("parses list-folders envelope", () => {
    const result = v.safeParse(ListFoldersResponseSchema, {
      folders: [{ id: "fol_x", object: "folder", name: "F", parent_folder_id: null }],
      hasMore: true,
      cursor: "abc",
    });
    expect(result.success).toBe(true);
  });

  test("rejects malformed envelope", () => {
    expect(v.safeParse(ListNotesResponseSchema, { nope: true }).success).toBe(false);
  });
});
