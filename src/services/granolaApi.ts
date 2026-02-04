import { requestUrl } from "obsidian";
import * as v from "valibot";
import {
  GranolaApiResponseSchema,
  TranscriptEntrySchema,
  TranscriptResponseSchema,
} from "./validationSchemas";
import { log } from "../utils/logger";

const DOCUMENTS_API_URL = "https://api.granola.ai/v2/get-documents";
const TRANSCRIPT_API_URL = "https://api.granola.ai/v1/get-document-transcript";

/**
 * Truncates a JSON string representation for logging purposes.
 * Keeps the first N characters and appends a truncation notice.
 */
function truncateForLogging(obj: unknown, maxLength: number = 2000): string {
  const json = JSON.stringify(obj, null, 2);
  if (json.length <= maxLength) {
    return json;
  }
  return json.substring(0, maxLength) + `\n... [truncated, total length: ${json.length} chars]`;
}

// ProseMirror types (defined explicitly due to recursive nature)
export interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  attrs?: { [key: string]: unknown };
}

export interface ProseMirrorDoc {
  type: "doc";
  content: ProseMirrorNode[];
}

// GranolaDoc type (defined explicitly due to recursive nature of ProseMirrorDoc)
export interface GranolaDoc {
  id: string;
  title: string | null;
  created_at?: string;
  updated_at?: string;
  attendees?: string[];
  people?: {
    attendees?: Array<{
      name?: string;
      email?: string;
    }>;
  };
  last_viewed_panel?: {
    content?: ProseMirrorDoc | string | null;
  } | null;
  notes_markdown?: string;
}

// Infer TypeScript type from validation schema
export type TranscriptEntry = v.InferOutput<typeof TranscriptEntrySchema>;

/**
 * Helper function to print validation issue paths from a Valibot safeParse result.
 * Prints the path of each issue to the console if validation failed.
 */
export function printValidationIssuePaths(
  result:
    | v.SafeParseResult<typeof GranolaApiResponseSchema>
    | v.SafeParseResult<typeof TranscriptResponseSchema>
): void {
  if (result.success) {
    return;
  }

  if (result.issues && result.issues.length > 0) {
    log.error("Validation issues:");
    result.issues.forEach((issue, index) => {
      const issueObj = issue as {
        path?: Array<{ key?: string | number | unknown }>;
      };
      if (issueObj.path && issueObj.path.length > 0) {
        const pathStr = issueObj.path
          .map((p: { key?: string | number | unknown }) => {
            if (typeof p.key === "number") return `[${p.key}]`;
            if (typeof p.key === "string") return `.${p.key}`;
            if (p.key) return `.${String(p.key)}`;
            return "";
          })
          .join("");
        log.error(`  Issue ${index + 1}: `);
        log.error(`  - expected: ${issue.expected}`);
        log.error(`  - received: ${issue.received}`);
        log.error(`  - message: ${issue.message}`);
        log.error(`  - path: ${pathStr}`);
      } else {
        log.error(`  Issue ${index + 1}: `);
        log.error(`  - expected: ${issue.expected}`);
        log.error(`  - received: ${issue.received}`);
        log.error(`  - message: ${issue.message}`);
        log.error(`  - path: (root)`);
      }
    });
  }
}

/**
 * Fetches documents from the Granola API.
 *
 * Pagination: The API supports offset-based pagination via the `offset` parameter.
 * No pagination metadata is returned in responses.
 * Use `offset` to skip documents: offset=0 for first page, offset=limit for second page, etc.
 */
export async function fetchGranolaDocuments(
  accessToken: string,
  limit: number = 100,
  offset: number = 0
): Promise<GranolaDoc[]> {
  log.info(`Fetching documents from ${DOCUMENTS_API_URL} (limit=${limit}, offset=${offset})`);

  let response;
  try {
    response = await requestUrl({
      url: DOCUMENTS_API_URL,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
        "X-Client-Version": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
      },
      body: JSON.stringify({
        limit,
        offset,
        include_last_viewed_panel: true,
      }),
    });
  } catch (error) {
    // Obsidian's requestUrl throws on network errors and non-2xx status codes
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status;
    log.error(`Failed to fetch documents from ${DOCUMENTS_API_URL}:`);
    log.error(`  Status: ${status ?? "unknown"}`);
    log.error(`  Error: ${errorMessage}`);
    throw error;
  }

  const jsonResponse = response.json;
  log.info(`Documents API response status: ${response.status}`);
  log.info(`Documents API raw response: ${truncateForLogging(jsonResponse)}`);

  const result = v.safeParse(GranolaApiResponseSchema, jsonResponse);
  if (!result.success) {
    log.error("Validation failed for GranolaApiResponseSchema:");
    printValidationIssuePaths(result);
    log.error("Validation issues:", JSON.stringify(result.issues, null, 2));
    log.error(`Raw API response that failed validation: ${truncateForLogging(jsonResponse)}`);

    throw new Error(
      `Invalid response from Granola API (GranolaApiResponseSchema)`
    );
  }

  const docs = result.output.docs as GranolaDoc[];
  log.info(`Successfully fetched ${docs.length} documents from Granola API`);
  return docs;
}

export async function fetchAllGranolaDocuments(
  accessToken: string,
  pageSize: number = 100
): Promise<GranolaDoc[]> {
  const documents: GranolaDoc[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchGranolaDocuments(accessToken, pageSize, offset);
    if (page.length === 0) {
      break;
    }

    documents.push(...page);

    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return documents;
}

export async function fetchGranolaDocumentsByDaysBack(
  accessToken: string,
  daysBack: number,
  pageSize: number = 100
): Promise<GranolaDoc[]> {
  if (daysBack === 0) {
    return fetchAllGranolaDocuments(accessToken, pageSize);
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const documents: GranolaDoc[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchGranolaDocuments(accessToken, pageSize, offset);
    if (page.length === 0) {
      break;
    }

    documents.push(...page);

    const hasOlderThanCutoff = page.some((doc) => {
      const docDate = doc.created_at
        ? new Date(doc.created_at)
        : doc.updated_at
        ? new Date(doc.updated_at)
        : new Date();
      return docDate < cutoffDate;
    });

    if (hasOlderThanCutoff || page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return documents.filter((doc) => {
    const docDate = doc.created_at
      ? new Date(doc.created_at)
      : doc.updated_at
      ? new Date(doc.updated_at)
      : new Date();
    return docDate >= cutoffDate;
  });
}

/**
 * Fetches the transcript for a specific Granola document.
 */
export async function fetchGranolaTranscript(
  accessToken: string,
  docId: string
): Promise<TranscriptEntry[]> {
  log.info(`Fetching transcript from ${TRANSCRIPT_API_URL} (docId=${docId})`);

  let response;
  try {
    response = await requestUrl({
      url: TRANSCRIPT_API_URL,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
        "X-Client-Version": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
      },
      body: JSON.stringify({ document_id: docId }),
    });
  } catch (error) {
    // Obsidian's requestUrl throws on network errors and non-2xx status codes
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status;
    log.error(`Failed to fetch transcript from ${TRANSCRIPT_API_URL} (docId=${docId}):`);
    log.error(`  Status: ${status ?? "unknown"}`);
    log.error(`  Error: ${errorMessage}`);
    throw error;
  }

  const jsonResponse = response.json;
  log.info(`Transcript API response status: ${response.status}`);
  log.info(`Transcript API raw response: ${truncateForLogging(jsonResponse)}`);

  const result = v.safeParse(TranscriptResponseSchema, jsonResponse);
  if (!result.success) {
    log.error(`Validation failed for TranscriptResponseSchema (docId=${docId}):`);
    printValidationIssuePaths(result);
    log.error("Validation issues:", JSON.stringify(result.issues, null, 2));
    log.error(`Raw API response that failed validation: ${truncateForLogging(jsonResponse)}`);

    throw new Error(
      `Invalid transcript response from Granola API (TranscriptResponseSchema)`
    );
  }

  const entries = result.output as TranscriptEntry[];
  log.info(`Successfully fetched transcript with ${entries.length} entries for docId=${docId}`);
  return entries;
}
