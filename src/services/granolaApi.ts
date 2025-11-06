import { requestUrl } from "obsidian";
import * as v from "valibot";
import {
  GranolaApiResponseSchema,
  TranscriptEntrySchema,
  TranscriptResponseSchema,
} from "./validationSchemas";

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
  last_viewed_panel?: {
    content?: ProseMirrorDoc | string | null;
  } | null;
}

// Infer TypeScript type from validation schema
export type TranscriptEntry = v.InferOutput<typeof TranscriptEntrySchema>;

export async function fetchGranolaDocuments(
  accessToken: string,
  limit: number = 100
): Promise<GranolaDoc[]> {
  const response = await requestUrl({
    url: "https://api.granola.ai/v2/get-documents",
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "*/*",
      "User-Agent": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
    },
    body: JSON.stringify({
      limit: limit,
      offset: 0,
      include_last_viewed_panel: true,
    }),
  });

  try {
    // Debug: Log raw API response before validation
    console.log("[Granola Sync] Raw API response (first doc):", 
      response.json?.docs?.[0] ? {
        id: response.json.docs[0].id,
        title: response.json.docs[0].title,
        hasAttendees: "attendees" in (response.json.docs[0] || {}),
        attendees: response.json.docs[0]?.attendees,
        allKeys: Object.keys(response.json.docs[0] || {}),
      } : "No docs in response"
    );
    
    const apiResponse = v.parse(GranolaApiResponseSchema, response.json);
    
    // Debug: Log after validation
    console.log("[Granola Sync] After validation (first doc):", 
      apiResponse.docs[0] ? {
        id: apiResponse.docs[0].id,
        title: apiResponse.docs[0].title,
        hasAttendees: "attendees" in (apiResponse.docs[0] || {}),
        attendees: (apiResponse.docs[0] as any)?.attendees,
        allKeys: Object.keys(apiResponse.docs[0] || {}),
      } : "No docs after validation"
    );
    
    return apiResponse.docs as GranolaDoc[];
  } catch (error) {
    const errorMessage = `Invalid response from Granola API: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    throw new Error(errorMessage);
  }
}

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
    },
    body: JSON.stringify({ document_id: docId }),
  });

  try {
    return v.parse(
      TranscriptResponseSchema,
      transcriptResp.json
    ) as TranscriptEntry[];
  } catch (error) {
    const errorMessage = `Invalid transcript response from Granola API: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    throw new Error(errorMessage);
  }
}
