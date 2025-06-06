import { requestUrl } from "obsidian";

export interface ProseMirrorDoc {
  type: "doc";
  content: any[];
}

export interface GranolaDoc {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
  last_viewed_panel?: {
    content?: ProseMirrorDoc;
  };
}

export interface GranolaApiResponse {
  docs: GranolaDoc[];
}

export interface TranscriptEntry {
  document_id: string;
  start_timestamp: string;
  text: string;
  source: string;
  id: string;
  is_final: boolean;
  end_timestamp: string;
}

export async function fetchGranolaDocuments(
  accessToken: string
): Promise<GranolaDoc[]> {
  try {
    const response = await requestUrl({
      url: "https://api.granola.ai/v2/get-documents",
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent": "GranolaObsidianPlugin/0.1.7",
        "X-Client-Version": "ObsidianPlugin-0.1.7",
      },
      body: JSON.stringify({
        limit: 100,
        offset: 0,
        include_last_viewed_panel: true,
      }),
      throw: true,
    });
    const apiResponse = response.json as GranolaApiResponse;
    if (!apiResponse || !Array.isArray(apiResponse.docs)) {
      return [];
    }
    return apiResponse.docs;
  } catch (error: any) {
    // Optionally log error
    return [];
  }
}

export async function fetchGranolaTranscript(
  accessToken: string,
  docId: string
): Promise<TranscriptEntry[]> {
  try {
    const transcriptResp = await requestUrl({
      url: "https://api.granola.ai/v1/get-document-transcript",
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent": "GranolaObsidianPlugin/0.1.7",
        "X-Client-Version": "ObsidianPlugin-0.1.7",
      },
      body: JSON.stringify({ document_id: docId }),
      throw: true,
    });
    const data = transcriptResp.json;
    if (!Array.isArray(data)) {
      return [];
    }
    // Optionally: validate each entry has required fields
    return data as TranscriptEntry[];
  } catch (error: any) {
    // Optionally log error
    return [];
  }
}
