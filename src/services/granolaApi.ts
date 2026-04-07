import { requestUrl } from "obsidian";
import * as v from "valibot";
import {
  GranolaApiResponseSchema,
  TranscriptResponseSchema,
  DocumentListsMetadataResponseSchema,
  DocumentListWithDocsResponseSchema,
  DocumentSetResponseSchema,
  DocumentsBatchResponseSchema,
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
  DocumentSetEntry,
} from "./granolaTypes";

import type {
  GranolaDoc,
  TranscriptEntry,
  DocumentListMetadata,
  DocumentListWithDocs,
  DocumentSetEntry,
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

// ---------------------------------------------------------------------------
// Document set & batch endpoints (for shared document support)
// ---------------------------------------------------------------------------

/**
 * Fetches the full set of document IDs the user has access to, including
 * documents shared with them. Returns a record keyed by document ID.
 */
export async function fetchDocumentSet(
  accessToken: string
): Promise<Record<string, DocumentSetEntry>> {
  log.debug("Fetching document set");
  const response = await requestUrl({
    url: "https://api.granola.ai/v1/get-document-set",
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

  const result = v.safeParse(DocumentSetResponseSchema, response.json);
  if (!result.success) {
    log.error("Validation failed for DocumentSetResponseSchema:");
    log.error(JSON.stringify(result.issues, null, 2));
    throw new Error("Invalid response from Granola API (DocumentSetResponseSchema)");
  }

  const count = Object.keys(result.output.documents).length;
  log.debug(`Fetched document set with ${count} document(s)`);
  return result.output.documents as Record<string, DocumentSetEntry>;
}

/**
 * Fetches full document data for a batch of document IDs.
 * Uses the v1/get-documents-batch endpoint.
 */
export async function fetchDocumentsBatch(
  accessToken: string,
  documentIds: string[]
): Promise<GranolaDoc[]> {
  if (documentIds.length === 0) return [];

  log.debug(`Fetching documents batch — ${documentIds.length} ID(s)`);
  const response = await requestUrl({
    url: "https://api.granola.ai/v1/get-documents-batch",
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "*/*",
      "User-Agent": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
      "X-Client-Version": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
    },
    body: JSON.stringify({ document_ids: documentIds }),
  });

  const result = v.safeParse(DocumentsBatchResponseSchema, response.json);
  if (!result.success) {
    log.error("Validation failed for DocumentsBatchResponseSchema:");
    printValidationIssuePaths(result);
    log.error(JSON.stringify(result.issues, null, 2));
    throw new Error("Invalid response from Granola API (DocumentsBatchResponseSchema)");
  }

  log.debug(`Fetched ${result.output.docs.length} document(s) in batch`);
  return result.output.docs as GranolaDoc[];
}

// ---------------------------------------------------------------------------
// Public API — high-level functions used by the sync orchestrator
// ---------------------------------------------------------------------------

/**
 * Fetches all documents the user has access to, including shared documents.
 *
 * 1. Paginates through v2/get-documents (owned docs with full data)
 * 2. Fetches the document set to discover shared doc IDs
 * 3. Batch-fetches any documents present in the set but missing from step 1
 */
export async function getAllDocuments(
  accessToken: string,
  pageSize: number = 100
): Promise<GranolaDoc[]> {
  const ownedDocs = await fetchAllGranolaDocuments(accessToken, pageSize);
  return mergeSharedDocuments(accessToken, ownedDocs);
}

/**
 * Fetches recent documents (within daysBack), including shared documents.
 * Pass daysBack=0 for a full sync.
 */
export async function getRecentDocuments(
  accessToken: string,
  daysBack: number,
  pageSize: number = 100
): Promise<GranolaDoc[]> {
  const ownedDocs = await fetchGranolaDocumentsByDaysBack(accessToken, daysBack, pageSize);

  const cutoffDate = daysBack > 0 ? new Date() : null;
  if (cutoffDate) cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  return mergeSharedDocuments(accessToken, ownedDocs, cutoffDate);
}

/**
 * Discovers shared documents via the document set and fetches their full data.
 * Merges them into the provided owned documents list.
 *
 * When a cutoffDate is provided, only shared documents updated after that date
 * are included.
 */
async function mergeSharedDocuments(
  accessToken: string,
  ownedDocs: GranolaDoc[],
  cutoffDate?: Date | null
): Promise<GranolaDoc[]> {
  let documentSet: Record<string, DocumentSetEntry>;
  try {
    documentSet = await fetchDocumentSet(accessToken);
  } catch (error) {
    log.error("Failed to fetch document set, continuing with owned docs only:", error);
    return ownedDocs;
  }

  const ownedIds = new Set(ownedDocs.map((d) => d.id));
  let missingIds = Object.keys(documentSet).filter((id) => !ownedIds.has(id));

  if (cutoffDate) {
    missingIds = missingIds.filter((id) => {
      const entry = documentSet[id];
      return new Date(entry.updated_at) >= cutoffDate;
    });
  }

  if (missingIds.length === 0) {
    log.debug("No additional shared documents to fetch");
    return ownedDocs;
  }

  log.debug(`Found ${missingIds.length} document(s) missing from owned set, fetching via batch`);

  try {
    const sharedDocs = await fetchDocumentsBatch(accessToken, missingIds);
    const activeDocs = sharedDocs.filter((doc) => !doc.deleted_at);
    if (activeDocs.length < sharedDocs.length) {
      log.debug(
        `Filtered out ${sharedDocs.length - activeDocs.length} deleted document(s) from batch`
      );
    }
    log.debug(`Merged ${activeDocs.length} shared document(s)`);
    return [...ownedDocs, ...activeDocs];
  } catch (error) {
    log.error("Failed to fetch shared documents batch, continuing with owned docs only:", error);
    return ownedDocs;
  }
}
