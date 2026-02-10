import * as v from "valibot";
import {
  printValidationIssuePaths,
  fetchGranolaDocuments,
  fetchAllGranolaDocuments,
  fetchGranolaDocumentsByDaysBack,
  fetchGranolaTranscript,
} from "../../src/services/granolaApi";
import {
  GranolaApiResponseSchema,
  TranscriptResponseSchema,
} from "../../src/services/validationSchemas";
import { requestUrl } from "obsidian";
import { log } from "../../src/utils/logger";

// Mock requestUrl and logger
jest.mock("obsidian");
jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("printValidationIssuePaths", () => {
  it("should not print anything when validation succeeds", () => {
    const validData = { docs: [] };
    const result = v.safeParse(GranolaApiResponseSchema, validData);

    printValidationIssuePaths(result);

    // Just verify it doesn't throw
    expect(result.success).toBe(true);
  });
});

describe("fetchGranolaDocuments", () => {
  const mockAccessToken = "test-token";
  const mockValidResponse = {
    docs: [
      {
        id: "doc-1",
        title: "Test Note",
        created_at: "2024-01-15T10:00:00Z",
        updated_at: "2024-01-15T12:00:00Z",
        attachments: [
          {
            id: "att-1",
            url: "https://example.com/image-1",
            type: "image",
            width: 100,
            height: 200,
          },
        ],
        last_viewed_panel: {
          content: {
            type: "doc",
            content: [],
          },
        },
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Set PLUGIN_VERSION for tests
    (global as any).PLUGIN_VERSION = "1.0.0";
  });

  it("should successfully fetch documents with valid response", async () => {
    (requestUrl as jest.Mock).mockResolvedValue({
      json: mockValidResponse,
    });

    const result = await fetchGranolaDocuments(mockAccessToken, 100, 0);

    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://api.granola.ai/v2/get-documents",
      method: "POST",
      headers: {
        Authorization: `Bearer ${mockAccessToken}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent": "GranolaObsidianPlugin/1.0.0",
        "X-Client-Version": "GranolaObsidianPlugin/1.0.0",
      },
      body: JSON.stringify({
        limit: 100,
        offset: 0,
        include_last_viewed_panel: true,
      }),
    });
    expect(result).toEqual(mockValidResponse.docs);
  });

  it("should use default limit and offset when not provided", async () => {
    (requestUrl as jest.Mock).mockResolvedValue({
      json: { docs: [] },
    });

    await fetchGranolaDocuments(mockAccessToken);

    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({
          limit: 100,
          offset: 0,
          include_last_viewed_panel: true,
        }),
      })
    );
  });

  it("should throw error when validation fails", async () => {
    const invalidResponse = { docs: [{ id: 123 }] }; // Invalid: id should be string
    (requestUrl as jest.Mock).mockResolvedValue({
      json: invalidResponse,
    });

    await expect(fetchGranolaDocuments(mockAccessToken)).rejects.toThrow(
      "Invalid response from Granola API"
    );
    expect(log.error).toHaveBeenCalled();
  });

  it("should parse documents with attachments field", async () => {
    const responseWithAttachments = {
      docs: [
        {
          id: "doc-with-attachments",
          title: "Note With Attachments",
          created_at: "2024-01-15T10:00:00Z",
          updated_at: "2024-01-15T12:00:00Z",
          attachments: [
            {
              id: "attachment-1",
              url: "https://example.com/image-1",
              type: "image",
              width: 1084,
              height: 1036,
            },
            {
              id: "attachment-2",
              url: "https://example.com/image-2",
              type: "image",
              width: 1676,
              height: 1042,
            },
          ],
          last_viewed_panel: {
            content: {
              type: "doc",
              content: [],
            },
          },
        },
      ],
    };

    (requestUrl as jest.Mock).mockResolvedValue({
      json: responseWithAttachments,
    });

    const result = await fetchGranolaDocuments(mockAccessToken, 100, 0);

    expect(result).toHaveLength(1);
    const [doc] = result;
    expect(doc.id).toBe("doc-with-attachments");
    expect(doc.attachments).toBeDefined();
    expect(doc.attachments!.length).toBe(2);
    expect(doc.attachments![0]).toMatchObject({
      id: "attachment-1",
      url: "https://example.com/image-1",
      type: "image",
    });
  });

  it("should handle network errors", async () => {
    const networkError = new Error("Network error");
    (requestUrl as jest.Mock).mockRejectedValue(networkError);

    await expect(fetchGranolaDocuments(mockAccessToken)).rejects.toThrow(
      "Network error"
    );
  });
});

describe("fetchAllGranolaDocuments", () => {
  const mockAccessToken = "test-token";

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).PLUGIN_VERSION = "1.0.0";
  });

  it("should fetch documents", async () => {
    const page1 = {
      docs: Array.from({ length: 50 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Note ${i}`,
        last_viewed_panel: { content: { type: "doc", content: [] } },
      })),
    };
    (requestUrl as jest.Mock).mockResolvedValueOnce({ json: page1 });

    const result = await fetchAllGranolaDocuments(mockAccessToken, 100);

    expect(result.length).toBeGreaterThan(0);
  });


});

describe("fetchGranolaDocumentsByDaysBack", () => {
  const mockAccessToken = "test-token";

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-20T12:00:00Z"));
    (global as any).PLUGIN_VERSION = "1.0.0";
  });

  afterEach(() => {
    jest.useRealTimers();
  });


  it("should filter documents by date using created_at", async () => {
    const cutoffDate = new Date("2024-01-13T12:00:00Z"); // 7 days before
    const recentDoc = {
      id: "doc-1",
      title: "Recent Note",
      created_at: "2024-01-18T10:00:00Z", // Within 7 days
      last_viewed_panel: { content: { type: "doc", content: [] } },
    };
    const oldDoc = {
      id: "doc-2",
      title: "Old Note",
      created_at: "2024-01-10T10:00:00Z", // Before cutoff
      last_viewed_panel: { content: { type: "doc", content: [] } },
    };

    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: { docs: [recentDoc, oldDoc] },
    });

    const result = await fetchGranolaDocumentsByDaysBack(mockAccessToken, 7);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("doc-1");
  });


  it("should include documents without dates (treated as new)", async () => {
    const docWithoutDate = {
      id: "doc-1",
      title: "Note without date",
    };

    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: { docs: [docWithoutDate] },
    });

    const result = await fetchGranolaDocumentsByDaysBack(mockAccessToken, 7);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("doc-1");
  });

  it("should stop pagination when older document is found", async () => {
    const recentDoc = {
      id: "doc-1",
      title: "Recent",
      created_at: "2024-01-18T10:00:00Z",
    };
    const oldDoc = {
      id: "doc-2",
      title: "Old",
      created_at: "2024-01-10T10:00:00Z", // Before cutoff
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({
        json: { docs: [recentDoc, oldDoc] },
      });

    const result = await fetchGranolaDocumentsByDaysBack(mockAccessToken, 7);

    expect(requestUrl).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

});

describe("fetchGranolaTranscript", () => {
  const mockAccessToken = "test-token";
  const mockDocId = "doc-123";
  const mockValidTranscript = [
    {
      document_id: "doc-123",
      start_timestamp: "00:00:01",
      text: "Hello world",
      source: "source",
      id: "transcript-1",
      is_final: true,
      end_timestamp: "00:00:05",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).PLUGIN_VERSION = "1.0.0";
  });

  it("should successfully fetch transcript with valid response", async () => {
    // Mock valid transcript response that matches TranscriptResponseSchema
    const validTranscript = [
      {
        document_id: "doc-123",
        start_timestamp: "00:00:01",
        text: "Hello world",
        source: "source",
        id: "transcript-1",
        is_final: true,
        end_timestamp: "00:00:05",
      },
    ];
    (requestUrl as jest.Mock).mockResolvedValue({
      json: validTranscript,
    });

    const result = await fetchGranolaTranscript(mockAccessToken, mockDocId);

    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://api.granola.ai/v1/get-document-transcript",
      method: "POST",
      headers: {
        Authorization: `Bearer ${mockAccessToken}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent": "GranolaObsidianPlugin/1.0.0",
        "X-Client-Version": "GranolaObsidianPlugin/1.0.0",
      },
      body: JSON.stringify({ document_id: mockDocId }),
    });
    expect(result).toEqual(validTranscript);
  });

  it("should throw error when validation fails", async () => {
    const invalidTranscript = [
      {
        document_id: "doc-123",
        start_timestamp: "invalid",
        text: "Hello",
        source: "source",
        id: "transcript-1",
        is_final: "not boolean", // Invalid
        end_timestamp: "00:00:05",
      },
    ];
    (requestUrl as jest.Mock).mockResolvedValue({
      json: invalidTranscript,
    });

    await expect(
      fetchGranolaTranscript(mockAccessToken, mockDocId)
    ).rejects.toThrow("Invalid transcript response from Granola API");
    expect(log.error).toHaveBeenCalled();
  });

  it("should handle network errors", async () => {
    const networkError = new Error("Network error");
    (requestUrl as jest.Mock).mockRejectedValue(networkError);

    await expect(
      fetchGranolaTranscript(mockAccessToken, mockDocId)
    ).rejects.toThrow();
  });
});
