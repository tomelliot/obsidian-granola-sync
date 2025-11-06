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
    const firstDoc = response.json?.docs?.[0];
    if (firstDoc) {
      const allKeys = Object.keys(firstDoc);
      console.log("[Granola Sync] Raw API response (first doc):", {
        id: firstDoc.id,
        title: firstDoc.title,
        hasAttendees: "attendees" in firstDoc,
        attendees: firstDoc.attendees,
        allKeys: allKeys,
        // Look for fields that might contain attendee/people information
        possibleAttendeeFields: allKeys.filter(key => 
          key.toLowerCase().includes('attendee') || 
          key.toLowerCase().includes('people') || 
          key.toLowerCase().includes('participant') ||
          key.toLowerCase().includes('person')
        ),
        // Show a few sample values to help identify the structure
        sampleValues: Object.fromEntries(
          allKeys.slice(0, 10).map(key => [key, firstDoc[key]])
        ),
      });
      // Also log the full first doc structure (but limit size)
      console.log("[Granola Sync] Full first doc (truncated):", JSON.stringify(firstDoc, null, 2).substring(0, 2000));
    }
    
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
