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

export async function fetchGranolaDocuments(
  accessToken: string
): Promise<GranolaDoc[] | null> {
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
    if (!apiResponse || !apiResponse.docs) {
      return null;
    }
    return apiResponse.docs;
  } catch (error: any) {
    throw error;
  }
}

export async function fetchGranolaTranscript(
  accessToken: string,
  docId: string
): Promise<any[] | null> {
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
    return transcriptResp.json as any[];
  } catch (error: any) {
    throw error;
  }
}
