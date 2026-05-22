import fs from "fs";
import path from "path";
import { requestUrl } from "obsidian";
import {
  listNotes,
  listAllNotes,
  getNote,
  listFolders,
  listAllFolders,
  setMinRequestSpacingMs,
  PublicApiError,
} from "../../src/services/publicGranolaApi";

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

describe("publicGranolaApi", () => {
  beforeAll(() => {
    setMinRequestSpacingMs(0);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("listNotes", () => {
    it("returns the parsed page using the real API field names (cursor / hasMore)", async () => {
      // Spec uses camelCase `hasMore` and bare `cursor`, not snake_case.
      // Locking the contract so a future schema typo doesn't silently break
      // pagination.
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
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
          cursor: "eyJjcmVkZW50aWFsfQ==",
          hasMore: true,
        },
        headers: {},
      });

      const result = await listNotes("grn_test", { pageSize: 30 });

      expect(result.notes).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBe("eyJjcmVkZW50aWFsfQ==");
    });

    it("sends the API key as a Bearer token and the expected query params", async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { notes: [], has_more: false },
        headers: {},
      });

      await listNotes("grn_test", {
        updatedAfter: "2026-05-01T00:00:00.000Z",
        cursor: "abc",
        pageSize: 25,
      });

      const call = mockRequestUrl.mock.calls[0][0];
      expect(call.headers.Authorization).toBe("Bearer grn_test");
      expect(call.method).toBe("GET");
      const url = new URL(call.url);
      expect(url.origin + url.pathname).toBe(
        "https://public-api.granola.ai/v1/notes"
      );
      expect(url.searchParams.get("updated_after")).toBe(
        "2026-05-01T00:00:00.000Z"
      );
      expect(url.searchParams.get("cursor")).toBe("abc");
      expect(url.searchParams.get("page_size")).toBe("25");
    });
  });

  describe("listAllNotes", () => {
    it("follows the cursor across pages", async () => {
      const first = loadFixture("list-notes-page.json");
      const last = loadFixture("list-notes-last-page.json");

      mockRequestUrl
        .mockResolvedValueOnce({ status: 200, json: first, headers: {} })
        .mockResolvedValueOnce({ status: 200, json: last, headers: {} });

      const notes = await listAllNotes("grn_test");

      expect(notes).toHaveLength(4);
      expect(mockRequestUrl).toHaveBeenCalledTimes(2);

      const secondCall = mockRequestUrl.mock.calls[1][0];
      const url = new URL(secondCall.url);
      expect(url.searchParams.get("cursor")).toBeTruthy();
    });

    it("stops paginating once hasMore is false", async () => {
      const last = loadFixture("list-notes-last-page.json");
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: last,
        headers: {},
      });

      await listAllNotes("grn_test");
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe("getNote", () => {
    it("requests transcript when includeTranscript=true", async () => {
      const fixture = loadFixture("get-note-with-transcript.json");
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: fixture,
        headers: {},
      });

      const note = await getNote("grn_test", "not_AAAAAAAAAAAAAA", {
        includeTranscript: true,
      });

      const call = mockRequestUrl.mock.calls[0][0];
      const url = new URL(call.url);
      expect(url.pathname).toBe("/v1/notes/not_AAAAAAAAAAAAAA");
      expect(url.searchParams.get("include")).toBe("transcript");
      expect(note.transcript).toHaveLength(2);
    });

    it("does not set include=transcript by default", async () => {
      const fixture = loadFixture("get-note.json");
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: fixture,
        headers: {},
      });

      await getNote("grn_test", "not_AAAAAAAAAAAAAA");

      const call = mockRequestUrl.mock.calls[0][0];
      const url = new URL(call.url);
      expect(url.searchParams.has("include")).toBe(false);
    });
  });

  describe("listFolders", () => {
    it("parses a folders response using the real `parent_folder_id` field name", async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          folders: [
            { id: "fol_a", object: "folder", name: "Strategy", parent_folder_id: null },
            { id: "fol_b", object: "folder", name: "Subteam", parent_folder_id: "fol_a" },
          ],
          cursor: null,
          hasMore: false,
        },
        headers: {},
      });

      const result = await listFolders("grn_test");
      expect(result.folders).toHaveLength(2);
      expect(result.folders[1].parent_folder_id).toBe("fol_a");
      expect(result.hasMore).toBe(false);
    });
  });

  describe("listAllFolders", () => {
    it("follows the cursor across pages and returns the flattened list", async () => {
      mockRequestUrl
        .mockResolvedValueOnce({
          status: 200,
          json: {
            folders: [
              { id: "fol_a", object: "folder", name: "A", parent_folder_id: null },
              { id: "fol_b", object: "folder", name: "B", parent_folder_id: null },
            ],
            cursor: "cur1",
            hasMore: true,
          },
          headers: {},
        })
        .mockResolvedValueOnce({
          status: 200,
          json: {
            folders: [
              { id: "fol_c", object: "folder", name: "C", parent_folder_id: "fol_a" },
            ],
            cursor: null,
            hasMore: false,
          },
          headers: {},
        });

      const folders = await listAllFolders("grn_test");

      expect(folders.map((f) => f.id)).toEqual(["fol_a", "fol_b", "fol_c"]);
      expect(mockRequestUrl).toHaveBeenCalledTimes(2);

      const secondCallUrl = new URL(mockRequestUrl.mock.calls[1][0].url);
      expect(secondCallUrl.searchParams.get("cursor")).toBe("cur1");
    });

    it("stops at one page when hasMore is false on the first response", async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: {
          folders: [
            { id: "fol_a", object: "folder", name: "A", parent_folder_id: null },
          ],
          cursor: null,
          hasMore: false,
        },
        headers: {},
      });

      const folders = await listAllFolders("grn_test");
      expect(folders).toHaveLength(1);
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("throws PublicApiError on 401 with the granola-request-id header", async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 401,
        json: { error: "unauthorized" },
        headers: { "granola-request-id": "req_abc" },
      });

      await expect(listNotes("grn_revoked")).rejects.toMatchObject({
        name: "PublicApiError",
        status: 401,
        requestId: "req_abc",
      });
    });

    it("throws PublicApiError on 429", async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 429,
        json: {},
        headers: {},
      });

      let caught: unknown;
      try {
        await getNote("grn_test", "not_x");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PublicApiError);
      expect((caught as PublicApiError).status).toBe(429);
    });

    it("throws on schema validation failure", async () => {
      mockRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { unexpected: "shape" },
        headers: {},
      });

      await expect(listNotes("grn_test")).rejects.toThrow(
        "Invalid response from Granola public API"
      );
    });
  });
});
