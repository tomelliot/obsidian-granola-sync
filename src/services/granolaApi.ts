import { requestUrl } from "obsidian";
import * as v from "valibot";
import {
  GranolaApiResponseSchema,
  TranscriptEntrySchema,
  TranscriptResponseSchema,
} from "./validationSchemas";
import { log } from "../utils/logger";

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
  const response = await requestUrl({
    url: "https://api.granola.ai/v2/get-documents",
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

  const jsonResponse = response.json;

  const result = v.safeParse(GranolaApiResponseSchema, jsonResponse);
  if (!result.success) {
    log.error("Validation failed for GranolaApiResponseSchema:");
    printValidationIssuePaths(result);
    log.error(JSON.stringify(result.issues, null, 2));

    throw new Error(
      `Invalid response from Granola API (GranolaApiResponseSchema)`
    );
  }
  return result.output.docs as GranolaDoc[];
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
  const transcriptResp = await requestUrl({
    url: "https://api.granola.ai/v1/get-document-transcript",
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

  const result = v.safeParse(TranscriptResponseSchema, transcriptResp.json);
  if (!result.success) {
    log.error("Validation failed for TranscriptResponseSchema:");
    printValidationIssuePaths(result);
    log.error(JSON.stringify(result.issues, null, 2));

    throw new Error(
      `Invalid transcript response from Granola API (TranscriptResponseSchema)`
    );
  }
  return result.output as TranscriptEntry[];
}
