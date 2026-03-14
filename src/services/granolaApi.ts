import { requestUrl } from "obsidian";
import * as v from "valibot";
import {
  GranolaApiResponseSchema,
  TranscriptResponseSchema,
  DocumentListsMetadataResponseSchema,
  DocumentListWithDocsResponseSchema,
} from "./validationSchemas";
import { log } from "../utils/logger";

// Re-export all types so existing imports from "./granolaApi" continue to work
export type {
  ProseMirrorNode,
  ProseMirrorDoc,
  GranolaAttachment,
  GranolaDoc,
  TranscriptEntry,
  DocumentListMetadata,
  DocumentListWithDocs,
} from "./granolaTypes";

import type {
  GranolaDoc,
  TranscriptEntry,
  DocumentListMetadata,
  DocumentListWithDocs,
} from "./granolaTypes";

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
  log.debug(`Fetching documents — offset=${offset}, limit=${limit}`);
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
    log.debug("Response keys:", Object.keys(jsonResponse ?? {}));
    printValidationIssuePaths(result);
    log.error(JSON.stringify(result.issues, null, 2));

    throw new Error(
      `Invalid response from Granola API (GranolaApiResponseSchema)`
    );
  }
  log.debug(`Fetched ${result.output.docs.length} document(s) at offset=${offset}`);
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
  log.debug(`Fetching transcript for doc ${docId}`);
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
    log.debug("Transcript response type:", typeof transcriptResp.json, Array.isArray(transcriptResp.json) ? `length=${transcriptResp.json.length}` : "");
    printValidationIssuePaths(result);
    log.error(JSON.stringify(result.issues, null, 2));

    throw new Error(
      `Invalid transcript response from Granola API (TranscriptResponseSchema)`
    );
  }
  log.debug(`Fetched ${result.output.length} transcript entry/entries for doc ${docId}`);
  return result.output as TranscriptEntry[];
}

/**
 * Fetches metadata for all document lists (folders) the user has access to.
 * Returns a record keyed by list ID.
 */
export async function fetchDocumentListsMetadata(
  accessToken: string
): Promise<Record<string, DocumentListMetadata>> {
  log.debug("Fetching document lists metadata");
  const response = await requestUrl({
    url: "https://api.granola.ai/v1/get-document-lists-metadata",
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "*/*",
      "User-Agent": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
      "X-Client-Version": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
    },
    body: JSON.stringify({}),
  });

  const result = v.safeParse(
    DocumentListsMetadataResponseSchema,
    response.json
  );
  if (!result.success) {
    log.error("Validation failed for DocumentListsMetadataResponseSchema:");
    log.error(JSON.stringify(result.issues, null, 2));
    throw new Error(
      "Invalid response from Granola API (DocumentListsMetadataResponseSchema)"
    );
  }

  const listCount = Object.keys(result.output.lists).length;
  log.debug(`Fetched metadata for ${listCount} document list(s)`);
  return result.output.lists as Record<string, DocumentListMetadata>;
}

/**
 * Fetches a single document list (folder) including its document memberships.
 * Only document IDs are extracted from the response.
 */
export async function fetchDocumentList(
  accessToken: string,
  listId: string
): Promise<DocumentListWithDocs> {
  log.debug(`Fetching document list ${listId}`);
  const response = await requestUrl({
    url: "https://api.granola.ai/v1/get-document-list",
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "*/*",
      "User-Agent": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
      "X-Client-Version": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
    },
    body: JSON.stringify({ list_id: listId }),
  });

  const result = v.safeParse(
    DocumentListWithDocsResponseSchema,
    response.json
  );
  if (!result.success) {
    log.error(
      `Validation failed for DocumentListWithDocsResponseSchema (list ${listId}):`
    );
    log.error(JSON.stringify(result.issues, null, 2));
    throw new Error(
      `Invalid response from Granola API (DocumentListWithDocsResponseSchema) for list ${listId}`
    );
  }

  log.debug(
    `Fetched document list "${result.output.title}" with ${result.output.documents?.length ?? 0} document(s)`
  );
  return result.output as DocumentListWithDocs;
}
