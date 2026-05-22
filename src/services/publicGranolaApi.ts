import { requestUrl, RequestUrlParam } from "obsidian";
import * as v from "valibot";
import {
  PublicListNotesResponseSchema,
  PublicNoteSchema,
  PublicListFoldersResponseSchema,
  PublicNote,
  PublicNoteSummary,
  PublicListNotesResponse,
  PublicListFoldersResponse,
} from "./publicApiSchemas";
import { log } from "../utils/logger";

/**
 * Client for Granola's Public API (`public-api.granola.ai`).
 *
 * Differences from the internal `granolaApi.ts` client:
 * - Uses Bearer token (the `grn_*` API key) instead of WorkOS access token.
 * - GET endpoints with cursor pagination instead of POST + offset.
 * - Conservative rate limiting (5 req/s sustained per Granola docs).
 * - Surfaces HTTP status to callers so the sync orchestrator can react to
 *   401 / 429 distinctly from generic failures.
 */

const BASE_URL = "https://public-api.granola.ai";
/**
 * Granola's documented sustained rate limit is 5 req/s. We space requests
 * 220ms apart (~4.5 req/s) to leave headroom for clock skew and avoid 429s.
 * Tuneable for tests via {@link setMinRequestSpacingMs}.
 */
let MIN_REQUEST_SPACING_MS = 220;

/**
 * Test hook: override the request spacing. Set to 0 in tests so suites stay
 * fast; production callers should leave the default.
 */
export function setMinRequestSpacingMs(ms: number): void {
  MIN_REQUEST_SPACING_MS = ms;
}

/**
 * Thrown when the API returns an error status. Carries the HTTP status and
 * (when present) Granola's `granola-request-id` header so logs / bug reports
 * can be cross-referenced with Granola support.
 */
export class PublicApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

interface RequestOpts {
  /** Defaults to GET. */
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

let lastRequestAt = 0;

/**
 * Sleeps so the next request is at least {@link MIN_REQUEST_SPACING_MS} after
 * the previous one. Single-threaded — Obsidian plugin code runs on the
 * renderer's main thread, so this is sufficient throttling.
 */
async function throttleNextRequest(): Promise<void> {
  if (MIN_REQUEST_SPACING_MS <= 0) return;
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_SPACING_MS - now;
  if (wait > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

function buildUrl(
  path: string,
  query: Record<string, string | number | undefined> | undefined
): string {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function requestPublicApi(
  apiKey: string,
  path: string,
  opts: RequestOpts = {}
): Promise<{ json: unknown; status: number; requestId?: string }> {
  await throttleNextRequest();

  const url = buildUrl(path, opts.query);
  const params: RequestUrlParam = {
    url,
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
    },
    // requestUrl throws by default on non-2xx; we want to inspect status.
    throw: false,
  };
  if (opts.body !== undefined) {
    params.body = JSON.stringify(opts.body);
    if (!params.headers) params.headers = {};
    params.headers["Content-Type"] = "application/json";
  }

  log.debug(`publicGranolaApi → ${params.method} ${path}`);
  const response = await requestUrl(params);
  const requestId =
    response.headers?.["granola-request-id"] ??
    response.headers?.["x-request-id"];

  if (response.status >= 400) {
    log.error(
      `publicGranolaApi ${params.method} ${path} → ${response.status}` +
        (requestId ? ` (request-id ${requestId})` : "")
    );
    throw new PublicApiError(
      `Granola public API ${path} returned HTTP ${response.status}`,
      response.status,
      requestId
    );
  }

  return { json: response.json, status: response.status, requestId };
}

function safeParseOrThrow<TSchema extends v.GenericSchema>(
  schema: TSchema,
  data: unknown,
  context: string
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, data);
  if (!result.success) {
    log.error(`publicGranolaApi schema validation failed for ${context}`);
    log.error(JSON.stringify(result.issues, null, 2));
    throw new Error(
      `Invalid response from Granola public API (${context})`
    );
  }
  return result.output;
}

export interface ListNotesParams {
  /** ISO 8601 timestamp. Only notes created at or after are returned. */
  createdAfter?: string;
  /** ISO 8601 timestamp. Only notes updated at or after are returned. */
  updatedAfter?: string;
  cursor?: string;
  /** Public API max is 30 per page. */
  pageSize?: number;
}

/**
 * Fetches a single page of notes. Caller is responsible for following the
 * cursor — use {@link listAllNotes} for the common case.
 */
export async function listNotes(
  apiKey: string,
  params: ListNotesParams = {}
): Promise<PublicListNotesResponse> {
  const { json } = await requestPublicApi(apiKey, "/v1/notes", {
    query: {
      created_after: params.createdAfter,
      updated_after: params.updatedAfter,
      cursor: params.cursor,
      page_size: params.pageSize ?? 30,
    },
  });
  return safeParseOrThrow(
    PublicListNotesResponseSchema,
    json,
    "PublicListNotesResponseSchema"
  );
}

/**
 * Iterates pages of notes until exhausted. Stops at `maxNotes` (default 5000)
 * so a pathological response can't loop forever.
 */
export async function listAllNotes(
  apiKey: string,
  params: ListNotesParams = {},
  maxNotes = 5000
): Promise<PublicNoteSummary[]> {
  const all: PublicNoteSummary[] = [];
  let cursor: string | undefined = params.cursor;
  let pages = 0;

  while (all.length < maxNotes) {
    const page = await listNotes(apiKey, {
      ...params,
      cursor,
    });
    all.push(...page.notes);
    pages++;
    log.debug(
      `publicGranolaApi listAllNotes — page ${pages}, ${page.notes.length} note(s), total ${all.length}`
    );
    if (!page.hasMore || !page.cursor) {
      break;
    }
    cursor = page.cursor;
  }

  if (all.length >= maxNotes) {
    log.warn(
      `publicGranolaApi listAllNotes — hit maxNotes cap (${maxNotes}); some notes may be missing`
    );
  }
  return all;
}

/**
 * Fetches a single note. Pass `includeTranscript: true` to attach the
 * transcript array.
 */
export async function getNote(
  apiKey: string,
  noteId: string,
  opts: { includeTranscript?: boolean } = {}
): Promise<PublicNote> {
  const query: Record<string, string | undefined> = {};
  if (opts.includeTranscript) {
    query.include = "transcript";
  }
  const { json } = await requestPublicApi(apiKey, `/v1/notes/${noteId}`, {
    query,
  });
  return safeParseOrThrow(PublicNoteSchema, json, "PublicNoteSchema");
}

export interface ListFoldersParams {
  cursor?: string;
  /** Public API max is 30 per page. */
  pageSize?: number;
}

export async function listFolders(
  apiKey: string,
  params: ListFoldersParams = {}
): Promise<PublicListFoldersResponse> {
  const { json } = await requestPublicApi(apiKey, "/v1/folders", {
    query: {
      cursor: params.cursor,
      page_size: params.pageSize ?? 30,
    },
  });
  return safeParseOrThrow(
    PublicListFoldersResponseSchema,
    json,
    "PublicListFoldersResponseSchema"
  );
}

/**
 * Iterates pages of folders until exhausted. Defaults to a generous cap so a
 * pathological response can't loop forever. Used by API-mode sync's periodic
 * folder hierarchy refresh (see `apiFolderSnapshot.ts`).
 */
export async function listAllFolders(
  apiKey: string,
  maxFolders = 1000
): Promise<PublicListFoldersResponse["folders"]> {
  const all: PublicListFoldersResponse["folders"] = [];
  let cursor: string | undefined;
  let pages = 0;

  while (all.length < maxFolders) {
    const page = await listFolders(apiKey, { cursor });
    all.push(...page.folders);
    pages++;
    log.debug(
      `publicGranolaApi listAllFolders — page ${pages}, ${page.folders.length} folder(s), total ${all.length}`
    );
    if (!page.hasMore || !page.cursor) {
      break;
    }
    cursor = page.cursor;
  }

  if (all.length >= maxFolders) {
    log.warn(
      `publicGranolaApi listAllFolders — hit maxFolders cap (${maxFolders}); some folders may be missing`
    );
  }
  return all;
}
