import { fetchGranolaDocuments, fetchGranolaTranscript } from "../../src/services/granolaApi";

// Mock the requestUrl function from Obsidian
const mockRequestUrl = jest.fn();

jest.mock("obsidian", () => ({
  requestUrl: mockRequestUrl,
}));

describe("Granola API Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchGranolaDocuments", () => {
    it("should fetch documents successfully", async () => {
      const mockResponse = {
        json: {
          docs: [
            {
              id: "doc1",
              title: "Test Meeting",
              created_at: "2024-01-15T10:30:00Z",
              updated_at: "2024-01-15T11:00:00Z",
              last_viewed_panel: {
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Meeting content" }]
                    }
                  ]
                }
              }
            },
            {
              id: "doc2",
              title: "Another Meeting",
              created_at: "2024-01-14T09:00:00Z"
            }
          ]
        }
      };

      mockRequestUrl.mockResolvedValue(mockResponse);

      const result = await fetchGranolaDocuments("test-token");

      expect(result).toHaveLength(2);
      expect(result?.[0].id).toBe("doc1");
      expect(result?.[0].title).toBe("Test Meeting");
      expect(result?.[1].id).toBe("doc2");
      expect(result?.[1].title).toBe("Another Meeting");

      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: "https://api.granola.ai/v2/get-documents",
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
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
    });

    it("should return null when API response is invalid", async () => {
      const mockResponse = {
        json: {} // Missing 'docs' property
      };

      mockRequestUrl.mockResolvedValue(mockResponse);

      const result = await fetchGranolaDocuments("test-token");

      expect(result).toBeNull();
    });

    it("should return null when docs property is missing", async () => {
      const mockResponse = {
        json: {
          status: "success",
          // docs property is missing
        }
      };

      mockRequestUrl.mockResolvedValue(mockResponse);

      const result = await fetchGranolaDocuments("test-token");

      expect(result).toBeNull();
    });

    it("should handle 401 authentication errors", async () => {
      const authError = new Error("Unauthorized");
      (authError as any).status = 401;

      mockRequestUrl.mockRejectedValue(authError);

      await expect(fetchGranolaDocuments("invalid-token")).rejects.toThrow("Unauthorized");
    });

    it("should handle 403 forbidden errors", async () => {
      const forbiddenError = new Error("Forbidden");
      (forbiddenError as any).status = 403;

      mockRequestUrl.mockRejectedValue(forbiddenError);

      await expect(fetchGranolaDocuments("test-token")).rejects.toThrow("Forbidden");
    });

    it("should handle 404 not found errors", async () => {
      const notFoundError = new Error("Not Found");
      (notFoundError as any).status = 404;

      mockRequestUrl.mockRejectedValue(notFoundError);

      await expect(fetchGranolaDocuments("test-token")).rejects.toThrow("Not Found");
    });

    it("should handle 500 server errors", async () => {
      const serverError = new Error("Internal Server Error");
      (serverError as any).status = 500;

      mockRequestUrl.mockRejectedValue(serverError);

      await expect(fetchGranolaDocuments("test-token")).rejects.toThrow("Internal Server Error");
    });

    it("should handle network errors", async () => {
      const networkError = new Error("Network Error");
      
      mockRequestUrl.mockRejectedValue(networkError);

      await expect(fetchGranolaDocuments("test-token")).rejects.toThrow("Network Error");
    });
  });

  describe("fetchGranolaTranscript", () => {
    it("should fetch transcript successfully", async () => {
      const mockTranscriptResponse = {
        json: [
          {
            document_id: "doc1",
            start_timestamp: "10:30:00",
            text: "Hello everyone, welcome to the meeting.",
            source: "microphone",
            id: "1",
            is_final: true,
            end_timestamp: "10:30:05"
          },
          {
            document_id: "doc1",
            start_timestamp: "10:30:06",
            text: "Thanks for having me.",
            source: "system_audio",
            id: "2",
            is_final: true,
            end_timestamp: "10:30:08"
          }
        ]
      };

      mockRequestUrl.mockResolvedValue(mockTranscriptResponse);

      const result = await fetchGranolaTranscript("test-token", "doc1");

      expect(result).toHaveLength(2);
      expect(result?.[0].text).toBe("Hello everyone, welcome to the meeting.");
      expect(result?.[0].source).toBe("microphone");
      expect(result?.[1].text).toBe("Thanks for having me.");
      expect(result?.[1].source).toBe("system_audio");

      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: "https://api.granola.ai/v1/get-document-transcript",
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          Accept: "*/*",
          "User-Agent": "GranolaObsidianPlugin/0.1.7",
          "X-Client-Version": "ObsidianPlugin-0.1.7",
        },
        body: JSON.stringify({ document_id: "doc1" }),
        throw: true,
      });
    });

    it("should handle empty transcript response", async () => {
      const mockTranscriptResponse = {
        json: []
      };

      mockRequestUrl.mockResolvedValue(mockTranscriptResponse);

      const result = await fetchGranolaTranscript("test-token", "doc1");

      expect(result).toEqual([]);
    });

    it("should handle authentication errors for transcript", async () => {
      const authError = new Error("Unauthorized");
      (authError as any).status = 401;

      mockRequestUrl.mockRejectedValue(authError);

      await expect(fetchGranolaTranscript("invalid-token", "doc1")).rejects.toThrow("Unauthorized");
    });

    it("should handle document not found errors", async () => {
      const notFoundError = new Error("Document not found");
      (notFoundError as any).status = 404;

      mockRequestUrl.mockRejectedValue(notFoundError);

      await expect(fetchGranolaTranscript("test-token", "nonexistent-doc")).rejects.toThrow("Document not found");
    });

    it("should propagate network errors for transcript", async () => {
      const networkError = new Error("Connection timeout");
      
      mockRequestUrl.mockRejectedValue(networkError);

      await expect(fetchGranolaTranscript("test-token", "doc1")).rejects.toThrow("Connection timeout");
    });
  });

  describe("API request headers", () => {
    it("should include correct user agent and client version", async () => {
      const mockResponse = { json: { docs: [] } };
      mockRequestUrl.mockResolvedValue(mockResponse);

      await fetchGranolaDocuments("test-token");

      const callArgs = mockRequestUrl.mock.calls[0][0];
      expect(callArgs.headers["User-Agent"]).toBe("GranolaObsidianPlugin/0.1.7");
      expect(callArgs.headers["X-Client-Version"]).toBe("ObsidianPlugin-0.1.7");
    });

    it("should include authorization header", async () => {
      const mockResponse = { json: { docs: [] } };
      mockRequestUrl.mockResolvedValue(mockResponse);

      await fetchGranolaDocuments("my-secret-token");

      const callArgs = mockRequestUrl.mock.calls[0][0];
      expect(callArgs.headers.Authorization).toBe("Bearer my-secret-token");
    });

    it("should set correct content type and accept headers", async () => {
      const mockResponse = { json: { docs: [] } };
      mockRequestUrl.mockResolvedValue(mockResponse);

      await fetchGranolaDocuments("test-token");

      const callArgs = mockRequestUrl.mock.calls[0][0];
      expect(callArgs.headers["Content-Type"]).toBe("application/json");
      expect(callArgs.headers.Accept).toBe("*/*");
    });
  });
});