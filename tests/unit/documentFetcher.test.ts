import fs from "fs";
import path from "path";
import { requestUrl } from "obsidian";
import {
  fetchDocumentsForSync,
  computeApiFetchWindow,
} from "../../src/services/documentFetcher";
import { setMinRequestSpacingMs } from "../../src/services/publicGranolaApi";
import { DEFAULT_SETTINGS, GranolaSyncSettings } from "../../src/settings";

jest.mock("obsidian");
jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

(global as any).PLUGIN_VERSION = "1.0.0-test";

function loadFixture(name: string): unknown {
  const p = path.join(__dirname, "..", "fixtures", "public-api", name);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

const mockRequestUrl = requestUrl as jest.Mock;

function settings(o: Partial<GranolaSyncSettings> = {}): GranolaSyncSettings {
  return { ...DEFAULT_SETTINGS, ...o };
}

describe("documentFetcher — computeApiFetchWindow", () => {
  it("returns empty window for full mode", () => {
    expect(
      computeApiFetchWindow(settings({ syncDaysBack: 7 }), {
        mode: "full",
        latestSyncTime: 12345,
      })
    ).toEqual({});
  });

  it("uses latestSyncTime as updated_after when set", () => {
    const t = Date.UTC(2026, 4, 20);
    const w = computeApiFetchWindow(settings({ syncDaysBack: 7 }), {
      mode: "standard",
      latestSyncTime: t,
    });
    expect(w.updatedAfter).toBe(new Date(t).toISOString());
    expect(w.createdAfter).toBeUndefined();
  });

  it("falls back to created_after = now - syncDaysBack when no latestSyncTime", () => {
    const w = computeApiFetchWindow(settings({ syncDaysBack: 7 }), {
      mode: "standard",
      latestSyncTime: 0,
    });
    expect(w.createdAfter).toBeTruthy();
    const t = new Date(w.createdAfter!).getTime();
    // ~7 days ago, within a 10s tolerance for test execution time
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(t - expected)).toBeLessThan(10_000);
  });

  it("returns empty window when syncDaysBack=0 (sync all)", () => {
    expect(
      computeApiFetchWindow(settings({ syncDaysBack: 0 }), {
        mode: "standard",
      })
    ).toEqual({});
  });
});

describe("documentFetcher — fetchDocumentsForSync (api_key)", () => {
  beforeAll(() => setMinRequestSpacingMs(0));
  beforeEach(() => jest.clearAllMocks());

  it("returns adapted docs with folders and transcript when includeTranscripts=true", async () => {
    const listPage = {
      notes: [
        {
          id: "not_AAAAAAAAAAAAAA",
          title: "Subteam",
          created_at: "2026-05-21T15:00:00.000Z",
          updated_at: "2026-05-21T15:42:13.000Z",
          web_url:
            "https://notes.granola.ai/d/00000000-0000-0000-0000-000000000001",
        },
      ],
      hasMore: false,
      cursor: null,
    };
    mockRequestUrl
      .mockResolvedValueOnce({ status: 200, json: listPage, headers: {} })
      .mockResolvedValueOnce({
        status: 200,
        json: loadFixture("get-note-with-transcript.json"),
        headers: {},
      });

    const out = await fetchDocumentsForSync(
      { method: "api_key", token: "grn_test" },
      settings({ syncTranscripts: true }),
      { mode: "standard", includeTranscripts: true }
    );

    expect(out).toHaveLength(1);
    expect(out[0].doc.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(out[0].publicId).toBe("not_AAAAAAAAAAAAAA");
    expect(out[0].folders).toEqual(["Strategy"]);
    expect(out[0].apiTranscript).toHaveLength(2);
    // Raw folder_membership is preserved on FetchedDoc so the orchestrator
    // can build an apiFolderSnapshot keyed by stable folder IDs.
    expect(out[0].folderMembership).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "fol_aaaaaaaaaaaaaa",
          name: "Strategy",
        }),
      ])
    );
  });

  it("gates Get Note behind list-level updated_at (no fetch when unchanged)", async () => {
    // List endpoint per spec: no `web_url` on summary. The gate keys by
    // `not_*` id, which the caller is expected to have populated (e.g. from
    // a previous sync's `_apiNoteIdBridge` entries, or by including both
    // UUID-keyed AND not-keyed entries in the map).
    const listPage = {
      notes: [
        {
          id: "not_AAAAAAAAAAAAAA",
          object: "note",
          title: "Subteam",
          owner: { name: "Tristan", email: "t@example.com" },
          created_at: "2026-05-21T15:00:00.000Z",
          updated_at: "2026-05-21T15:42:13.000Z",
        },
      ],
      hasMore: false,
      cursor: null,
    };
    mockRequestUrl.mockResolvedValueOnce({
      status: 200,
      json: listPage,
      headers: {},
    });

    const known = new Map<string, string>([
      ["not_AAAAAAAAAAAAAA", "2026-05-21T15:42:13.000Z"],
    ]);

    const out = await fetchDocumentsForSync(
      { method: "api_key", token: "grn_test" },
      settings({ syncTranscripts: false }),
      {
        mode: "standard",
        includeTranscripts: false,
        knownUpdatedAtByGranolaId: known,
      }
    );

    // Only the list call was made; Get Note was skipped.
    expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(0);
  });

  it("treats a 404 on Get Note as a missing note (not an error)", async () => {
    const listPage = {
      notes: [
        {
          id: "not_gone",
          title: "Gone",
          web_url: "https://notes.granola.ai/d/00000000-0000-0000-0000-000000000000",
          updated_at: "2026-05-01T00:00:00.000Z",
        },
      ],
      hasMore: false,
      cursor: null,
    };
    mockRequestUrl
      .mockResolvedValueOnce({ status: 200, json: listPage, headers: {} })
      .mockResolvedValueOnce({ status: 404, json: {}, headers: {} });

    const out = await fetchDocumentsForSync(
      { method: "api_key", token: "grn_test" },
      settings({ syncTranscripts: false }),
      { mode: "standard", includeTranscripts: false }
    );

    expect(out).toEqual([]);
  });

  it("propagates 401 so the orchestrator can surface a clear error", async () => {
    mockRequestUrl.mockResolvedValueOnce({
      status: 401,
      json: { error: "unauthorized" },
      headers: { "granola-request-id": "req_xyz" },
    });

    await expect(
      fetchDocumentsForSync(
        { method: "api_key", token: "grn_revoked" },
        settings(),
        { mode: "standard" }
      )
    ).rejects.toMatchObject({ status: 401 });
  });
});
