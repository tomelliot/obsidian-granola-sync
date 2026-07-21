# Granola Public API + BRAT Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace local-credential auth + internal Granola API with the official public API (`public-api.granola.ai/v1`) using a user-supplied API key in settings, and rebrand the fork as the BRAT-distributed plugin **Granola API Sync**.

**Architecture:** The auth layer (Keychain/DPAPI/keyring credential readers) is deleted and replaced by a settings field. `granolaApi.ts` is rewritten against the v1 endpoints (`GET /v1/notes` cursor-paginated summaries → per-note `GET /v1/notes/{id}?include=transcript` hydration → `GET /v1/folders`). The internal domain type `GranolaDoc` keeps its name but is redefined from v1 fields (`summary_markdown` as the body — the ProseMirror/HTML converters are deleted). File sync, path resolution, daily notes, and transcript formatting stay, with a one-time ID migration (old UUID ↔ new `not_…` id matched via `web_url`, falling back to target-path match).

**Tech Stack:** TypeScript, Obsidian plugin API (`requestUrl`), valibot, esbuild, Jest.

## Global Constraints

- Repo: `~/betaworks/obsidian-granola-sync`, branch off `main` → `public-api`.
- Plugin identity: id `granola-api-sync`, name `Granola API Sync`, author `Kaya Jones`, version `0.1.0`, minAppVersion `1.5.7`.
- API: base `https://public-api.granola.ai/v1`, header `Authorization: Bearer <key>`, keys start with `grn_`, `page_size` max 30, rate limit 5 req/s sustained (25/5 s burst) → ≥200 ms between sequential requests, honor 429 with retry.
- The public API only returns notes that have an AI summary + transcript; the note body is `summary_markdown` (fallback `summary_text`).
- `isDesktopOnly` stays `true` for 0.1.0 (debug logging still uses `fs`); mobile support is follow-up.
- `includePrivateNotes` and `includeSharedNotes` settings are removed (not representable in the public API; key scope governs access).
- Run all commands from `~/betaworks/obsidian-granola-sync`. Package manager is `pnpm`. Test command: `pnpm jest <file>`.
- Frequent commits; message prefix conventions follow the repo (`feat:`, `fix:`, `docs:`, `chore:`).

---

### Task 0: Branch + rebrand manifest/package/versions

**Files:**
- Modify: `manifest.json`, `versions.json`, `package.json` (name/version fields only)

**Interfaces:**
- Produces: plugin id `granola-api-sync` used by later tasks (README, esbuild DEV_PLUGIN_PATH docs).

- [ ] **Step 1: Create branch**

```bash
git checkout -b public-api
```

- [ ] **Step 2: Rewrite manifest.json**

```json
{
  "id": "granola-api-sync",
  "name": "Granola API Sync",
  "version": "0.1.0",
  "minAppVersion": "1.5.7",
  "description": "Sync Granola meeting notes into your vault using the official Granola API.",
  "author": "Kaya Jones",
  "authorUrl": "https://github.com/kayacancode",
  "isDesktopOnly": true
}
```

(No `fundingUrl`.)

- [ ] **Step 3: Rewrite versions.json**

```json
{
  "0.1.0": "1.5.7"
}
```

- [ ] **Step 4: Update package.json `name` to `granola-api-sync` and `version` to `0.1.0`** (leave scripts for now — Task 8 cleans them).

- [ ] **Step 5: Sanity check + commit**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json'))" && node -e "JSON.parse(require('fs').readFileSync('versions.json'))"`
Expected: no output (valid JSON).

```bash
git add manifest.json versions.json package.json
git commit -m "chore: rebrand as granola-api-sync 0.1.0"
```

---

### Task 1: v1 validation schemas + domain types

**Files:**
- Rewrite: `src/services/validationSchemas.ts`
- Rewrite: `src/services/granolaTypes.ts`
- Test: `tests/unit/validationSchemas.test.ts` (new)

**Interfaces:**
- Produces (used by Tasks 2–7):
  - `TranscriptEntry` = `{ speaker: { source: string; diarization_label?: string; name?: string }; text: string; start_time: string; end_time: string }`
  - `GranolaFolder` = `{ id: string; name: string; parent_folder_id: string | null }`
  - `GranolaDoc` = `{ id: string; title: string | null; created_at?: string; updated_at?: string; web_url?: string; people?: { attendees?: Array<{ name?: string; email?: string }> }; summary_markdown?: string | null; summary_text?: string; folder_ids?: string[]; transcript?: TranscriptEntry[] | null }`
  - `NoteSummaryV1` = `{ id: string; title: string | null; created_at: string; updated_at: string }`
  - Schemas: `NoteSummarySchema`, `NoteDetailSchema`, `ListNotesResponseSchema`, `ListFoldersResponseSchema`, `FolderSchema`, `TranscriptEntrySchema`

- [ ] **Step 1: Write failing test** `tests/unit/validationSchemas.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify failure** — `pnpm jest tests/unit/validationSchemas.test.ts` → FAIL (`ListNotesResponseSchema` not exported).

- [ ] **Step 3: Rewrite `src/services/validationSchemas.ts`**

```ts
import * as v from "valibot";

// --- Granola public API v1 schemas (https://public-api.granola.ai/v1) ---

export const UserSchema = v.object({
  name: v.nullish(v.string()),
  email: v.nullish(v.string()),
});

export const FolderSchema = v.object({
  id: v.string(),
  name: v.string(),
  parent_folder_id: v.nullish(v.string()),
});

export const SpeakerSchema = v.object({
  source: v.string(),
  diarization_label: v.optional(v.string()),
  name: v.optional(v.string()),
});

export const TranscriptEntrySchema = v.object({
  speaker: SpeakerSchema,
  text: v.string(),
  start_time: v.string(),
  end_time: v.string(),
});

export const NoteSummarySchema = v.object({
  id: v.string(),
  title: v.nullish(v.string()),
  created_at: v.string(),
  updated_at: v.string(),
});

export const NoteDetailSchema = v.object({
  id: v.string(),
  title: v.nullish(v.string()),
  created_at: v.string(),
  updated_at: v.string(),
  web_url: v.nullish(v.string()),
  attendees: v.optional(v.array(UserSchema), []),
  folder_membership: v.optional(v.array(FolderSchema), []),
  summary_text: v.nullish(v.string()),
  summary_markdown: v.nullish(v.string()),
  transcript: v.nullish(v.array(TranscriptEntrySchema)),
});

export const ListNotesResponseSchema = v.object({
  notes: v.array(NoteSummarySchema),
  hasMore: v.boolean(),
  cursor: v.nullish(v.string()),
});

export const ListFoldersResponseSchema = v.object({
  folders: v.array(FolderSchema),
  hasMore: v.boolean(),
  cursor: v.nullish(v.string()),
});
```

Note: schemas are deliberately loose (no `v.literal("note")`, extra keys ignored) so additive API changes don't break syncs. `calendar_event` and `owner` are intentionally unmodeled — nothing consumes them, and valibot objects ignore unknown keys.

- [ ] **Step 4: Rewrite `src/services/granolaTypes.ts`**

```ts
import * as v from "valibot";
import {
  TranscriptEntrySchema,
  FolderSchema,
  NoteSummarySchema,
  NoteDetailSchema,
} from "./validationSchemas";

export type TranscriptEntry = v.InferOutput<typeof TranscriptEntrySchema>;
export type GranolaFolder = v.InferOutput<typeof FolderSchema>;
export type NoteSummaryV1 = v.InferOutput<typeof NoteSummarySchema>;
export type NoteDetailV1 = v.InferOutput<typeof NoteDetailSchema>;

/**
 * Internal domain shape consumed by the sync pipeline (processor, file sync,
 * daily notes, path resolution). Built from a v1 NoteDetail by
 * noteDetailToGranolaDoc() in granolaApi.ts.
 */
export interface GranolaDoc {
  id: string;
  title: string | null;
  created_at?: string;
  updated_at?: string;
  /** Granola web app URL; its trailing UUID is the legacy internal doc id. */
  web_url?: string;
  people?: {
    attendees?: Array<{ name?: string; email?: string }>;
  };
  summary_markdown?: string | null;
  summary_text?: string;
  /** IDs of folders this note belongs to (fol_…). */
  folder_ids?: string[];
  /** Present when fetched with include=transcript. */
  transcript?: TranscriptEntry[] | null;
}
```

- [ ] **Step 5: Run** `pnpm jest tests/unit/validationSchemas.test.ts` → PASS. (Other suites still break — fine, they're fixed in their tasks.)

- [ ] **Step 6: Commit** — `git add src/services/validationSchemas.ts src/services/granolaTypes.ts tests/unit/validationSchemas.test.ts && git commit -m "feat: v1 public API schemas and domain types"`

---

### Task 2: API client rewrite (`granolaApi.ts`)

**Files:**
- Rewrite: `src/services/granolaApi.ts`
- Rewrite test: `tests/unit/granolaApi.test.ts`

**Interfaces:**
- Consumes: schemas/types from Task 1.
- Produces (used by main.ts in Task 7):
  - `listAllNoteSummaries(apiKey: string, daysBack: number): Promise<NoteSummaryV1[]>` — cursor-paginates `/notes` with `created_after` when `daysBack > 0`.
  - `fetchNoteDetail(apiKey: string, noteId: string, includeTranscript: boolean): Promise<GranolaDoc>`
  - `listAllFolders(apiKey: string): Promise<GranolaFolder[]>`
  - `verifyApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; status?: number; message: string }>`
  - `noteDetailToGranolaDoc(detail: NoteDetailV1): GranolaDoc` (exported for tests)
  - `GranolaAuthError` class (thrown on 401) — re-exports types `GranolaDoc`, `TranscriptEntry`, `GranolaFolder`, `NoteSummaryV1` so existing `from "./granolaApi"` imports keep working.

- [ ] **Step 1: Rewrite `tests/unit/granolaApi.test.ts`**

The obsidian mock lives at `tests/__mocks__/obsidian.ts`; mock `requestUrl` per-test via `jest.mock`. Key behaviors to cover: pagination, `created_after` param, throttling not asserted (timing), 429 retry, 401 → `GranolaAuthError`, detail mapping.

```ts
import { requestUrl } from "obsidian";
import {
  listAllNoteSummaries,
  fetchNoteDetail,
  listAllFolders,
  verifyApiKey,
  noteDetailToGranolaDoc,
  GranolaAuthError,
  __setRequestDelayMs,
} from "../../src/services/granolaApi";

jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
}));

const mockRequestUrl = requestUrl as jest.Mock;

const summary = (id: string) => ({
  id,
  title: "T",
  created_at: "2026-01-27T15:30:00Z",
  updated_at: "2026-01-27T16:45:00Z",
});

beforeEach(() => {
  mockRequestUrl.mockReset();
  __setRequestDelayMs(0); // no throttling in tests
});

describe("listAllNoteSummaries", () => {
  test("follows cursors until hasMore is false", async () => {
    mockRequestUrl
      .mockResolvedValueOnce({ status: 200, json: { notes: [summary("not_a")], hasMore: true, cursor: "c1" } })
      .mockResolvedValueOnce({ status: 200, json: { notes: [summary("not_b")], hasMore: false, cursor: null } });

    const notes = await listAllNoteSummaries("grn_key", 0);
    expect(notes.map((n) => n.id)).toEqual(["not_a", "not_b"]);
    expect(mockRequestUrl.mock.calls[1][0].url).toContain("cursor=c1");
  });

  test("passes created_after when daysBack > 0", async () => {
    mockRequestUrl.mockResolvedValueOnce({ status: 200, json: { notes: [], hasMore: false, cursor: null } });
    await listAllNoteSummaries("grn_key", 7);
    expect(mockRequestUrl.mock.calls[0][0].url).toContain("created_after=");
  });

  test("sends bearer header and page_size 30", async () => {
    mockRequestUrl.mockResolvedValueOnce({ status: 200, json: { notes: [], hasMore: false, cursor: null } });
    await listAllNoteSummaries("grn_key", 0);
    const req = mockRequestUrl.mock.calls[0][0];
    expect(req.headers.Authorization).toBe("Bearer grn_key");
    expect(req.url).toContain("page_size=30");
  });

  test("retries once on 429 then succeeds", async () => {
    mockRequestUrl
      .mockResolvedValueOnce({ status: 429, json: {} })
      .mockResolvedValueOnce({ status: 200, json: { notes: [summary("not_a")], hasMore: false, cursor: null } });
    const notes = await listAllNoteSummaries("grn_key", 0);
    expect(notes).toHaveLength(1);
    expect(mockRequestUrl).toHaveBeenCalledTimes(2);
  });

  test("throws GranolaAuthError on 401", async () => {
    mockRequestUrl.mockResolvedValueOnce({ status: 401, json: {} });
    await expect(listAllNoteSummaries("grn_key", 0)).rejects.toBeInstanceOf(GranolaAuthError);
  });
});

describe("fetchNoteDetail", () => {
  const detail = {
    ...summary("not_a"),
    web_url: "https://notes.granola.ai/d/f3e45e0f-24cc-480b-9a6c-8b1f5e3d7a2c",
    calendar_event: null,
    attendees: [{ name: "Oat", email: "oat@granola.ai" }],
    folder_membership: [{ id: "fol_1", object: "folder", name: "F", parent_folder_id: null }],
    summary_text: "plain",
    summary_markdown: "## md",
    transcript: null,
  };

  test("maps detail into GranolaDoc", async () => {
    mockRequestUrl.mockResolvedValueOnce({ status: 200, json: detail });
    const doc = await fetchNoteDetail("grn_key", "not_a", false);
    expect(doc.id).toBe("not_a");
    expect(doc.summary_markdown).toBe("## md");
    expect(doc.people?.attendees).toEqual([{ name: "Oat", email: "oat@granola.ai" }]);
    expect(doc.folder_ids).toEqual(["fol_1"]);
    expect(mockRequestUrl.mock.calls[0][0].url).not.toContain("include=");
  });

  test("requests transcript when asked", async () => {
    mockRequestUrl.mockResolvedValueOnce({ status: 200, json: detail });
    await fetchNoteDetail("grn_key", "not_a", true);
    expect(mockRequestUrl.mock.calls[0][0].url).toContain("include=transcript");
  });
});

describe("listAllFolders", () => {
  test("paginates folders", async () => {
    mockRequestUrl
      .mockResolvedValueOnce({ status: 200, json: { folders: [{ id: "fol_1", object: "folder", name: "A", parent_folder_id: null }], hasMore: true, cursor: "c" } })
      .mockResolvedValueOnce({ status: 200, json: { folders: [{ id: "fol_2", object: "folder", name: "B", parent_folder_id: "fol_1" }], hasMore: false, cursor: null } });
    const folders = await listAllFolders("grn_key");
    expect(folders.map((f) => f.id)).toEqual(["fol_1", "fol_2"]);
  });
});

describe("verifyApiKey", () => {
  test("ok on 200", async () => {
    mockRequestUrl.mockResolvedValueOnce({ status: 200, json: { notes: [], hasMore: false, cursor: null } });
    expect(await verifyApiKey("grn_key")).toEqual({ ok: true });
  });

  test("reports invalid key on 401", async () => {
    mockRequestUrl.mockResolvedValueOnce({ status: 401, json: {} });
    const res = await verifyApiKey("grn_bad");
    expect(res.ok).toBe(false);
  });
});

describe("noteDetailToGranolaDoc", () => {
  test("extracts fields", () => {
    const doc = noteDetailToGranolaDoc({
      id: "not_a",
      title: null,
      created_at: "2026-01-27T15:30:00Z",
      updated_at: "2026-01-27T16:45:00Z",
      web_url: "https://notes.granola.ai/d/abc",
      attendees: [],
      folder_membership: [],
      summary_text: "s",
      summary_markdown: null,
      transcript: null,
    });
    expect(doc.title).toBeNull();
    expect(doc.summary_text).toBe("s");
  });
});
```

- [ ] **Step 2: Run** `pnpm jest tests/unit/granolaApi.test.ts` → FAIL (functions not exported).

- [ ] **Step 3: Rewrite `src/services/granolaApi.ts`**

Notes on shape: `requestUrl` with `throw: false` returns status without throwing; build a small `apiGet(apiKey, path)` helper that handles headers, throttle, 429 retry (max 3, `2^attempt * 1000` ms, no Retry-After header access via requestUrl — fixed backoff), 401 → `GranolaAuthError`, other ≥400 → generic `Error` with status attached.

```ts
import { requestUrl } from "obsidian";
import * as v from "valibot";
import {
  ListNotesResponseSchema,
  ListFoldersResponseSchema,
  NoteDetailSchema,
} from "./validationSchemas";
import { log } from "../utils/logger";

export type {
  GranolaDoc,
  TranscriptEntry,
  GranolaFolder,
  NoteSummaryV1,
  NoteDetailV1,
} from "./granolaTypes";
import type { GranolaDoc, GranolaFolder, NoteSummaryV1, NoteDetailV1 } from "./granolaTypes";

const API_BASE = "https://public-api.granola.ai/v1";
const PAGE_SIZE = 30;
const MAX_RETRIES = 3;

/** Sustained public-API budget is 5 req/s; stay under it between calls. */
let requestDelayMs = 220;
/** Test hook: disable throttling in unit tests. */
export function __setRequestDelayMs(ms: number): void {
  requestDelayMs = ms;
}

export class GranolaAuthError extends Error {
  constructor() {
    super("Granola API rejected the API key (401)");
    this.name = "GranolaAuthError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiGet(apiKey: string, pathAndQuery: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    if (requestDelayMs > 0) await sleep(requestDelayMs);
    const response = await requestUrl({
      url: `${API_BASE}${pathAndQuery}`,
      method: "GET",
      throw: false,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": `GranolaApiSyncObsidian/${PLUGIN_VERSION}`,
        "X-Client-Version": `GranolaApiSyncObsidian/${PLUGIN_VERSION}`,
      },
    });

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const backoff = Math.pow(2, attempt) * 1000;
      log.debug(`429 from Granola API, retrying in ${backoff}ms (${pathAndQuery})`);
      await sleep(backoff);
      continue;
    }
    if (response.status === 401) throw new GranolaAuthError();
    if (response.status >= 400) {
      const error = new Error(`Granola API error ${response.status} for ${pathAndQuery}`);
      (error as Error & { status: number }).status = response.status;
      throw error;
    }
    return response.json as unknown;
  }
}

function parseOrThrow<TSchema extends v.GenericSchema>(
  schema: TSchema,
  data: unknown,
  label: string
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, data);
  if (!result.success) {
    log.error(`Validation failed for ${label}:`);
    log.error(JSON.stringify(result.issues, null, 2));
    throw new Error(`Invalid response from Granola API (${label})`);
  }
  return result.output;
}

/** Maps a v1 note detail into the internal GranolaDoc domain shape. */
export function noteDetailToGranolaDoc(detail: NoteDetailV1): GranolaDoc {
  return {
    id: detail.id,
    title: detail.title ?? null,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    web_url: detail.web_url ?? undefined,
    people: {
      attendees: (detail.attendees ?? []).map((a) => ({
        name: a.name ?? undefined,
        email: a.email ?? undefined,
      })),
    },
    summary_markdown: detail.summary_markdown,
    summary_text: detail.summary_text ?? undefined,
    folder_ids: (detail.folder_membership ?? []).map((f) => f.id),
    transcript: detail.transcript ?? null,
  };
}

/**
 * Lists all accessible note summaries, following cursors.
 * daysBack > 0 adds created_after to limit server-side.
 */
export async function listAllNoteSummaries(
  apiKey: string,
  daysBack: number
): Promise<NoteSummaryV1[]> {
  const params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
  if (daysBack > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    params.set("created_after", cutoff.toISOString());
  }

  const notes: NoteSummaryV1[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    if (cursor) params.set("cursor", cursor);
    const json = await apiGet(apiKey, `/notes?${params.toString()}`);
    const page = parseOrThrow(ListNotesResponseSchema, json, "ListNotesResponseSchema");
    notes.push(...page.notes);
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);

  log.debug(`Listed ${notes.length} note summary/ies`);
  return notes;
}

/** Fetches one note's full detail, optionally including the transcript. */
export async function fetchNoteDetail(
  apiKey: string,
  noteId: string,
  includeTranscript: boolean
): Promise<GranolaDoc> {
  const query = includeTranscript ? "?include=transcript" : "";
  const json = await apiGet(apiKey, `/notes/${noteId}${query}`);
  const detail = parseOrThrow(NoteDetailSchema, json, "NoteDetailSchema");
  return noteDetailToGranolaDoc(detail);
}

/** Lists all folders, following cursors. */
export async function listAllFolders(apiKey: string): Promise<GranolaFolder[]> {
  const folders: GranolaFolder[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    const json = await apiGet(apiKey, `/folders?${params.toString()}`);
    const page = parseOrThrow(ListFoldersResponseSchema, json, "ListFoldersResponseSchema");
    folders.push(...page.folders);
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  return folders;
}

/** Cheap connectivity/auth check used by the settings "Test connection" button. */
export async function verifyApiKey(
  apiKey: string
): Promise<{ ok: true } | { ok: false; status?: number; message: string }> {
  try {
    const json = await apiGet(apiKey, "/notes?page_size=1");
    parseOrThrow(ListNotesResponseSchema, json, "ListNotesResponseSchema");
    return { ok: true };
  } catch (error) {
    if (error instanceof GranolaAuthError) {
      return { ok: false, status: 401, message: "Invalid API key." };
    }
    const status = (error as { status?: number }).status;
    return {
      ok: false,
      status,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 4: Run** `pnpm jest tests/unit/granolaApi.test.ts` → PASS. Note: the 429 test incurs a real 1 s backoff — acceptable; if it annoys, wrap with `jest.useFakeTimers` later, don't block.

- [ ] **Step 5: Commit** — `git add src/services/granolaApi.ts tests/unit/granolaApi.test.ts && git commit -m "feat: rewrite API client against Granola public v1 API"`

---

### Task 3: Transcript formatter on v1 entries

**Files:**
- Modify: `src/services/transcriptFormatter.ts`
- Modify test: `tests/unit/transcriptFormatter.test.ts`

**Interfaces:**
- Consumes: `TranscriptEntry` (v1 shape) from Task 1.
- Produces: same exported names, same signatures — `formatTranscriptBody(transcriptData: TranscriptEntry[]): string` and `formatTranscriptBySpeaker(transcriptData, title, docId, createdAt, updatedAt, attendees, transcriptLink)`.

Field migration inside the formatter: `entry.source` → `entry.speaker.source`, `entry.start_timestamp` → `entry.start_time`. Speaker label resolution becomes:

```ts
const getSpeaker = (entry: TranscriptEntry) =>
  entry.speaker.name ??
  entry.speaker.diarization_label ??
  (entry.speaker.source === "microphone" ? "You" : "Guest");
```

- [ ] **Step 1: Update tests** — in `tests/unit/transcriptFormatter.test.ts`, replace every fixture entry of the old shape (`{ document_id, start_timestamp, text, source, id, is_final, end_timestamp }`) with the v1 shape (`{ speaker: { source: "microphone" }, text, start_time, end_time }`), keeping the scenarios. Add one new test: entries with `speaker.name: "Alice Smith"` produce `### Alice Smith (…)` headings.
- [ ] **Step 2: Run** `pnpm jest tests/unit/transcriptFormatter.test.ts` → FAIL (type/shape errors).
- [ ] **Step 3: Update `transcriptFormatter.ts`** — apply the field renames throughout both exported functions (grouping logic unchanged; group key is the resolved speaker label).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: format transcripts from v1 entries with speaker names"`

---

### Task 4: Document processor on `summary_markdown`; delete converters

**Files:**
- Modify: `src/services/documentProcessor.ts`, `src/utils/dateUtils.ts`
- Delete: `src/services/prosemirrorMarkdown.ts`, `src/services/htmlMarkdown.ts`, `tests/unit/prosemirrorMarkdown.test.ts`, `tests/unit/htmlMarkdown.test.ts`, `tests/unit/proseMirror-examples/`, `tests/unit/htmlMarkdown-examples/`
- Modify tests: `tests/unit/documentProcessor.test.ts`, `tests/unit/dateUtils.test.ts`

**Interfaces:**
- Consumes: new `GranolaDoc`.
- Produces (unchanged signatures used by main.ts/fileSyncService/dailyNoteBuilder): `DocumentProcessor` constructor now takes `{ syncTranscripts: boolean }` (drop `includePrivateNotes`); `buildNoteBody(doc, {headingLevel})`, `prepareNote(doc, folders?)`, `prepareCombinedNote(doc, transcriptContent, folders?)`, `prepareTranscript(doc, transcriptContent)`, `extractNoteForDailyNote(doc, transcriptLink?, folders?)`, `buildNoteMetadata(doc, options)`. `NoteMetadata` gains `webUrl?: string`.

- [ ] **Step 1: Update `dateUtils.ts`** — `getEffectiveUpdatedAt` loses the `last_viewed_panel` logic:

```ts
export function getEffectiveUpdatedAt(doc: GranolaDoc): string | undefined {
  return doc.updated_at ?? undefined;
}
```

Update `tests/unit/dateUtils.test.ts`: remove panel-timestamp cases; keep/adjust the rest.

- [ ] **Step 2: Update `documentProcessor.test.ts`** — replace fixtures: docs get `summary_markdown: "## Heading\n\nBody"` instead of `last_viewed_panel`. Scenarios to keep/add:
  - `buildNoteBody` returns `summary_markdown` verbatim.
  - Falls back to `summary_text` when `summary_markdown` is null/absent.
  - Returns `null` when both are missing/empty (doc skipped).
  - `prepareNote` frontmatter contains `granola_id`, `title`, `type: note`, `created`, `updated`, `attendees`, and new `web_url: <url>` when `doc.web_url` is set.
  - Remove all `includePrivateNotes` / "Private Notes" tests.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** in `documentProcessor.ts`:
  - Remove imports of `convertProsemirrorToMarkdown` / `convertHtmlToMarkdown`.
  - `DocumentProcessorSettings` = `{ syncTranscripts: boolean }`.
  - `buildNoteBody`:

```ts
buildNoteBody(doc: GranolaDoc, _options: BodyOptions): string | null {
  const markdown = doc.summary_markdown?.trim()
    ? doc.summary_markdown
    : doc.summary_text?.trim()
    ? doc.summary_text
    : null;
  return markdown;
}
```

  (Keep the `BodyOptions` parameter for signature stability; heading levels are the API's own markdown now.)
  - In `buildNoteMetadata`, add `webUrl: doc.web_url` to the returned object; in `prepareNote` and `prepareCombinedNote`, after the `attendees` line push `web_url: ${metadata.webUrl}` when set.
  - Remove both `hasPrivateNotes` blocks (in `buildNoteBody` and `prepareCombinedNote` — combined files now always emit `## Note`).
- [ ] **Step 5: Delete converters** — `git rm src/services/prosemirrorMarkdown.ts src/services/htmlMarkdown.ts tests/unit/prosemirrorMarkdown.test.ts tests/unit/htmlMarkdown.test.ts && git rm -r tests/unit/proseMirror-examples tests/unit/htmlMarkdown-examples`
- [ ] **Step 6: Run** `pnpm jest tests/unit/documentProcessor.test.ts tests/unit/dateUtils.test.ts` → PASS.
- [ ] **Step 7: Commit** — `"feat: render note bodies from summary_markdown; drop ProseMirror/HTML converters"`

---

### Task 5: Folder map from `/v1/folders` + note membership

**Files:**
- Modify: `src/services/folderMapBuilder.ts`
- Modify test: `tests/unit/folderMapBuilder.test.ts`

**Interfaces:**
- Consumes: `listAllFolders`, `GranolaFolder`, `GranolaDoc` (docs now carry `folder_ids`).
- Produces: `buildFolderMap(apiKey: string, docs: GranolaDoc[]): Promise<FolderMapData>` — NEW signature (was `buildFolderMap(accessToken)`). `FolderMapData`, `FolderInfo`, `diffFolderMaps`, `resolveFolderPath` unchanged.

- [ ] **Step 1: Update tests** — mock `listAllFolders` (jest.mock `./granolaApi`) returning `[{id:"fol_p", name:"Clients", parent_folder_id:null},{id:"fol_c", name:"Good2Go", parent_folder_id:"fol_p"}]`; docs `[{id:"not_1", folder_ids:["fol_c"], title:"t"}]`. Assert `docFolders` is `{ not_1: ["Clients/Good2Go"] }` and `folders` has both entries with correct `parentId`. Keep existing `resolveFolderPath`/`diffFolderMaps` tests untouched.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — replace the two internal fetches:

```ts
export async function buildFolderMap(
  apiKey: string,
  docs: GranolaDoc[]
): Promise<FolderMapData> {
  const folderList = await listAllFolders(apiKey);

  const folders: Record<string, FolderInfo> = {};
  for (const folder of folderList) {
    folders[folder.id] = {
      title: folder.name,
      parentId: folder.parent_folder_id ?? null,
    };
  }

  const docFolders: Record<string, string[]> = {};
  for (const doc of docs) {
    for (const folderId of doc.folder_ids ?? []) {
      const folderPath = resolveFolderPath(folderId, folders);
      if (!folderPath) continue;
      (docFolders[doc.id] ??= []).push(folderPath);
    }
  }

  return { folders, docFolders, lastUpdated: Date.now() };
}
```

(Imports become `listAllFolders` + types; drop `fetchDocumentListsMetadata`/`fetchDocumentList`.)
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `"feat: build folder map from v1 folders and note membership"`

---

### Task 6: File sync — drop attachments, add legacy-ID migration

**Files:**
- Modify: `src/services/fileSyncService.ts`
- Modify test: `tests/unit/fileSyncService.test.ts`

**Interfaces:**
- Consumes: new `GranolaDoc` (`web_url`).
- Produces: existing API unchanged (`buildCache`, `findByGranolaId`, `isRemoteNewer`, `saveNoteToDisk`, `saveCombinedNoteToDisk`, `saveTranscriptToDisk`, `getGranolaIdByPath`) plus NEW exported helper `extractLegacyIdFromWebUrl(webUrl: string | undefined): string | null`. `appendImageEmbedsForAttachments` is deleted (public API has no attachments).

Migration behavior (inside the save path, `saveFileToDisk`-equivalent private method that currently does `findByGranolaId` → create/update):

1. Look up by `doc.id` (new `not_…` id) — existing behavior.
2. Miss → extract legacy UUID from `doc.web_url` (`https://notes.granola.ai/d/<uuid>` → `<uuid>`); look that up in the same cache. Hit → treat as the existing file: update in place (content already carries the new `granola_id` in frontmatter, so the write rewrites it), then re-register the cache entry under the new id and drop the old.
3. Miss → compute target path; if a file exists there AND `getGranolaIdByPath(path)` returns non-null (it's a Granola-synced file), update that file in place and remap the cache.
4. Otherwise → create (existing collision handling).

```ts
const LEGACY_WEB_URL_RE = /\/d\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function extractLegacyIdFromWebUrl(webUrl: string | undefined): string | null {
  if (!webUrl) return null;
  const match = webUrl.match(LEGACY_WEB_URL_RE);
  return match ? match[1] : null;
}
```

- [ ] **Step 1: Add failing tests** in `fileSyncService.test.ts` (reuse the suite's existing vault/cache mocks):
  - `extractLegacyIdFromWebUrl` returns the UUID for a valid URL, null for undefined/malformed.
  - Saving a doc whose new id is unknown but whose `web_url` UUID matches an existing file's `granola_id` **updates that file** (no new file created) and subsequent `findByGranolaId(newId, type)` returns it.
  - Saving a doc with no id/legacy match but whose computed path collides with an existing Granola-synced file updates in place.
  - Saving a doc with no match at all creates a new file (existing behavior still green).
  - Remove attachment-embed tests.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — add the helper + the two fallback lookups in the shared save method; delete `appendImageEmbedsForAttachments` and any attachment-related private helpers; update the cache-remap (`updateCache` with new id after a legacy-match update).
- [ ] **Step 4: Run** the full file `pnpm jest tests/unit/fileSyncService.test.ts` → PASS.
- [ ] **Step 5: Commit** — `"feat: migrate existing notes to public-API ids via web_url and path matching"`

---

### Task 7: Settings — API key field, drop dead settings, new settings UI

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/unit/settings.test.ts` (new — migration function only; the Tab UI is not unit-tested, consistent with the existing suite)

**Interfaces:**
- Consumes: `verifyApiKey` from Task 2.
- Produces (used by main.ts): `GranolaSyncSettings.apiKey: string` (default `""`); `includePrivateNotes` and `includeSharedNotes` removed from the type and `DEFAULT_SETTINGS`; exported `scrubRemovedSettings(loaded: Record<string, unknown>): void` that deletes the two dead keys from a loaded settings object.

- [ ] **Step 1: Write failing test** `tests/unit/settings.test.ts`:

```ts
import { DEFAULT_SETTINGS, scrubRemovedSettings } from "../../src/settings";

describe("settings", () => {
  test("defaults include empty apiKey", () => {
    expect(DEFAULT_SETTINGS.apiKey).toBe("");
  });

  test("scrubRemovedSettings drops dead fields", () => {
    const loaded: Record<string, unknown> = {
      apiKey: "grn_x",
      includePrivateNotes: true,
      includeSharedNotes: false,
      syncNotes: true,
    };
    scrubRemovedSettings(loaded);
    expect(loaded).toEqual({ apiKey: "grn_x", syncNotes: true });
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement in `settings.ts`:**
  - `FilterSettings`: remove `includeSharedNotes`. `NoteSettings`: remove `includePrivateNotes`. Add to the `GranolaSyncSettings` intersection: `apiKey: string`.
  - `DEFAULT_SETTINGS`: add `apiKey: ""`, delete the two removed keys.
  - Add:

```ts
/** Settings removed in the public-API rewrite; deleted from loaded data on startup. */
export function scrubRemovedSettings(loaded: Record<string, unknown>): void {
  delete loaded.includePrivateNotes;
  delete loaded.includeSharedNotes;
}
```

  - **Settings tab changes** (in `display()`):
    - At the very top, before "Periodic sync enabled", add:

```ts
new Setting(containerEl)
  .setName("Granola API key")
  .setDesc(
    "Create a key in the Granola desktop app under Settings → Connectors → API keys (scope: Personal notes), then paste it here."
  )
  .addText((text) => {
    text.inputEl.type = "password";
    text
      .setPlaceholder("grn_…")
      .setValue(this.plugin.settings.apiKey)
      .onChange(async (value) => {
        this.plugin.settings.apiKey = value.trim();
        await this.plugin.saveSettings();
      });
  })
  .addButton((button) =>
    button.setButtonText("Test connection").onClick(async () => {
      const key = this.plugin.settings.apiKey;
      if (!key) {
        new Notice("Enter an API key first.");
        return;
      }
      button.setDisabled(true);
      const result = await verifyApiKey(key);
      button.setDisabled(false);
      if (result.ok) {
        new Notice("Granola API connection OK.");
      } else {
        new Notice(`Granola API connection failed: ${result.message}`, 8000);
      }
    })
  );
```

    - Remove the "Include private notes" Setting block and the "Include shared notes" Setting block.
    - Support section: delete the Buy-Me-a-Coffee Setting entirely; point the GitHub button at `https://github.com/kayacancode/obsidian-granola-sync/`. Remove the now-unused `bmcButtonSvg` import (keep `githubLogoSvg` + `appendSvg`).
    - Import `verifyApiKey` from `./services/granolaApi`.
- [ ] **Step 4: Run** `pnpm jest tests/unit/settings.test.ts` → PASS; also `pnpm tsc -p . -noEmit -skipLibCheck 2>&1 | head -40` to survey remaining breakage (main.ts/documentProcessor references are expected until Task 8 — only confirm settings.ts itself is clean).
- [ ] **Step 5: Commit** — `"feat: API key setting with test-connection button; drop private/shared-notes toggles"`

---

### Task 8: main.ts sync rewrite + delete credential stack + build cleanup

**Files:**
- Modify: `src/main.ts`, `esbuild.config.mjs`, `package.json`
- Delete: `src/services/credentials.ts`, `src/services/granolaCredentialsCrypto.ts`, `src/services/dpapiLoader.ts`, `src/services/keyringLoader.ts`, `src/services/credentialsErrorPresenter.ts`, `src/ui/keychainPermissionModal.ts`, `scripts/generateEmbeddedDpapiBinaries.mjs`, `scripts/generateEmbeddedKeyringBinaries.mjs`, `tests/unit/credentials.test.ts`, `tests/unit/credentialsErrorPresenter.test.ts`, `tests/unit/granolaCredentialsCrypto.test.ts` (+ any `src/services/embedded*Binaries.ts` generated files)
- Modify test: `tests/unit/main.test.ts`

**Interfaces:**
- Consumes: `listAllNoteSummaries`, `fetchNoteDetail`, `GranolaAuthError`, `buildFolderMap(apiKey, docs)`, `scrubRemovedSettings`, `settings.apiKey`.
- Produces: `sync()` behavior — the only externally visible surface (command + periodic sync unchanged).

- [ ] **Step 1: Update `tests/unit/main.test.ts`** — follow the existing suite's mocking style. Scenarios:
  - `sync()` with empty `apiKey` → shows a Notice containing "API key" and makes no API calls.
  - `sync()` fetches summaries, hydrates only stale/new notes (mock `fileSyncService.isRemoteNewer` false for one id → `fetchNoteDetail` not called for it in standard mode).
  - `GranolaAuthError` from the list call → Notice containing "API key", sync aborts.
  - Remove credential-loading test cases.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Rewrite the fetch phase of `sync()`** in `main.ts`:
  - Delete imports of `credentials`, `credentialsErrorPresenter`, `granolaCredentialsCrypto` (`setPluginDirectory` call included), `KeychainPermissionModal`, `fetchGranolaTranscript`, `getAllDocuments`, `getRecentDocuments`; import `listAllNoteSummaries`, `fetchNoteDetail`, `GranolaAuthError` and `scrubRemovedSettings`.
  - In `loadSettings()`, after merging, call `scrubRemovedSettings(mergedSettings as unknown as Record<string, unknown>)` before assigning.
  - In `initializeServices()`, DocumentProcessor construction becomes `new DocumentProcessor({ syncTranscripts: this.settings.syncTranscripts }, this.pathResolver)`.
  - New fetch flow replacing the credentials block + document fetch + folder map + transcript phases:

```ts
async sync(options: { mode?: "standard" | "full" } = {}) {
  const mode = options.mode ?? "standard";
  log.debug(`Sync started — mode=${mode}, daysBack=${this.settings.syncDaysBack}`);

  const apiKey = this.settings.apiKey;
  if (!apiKey) {
    new Notice(
      "Granola sync: No API key configured. Create one in Granola → Settings → Connectors → API keys, then paste it in the plugin settings.",
      10000
    );
    return;
  }

  showStatusBar(this, "Granola sync: Syncing...");
  await this.fileSyncService.buildCache();

  const needTranscripts = this.settings.syncTranscripts;
  const isCombinedMode = needTranscripts && this.settings.transcriptHandling === "combined";
  const noteType = isCombinedMode ? "combined" : "note";

  let documents: GranolaDoc[] = [];
  try {
    // Phase 1: cheap summary listing (id/title/timestamps only)
    let summaries = await listAllNoteSummaries(
      apiKey,
      mode === "full" ? 0 : this.settings.syncDaysBack
    );
    summaries = filterSummariesByTitle(
      summaries,
      this.settings.titleFilterMode,
      this.settings.titleFilterKeyword
    );

    // Phase 2: hydrate only notes that need work (rate-limit friendly)
    const toHydrate = summaries.filter((s) => {
      if (mode === "full") return true;
      const existing = this.fileSyncService.findByGranolaId(s.id, noteType);
      if (!existing) return true; // new note (or legacy file — resolved at save time)
      return this.fileSyncService.isRemoteNewer(s.id, s.updated_at, noteType);
    });
    log.debug(`Hydrating ${toHydrate.length} of ${summaries.length} note(s)`);

    let hydratedCount = 0;
    for (const s of toHydrate) {
      hydratedCount++;
      showStatusBar(this, `Granola sync: Fetching ${hydratedCount}/${toHydrate.length}`);
      documents.push(await fetchNoteDetail(apiKey, s.id, needTranscripts));
    }
  } catch (error: unknown) {
    if (error instanceof GranolaAuthError) {
      new Notice(
        "Granola sync error: The Granola API rejected your API key. Check it in the plugin settings.",
        10000
      );
    } else {
      const errorStatus = (error as { status?: number })?.status;
      if (errorStatus && errorStatus >= 500) {
        new Notice("Granola sync error: Granola API server error. Please try again later.", 10000);
      } else {
        new Notice(
          "Granola sync error: Failed to fetch notes from the Granola API. Check your internet connection.",
          10000
        );
      }
    }
    log.error("Error fetching Granola notes:", error);
    hideStatusBar(this);
    return;
  }

  if (documents.length === 0) {
    notifySync(
      this.settings.showSyncNotifications,
      "Granola sync: Everything up to date.",
      5000
    );
    hideStatusBar(this);
    return;
  }

  showStatusBar(this, `Granola sync: Syncing ${documents.length} notes`);

  // Folder map from /v1/folders + note membership
  let docFolders: Record<string, string[]> = {};
  try {
    showStatusBar(this, "Granola sync: Fetching folders...");
    const freshFolderMap = await buildFolderMap(apiKey, documents);
    const previousFolderMap = this.settings._folderMapCache ?? null;
    const diff = diffFolderMaps(previousFolderMap, freshFolderMap);
    if (diff.renamedPaths.size > 0) {
      await this.updateRenamedFolders(diff.renamedPaths);
    }
    this.settings._folderMapCache = freshFolderMap;
    await this.saveData(this.settings);
    docFolders = freshFolderMap.docFolders;
    await this.backfillFolderMetadata(docFolders);
  } catch (error) {
    log.error("Failed to build folder map, continuing sync without folder data:", error);
    if (this.settings._folderMapCache) {
      docFolders = this.settings._folderMapCache.docFolders;
    }
  }

  const forceOverwrite = mode === "full";

  // Transcripts now arrive with the note detail — no separate fetch phase.
  let transcriptDataMap: Map<string, TranscriptEntry[]> | null = null;
  if (this.settings.syncTranscripts) {
    transcriptDataMap = new Map();
    for (const doc of documents) {
      if (doc.transcript && doc.transcript.length > 0) {
        transcriptDataMap.set(doc.id, doc.transcript);
      }
    }
    if (!isCombinedMode) {
      await this.saveTranscriptFiles(documents, transcriptDataMap, forceOverwrite);
    }
  }

  if (this.settings.syncNotes) {
    await this.syncNotes(documents, forceOverwrite, transcriptDataMap, docFolders);
  }

  await this.updateCrossLinks(documents);
  showStatusBarTemporary(this, "Granola sync: Complete");
}
```

  - `filterSummariesByTitle`: add to `src/utils/documentFilter.ts` (same logic as `filterDocumentsByTitle` but over `{title}` objects — actually generalize: `filterDocumentsByTitle` already only touches `.title`; loosen its parameter type to `Array<{ title?: string | null }>` generically: `export function filterDocumentsByTitle<T extends { title?: string | null }>(documents: T[], mode, keyword): T[]` and reuse it for both; `filterSummariesByTitle` is then just an alias — prefer the generic, no new function).
  - Replace the old `syncTranscripts()` method with `saveTranscriptFiles(documents, transcriptDataMap, forceOverwrite)` — same body minus the fetch: iterate `documents`, skip when up-to-date (existing `findByGranolaId`/`isRemoteNewer` logic), format via `formatTranscriptBySpeaker(transcriptData, title, docId, doc.created_at, getEffectiveUpdatedAt(doc), doc.people?.attendees?.map(...), undefined)`, save via `saveTranscriptToDisk`.
  - In the two `syncNotesTo*` methods, remove the `appendImageEmbedsForAttachments` calls (use `noteData.markdown` / processor output directly).
- [ ] **Step 4: Delete the credential stack + build hooks**

```bash
git rm src/services/credentials.ts src/services/granolaCredentialsCrypto.ts \
  src/services/dpapiLoader.ts src/services/keyringLoader.ts \
  src/services/credentialsErrorPresenter.ts src/ui/keychainPermissionModal.ts \
  scripts/generateEmbeddedDpapiBinaries.mjs scripts/generateEmbeddedKeyringBinaries.mjs \
  tests/unit/credentials.test.ts tests/unit/credentialsErrorPresenter.test.ts \
  tests/unit/granolaCredentialsCrypto.test.ts
rm -f src/services/embeddedKeyringBinaries.ts src/services/embeddedDpapiBinaries.ts
```

  - `esbuild.config.mjs`: delete `regenerateEmbeddedBinaries()` and its call site(s).
  - `package.json`: remove `embed-binaries` and `postinstall` scripts; `build` becomes `"npm run lint && tsc -p . -noEmit -skipLibCheck && node esbuild.config.mjs production"`. Then check `dependencies`/`devDependencies` for packages only used by the deleted files (`grep -rn <pkg> src scripts` before removing each candidate) and remove them; run `pnpm install` to refresh the lockfile.
- [ ] **Step 5: Typecheck + full test suite**

Run: `pnpm tsc -p . -noEmit -skipLibCheck && pnpm jest`
Expected: clean typecheck; all suites PASS. Chase down any survivor references (`grep -rn "last_viewed_panel\|notes_markdown\|includePrivateNotes\|includeSharedNotes\|attachments" src tests` should return nothing).
- [ ] **Step 6: Commit** — `"feat: sync via public API key; remove local-credential stack"`

---

### Task 9: README + production build

**Files:**
- Rewrite: `README.md`
- Modify: `CONTRIBUTING.md` (remove credential/binary-embedding sections if present)

- [ ] **Step 1: Rewrite README** with: what the plugin does (official-API variant, fork credit to Tom Elliot's Granola Sync); **Install via BRAT** (install BRAT from Community Plugins → "Add beta plugin" → `kayacancode/obsidian-granola-sync`); **Setup** (create key: Granola → Settings → Connectors → API keys, scope Personal notes; enterprise needs admin enablement; paste into plugin settings, Test connection); **What syncs** (AI summaries + transcripts of meetings that have them; your own typed notes are not available via the public API; desktop Granola app not required); **Migrating from Granola Sync** (disable the original plugin to avoid double-syncing; existing files are matched and updated in place, not duplicated).
- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: lint clean, typecheck clean, `main.js` + `output/` produced without the embed-binaries step.
- [ ] **Step 3: Full suite once more** — `pnpm jest` → all PASS.
- [ ] **Step 4: Commit** — `"docs: README for Granola API Sync BRAT beta"`

---

### Task 10: BRAT release 0.1.0

**Files:** none (git/GitHub operations)

⚠️ Outward-facing: pushing the branch and publishing a GitHub release. Confirm with the user before this task unless already authorized.

- [ ] **Step 1:** Push branch: `git push -u origin public-api`. Merge to `main` (or release from the branch — BRAT reads releases, not branches; merging to main keeps the repo coherent): `git checkout main && git merge public-api && git push`.
- [ ] **Step 2:** Check `.github/workflows/release.yml` — if it builds and attaches `main.js`/`manifest.json`/`styles.css` on tag push, tag: `git tag 0.1.0 && git push origin 0.1.0` and verify the release assets. Otherwise create manually:

```bash
pnpm build
gh release create 0.1.0 main.js manifest.json styles.css \
  --title "0.1.0 — Granola public API beta" \
  --notes "First BRAT beta of Granola API Sync. Requires a Granola API key (Granola → Settings → Connectors → API keys). Syncs AI summaries + transcripts via the official public API; the desktop app is no longer required. Existing Granola Sync files are migrated in place."
```

- [ ] **Step 3:** Verify with BRAT in a test vault: add `kayacancode/obsidian-granola-sync`, install, paste key, Test connection, run "Sync from Granola", confirm notes/transcripts/folders/daily-note links, and that a pre-existing old-format file gets updated (not duplicated).

---

## Self-Review Notes

- Spec coverage: identity/BRAT (Tasks 0, 10), API key + settings UI + 401 handling (Tasks 2, 7, 8), v1 client with pagination/429/rate-delay (Task 2), summary_markdown + converter deletion (Task 4), folders (Task 5), transcripts via include (Tasks 2, 3, 8), dedupe migration incl. web_url match (Task 6), removed settings with scrub (Task 7), credential-stack deletion + build cleanup (Task 8), README/behavior changes (Task 9), tests per area (each task). `isDesktopOnly` decision recorded in Global Constraints (stays true — spec's "verify" outcome: `fs` remains in main.ts logging).
- Deviation from spec: spec said "keep includeSharedNotes"; investigation showed the public API has no owned/shared distinction to filter on, so the toggle is removed (key scope governs) — flag this to the user at review.
- Type consistency: `buildFolderMap(apiKey, docs)` signature change is reflected in Task 8's sync code; `DocumentProcessor` settings change reflected in Task 8 `initializeServices`; `TranscriptEntry` v1 shape used consistently in Tasks 3, 8.
