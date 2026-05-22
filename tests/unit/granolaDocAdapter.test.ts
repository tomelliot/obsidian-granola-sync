import fs from "fs";
import path from "path";
import {
  adaptPublicNoteToGranolaDoc,
  adaptPublicNoteSummary,
  adaptTranscript,
  extractFoldersFromMembership,
  extractLegacyIdFromWebUrl,
  membershipToFolderPaths,
} from "../../src/services/granolaDocAdapter";
import type {
  PublicNote,
  PublicNoteSummary,
} from "../../src/services/publicApiSchemas";

function loadFixture<T>(name: string): T {
  const p = path.join(__dirname, "..", "fixtures", "public-api", name);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

describe("granolaDocAdapter — extractLegacyIdFromWebUrl", () => {
  it("returns the UUID from a Granola web URL", () => {
    expect(
      extractLegacyIdFromWebUrl(
        "https://notes.granola.ai/d/00000000-0000-0000-0000-000000000001"
      )
    ).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("accepts a URL with trailing path / query", () => {
    expect(
      extractLegacyIdFromWebUrl(
        "https://notes.granola.ai/d/00000000-0000-0000-0000-000000000001?ref=share"
      )
    ).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("returns null for nullish / empty input", () => {
    expect(extractLegacyIdFromWebUrl(null)).toBeNull();
    expect(extractLegacyIdFromWebUrl(undefined)).toBeNull();
    expect(extractLegacyIdFromWebUrl("")).toBeNull();
  });

  it("returns null when the URL doesn't contain a UUID", () => {
    expect(
      extractLegacyIdFromWebUrl("https://notes.granola.ai/d/not_AAAAAAAAAAAAAA")
    ).toBeNull();
    expect(
      extractLegacyIdFromWebUrl("https://example.com/some-other-path")
    ).toBeNull();
  });
});

describe("granolaDocAdapter — membershipToFolderPaths", () => {
  it("returns empty array for no membership", () => {
    expect(membershipToFolderPaths(undefined)).toEqual([]);
    expect(membershipToFolderPaths([])).toEqual([]);
  });

  it("walks parent_folder_id to build slashed paths", () => {
    const paths = membershipToFolderPaths([
      { id: "a", name: "Strategy", parent_folder_id: null },
      { id: "b", name: "Subteam", parent_folder_id: "a" },
    ]);
    // Sorted deterministically — Subteam is a child of Strategy
    expect(paths).toEqual(["Strategy", "Strategy/Subteam"]);
  });

  it("dedupes identical paths", () => {
    const paths = membershipToFolderPaths([
      { id: "a", name: "Same", parent_folder_id: null },
      { id: "b", name: "Same", parent_folder_id: null },
    ]);
    expect(paths).toEqual(["Same"]);
  });

  it("treats a node with a missing parent as a root rather than looping", () => {
    const paths = membershipToFolderPaths([
      {
        id: "a",
        name: "Orphan",
        parent_folder_id: "missing-parent",
      },
    ]);
    expect(paths).toEqual(["Orphan"]);
  });

  it("does not infinite-loop on cycles", () => {
    const paths = membershipToFolderPaths([
      { id: "a", name: "A", parent_folder_id: "b" },
      { id: "b", name: "B", parent_folder_id: "a" },
    ]);
    // We just want this to terminate; the exact path order isn't critical.
    expect(paths.length).toBeGreaterThan(0);
  });

  it("produces deterministic (sorted) output for byte-stable frontmatter", () => {
    const a = membershipToFolderPaths([
      { id: "1", name: "Zeta", parent_folder_id: null },
      { id: "2", name: "Alpha", parent_folder_id: null },
    ]);
    const b = membershipToFolderPaths([
      { id: "2", name: "Alpha", parent_folder_id: null },
      { id: "1", name: "Zeta", parent_folder_id: null },
    ]);
    expect(a).toEqual(b);
  });
});

describe("granolaDocAdapter — adaptPublicNoteToGranolaDoc", () => {
  it("maps the get-note fixture into a GranolaDoc keyed by the legacy UUID", () => {
    const fixture = loadFixture<PublicNote>("get-note.json");
    const doc = adaptPublicNoteToGranolaDoc(fixture);

    expect(doc.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(doc._publicId).toBe("not_AAAAAAAAAAAAAA");
    expect(doc._webUrl).toBe(fixture.web_url);
    expect(doc.title).toBe("Quarterly Strategy Sync");
    expect(doc.created_at).toBe("2026-05-21T15:00:00.000Z");
    expect(doc.updated_at).toBe("2026-05-21T15:42:13.000Z");
    expect(doc.last_viewed_panel?.content).toBe(fixture.summary_markdown);
    expect(doc.last_viewed_panel?.updated_at).toBe(fixture.updated_at);
  });

  it("flattens folder_membership into slashed paths", () => {
    const fixture = loadFixture<PublicNote>("get-note.json");
    expect(extractFoldersFromMembership(fixture)).toEqual([
      "Strategy",
      "Strategy/Subteam",
    ]);
  });

  it("ignores unknown extra fields on membership entries (e.g. object discriminator)", () => {
    expect(
      membershipToFolderPaths([
        { id: "a", name: "Labs", parent_folder_id: null, object: "folder" } as any,
      ])
    ).toEqual(["Labs"]);
  });

  it("falls back to the not_ id when web_url is missing", () => {
    const fixture = loadFixture<PublicNote>("get-note.json");
    const without = { ...fixture, web_url: null };
    const doc = adaptPublicNoteToGranolaDoc(without);
    expect(doc.id).toBe(fixture.id);
  });

  it("uses summary_text when summary_markdown is missing", () => {
    const fixture = loadFixture<PublicNote>("get-note.json");
    const note = {
      ...fixture,
      summary_markdown: null,
      summary_text: "Plain text fallback",
    };
    const doc = adaptPublicNoteToGranolaDoc(note);
    expect(doc.last_viewed_panel?.content).toBe("Plain text fallback");
  });

  it("returns last_viewed_panel: null when no summary is available", () => {
    const fixture = loadFixture<PublicNote>("get-note.json");
    const note = { ...fixture, summary_markdown: null, summary_text: null };
    const doc = adaptPublicNoteToGranolaDoc(note);
    expect(doc.last_viewed_panel).toBeNull();
  });

  it("maps attendees into people.attendees", () => {
    const fixture = loadFixture<PublicNote>("get-note.json");
    const doc = adaptPublicNoteToGranolaDoc(fixture);
    expect(doc.people?.attendees).toEqual([
      { name: "Alice Example", email: "alice@example.com" },
      { name: "Bob Example", email: "bob@example.com" },
    ]);
  });
});

describe("granolaDocAdapter — adaptPublicNoteSummary", () => {
  /**
   * The spec's NoteSummary does NOT include `web_url`, so the list endpoint
   * can't drive the legacy-UUID bridge on its own — only Get Note can. This
   * test locks that: summary adaptation always uses `not_*` as the id.
   */
  it("uses the not_ id as the canonical id (list endpoint has no web_url)", () => {
    const summary: PublicNoteSummary = {
      id: "not_AAAAAAAAAAAAAA",
      title: "Subteam",
      created_at: "2026-05-21T15:00:00.000Z",
      updated_at: "2026-05-21T15:42:13.000Z",
      owner: null,
    };
    const doc = adaptPublicNoteSummary(summary);
    expect(doc.id).toBe("not_AAAAAAAAAAAAAA");
    expect(doc._publicId).toBe(summary.id);
    expect(doc._webUrl).toBeNull();
  });
});

describe("granolaDocAdapter — adaptTranscript", () => {
  it("maps the get-note-with-transcript fixture into internal TranscriptEntry[]", () => {
    const fixture = loadFixture<PublicNote>("get-note-with-transcript.json");
    const doc = adaptPublicNoteToGranolaDoc(fixture);
    const transcript = adaptTranscript(doc.id, fixture.transcript);

    expect(transcript).toHaveLength(2);
    expect(transcript[0]).toEqual({
      id: "trn_1",
      document_id: doc.id,
      // Real API uses `start_time` / `end_time`; the adapter copies them into
      // the internal `start_timestamp` / `end_timestamp` field names the
      // transcript formatter consumes.
      start_timestamp: "2026-05-21T15:00:05.000Z",
      end_timestamp: "2026-05-21T15:00:09.000Z",
      text: "Hello, welcome to the example meeting.",
      // public "speaker" (other party via device speakers) → passes through;
      // the formatter renders anything other than "microphone" as "Guest".
      source: "speaker",
      is_final: true,
    });
    expect(transcript[1].source).toBe("microphone");
  });

  it("returns [] when no transcript provided", () => {
    expect(adaptTranscript("doc", undefined)).toEqual([]);
    expect(adaptTranscript("doc", [])).toEqual([]);
  });

  it("drops empty-text entries", () => {
    const result = adaptTranscript("doc", [
      { text: "" },
      { text: "   " },
      { text: "real", speaker: { source: "microphone" } },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("real");
  });

  it("synthesizes an id when public transcript entry lacks one", () => {
    const result = adaptTranscript("doc-abc", [
      { text: "hi", speaker: { source: "microphone" } },
    ]);
    expect(result[0].id).toBe("doc-abc-0");
  });

  it("preserves the documented `me` source as `microphone` for forward-compat", () => {
    // Granola's docs imply `me`/`them`, but the live API actually emits
    // `microphone`/`speaker`. We accept both to avoid breaking on future
    // server-side changes that revert to the documented values.
    const result = adaptTranscript("doc", [
      { text: "hi", speaker: { source: "me" } },
    ]);
    expect(result[0].source).toBe("microphone");
  });
});
