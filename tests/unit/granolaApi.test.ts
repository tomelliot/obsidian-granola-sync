import * as v from "valibot";
import {
  printValidationIssuePaths,
  fetchGranolaDocuments,
  fetchAllGranolaDocuments,
  fetchGranolaDocumentsByDaysBack,
  fetchGranolaTranscript,
  fetchDocumentSet,
  fetchDocumentsBatch,
  getAllDocuments,
  getRecentDocuments,
} from "../../src/services/granolaApi";
import {
  GranolaApiResponseSchema,
  TranscriptResponseSchema,
  DocumentSetResponseSchema,
  DocumentsBatchResponseSchema,
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should not print anything when validation succeeds", () => {
    const validData = { docs: [] };
    const result = v.safeParse(GranolaApiResponseSchema, validData);

    printValidationIssuePaths(result);

    // Just verify it doesn't throw
    expect(result.success).toBe(true);
  });

  it("should print validation errors with path", () => {
    const invalidData = { docs: [{ id: 123 }] };
    const result = v.safeParse(GranolaApiResponseSchema, invalidData);

    printValidationIssuePaths(result);

    expect(result.success).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it("should handle validation errors without path (empty path array)", () => {
    // Create a schema that will produce an error with empty path
    const schema = v.object({ docs: v.array(v.any()) });
    const invalidData = { not_docs: "value" };
    const result = v.safeParse(schema, invalidData);

    printValidationIssuePaths(result);

    expect(result.success).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it("should handle path with non-string/non-number keys", () => {
    // Create a validation error with an object key
    const schema = v.object({
      items: v.array(v.object({ id: v.string() })),
    });
    const invalidData = { items: [{ id: 123 }] };
    const result = v.safeParse(schema, invalidData);

    printValidationIssuePaths(result);

    expect(result.success).toBe(false);
    expect(log.error).toHaveBeenCalled();
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

  it("should parse documents with attachments: null (API may return null for no attachments)", async () => {
    const responseWithNullAttachments = {
      docs: [
        {
          id: "doc-null-attachments",
          title: "Note With Null Attachments",
          created_at: "2024-01-15T10:00:00Z",
          updated_at: "2024-01-15T12:00:00Z",
          attachments: null,
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
      json: responseWithNullAttachments,
    });

    const result = await fetchGranolaDocuments(mockAccessToken, 100, 0);

    expect(result).toHaveLength(1);
    const [doc] = result;
    expect(doc.id).toBe("doc-null-attachments");
    expect(doc.attachments).toBeNull();
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

  it("should stop when empty page is returned", async () => {
    const page1 = {
      docs: Array.from({ length: 100 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Note ${i}`,
        last_viewed_panel: { content: { type: "doc", content: [] } },
      })),
    };
    const emptyPage = { docs: [] };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: page1 })
      .mockResolvedValueOnce({ json: emptyPage });

    const result = await fetchAllGranolaDocuments(mockAccessToken, 100);

    expect(result).toHaveLength(100);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("should handle pagination when page is full", async () => {
    const page1 = {
      docs: Array.from({ length: 100 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Note ${i}`,
        last_viewed_panel: { content: { type: "doc", content: [] } },
      })),
    };
    const page2 = {
      docs: Array.from({ length: 50 }, (_, i) => ({
        id: `doc-${i + 100}`,
        title: `Note ${i + 100}`,
        last_viewed_panel: { content: { type: "doc", content: [] } },
      })),
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: page1 })
      .mockResolvedValueOnce({ json: page2 });

    const result = await fetchAllGranolaDocuments(mockAccessToken, 100);

    expect(result).toHaveLength(150);
    expect(requestUrl).toHaveBeenCalledTimes(2);
    // Verify offset was incremented
    expect(requestUrl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.stringContaining('"offset":100'),
      })
    );
  });

  it("should stop when page is not full", async () => {
    const partialPage = {
      docs: Array.from({ length: 50 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Note ${i}`,
        last_viewed_panel: { content: { type: "doc", content: [] } },
      })),
    };

    (requestUrl as jest.Mock).mockResolvedValueOnce({ json: partialPage });

    const result = await fetchAllGranolaDocuments(mockAccessToken, 100);

    expect(result).toHaveLength(50);
    expect(requestUrl).toHaveBeenCalledTimes(1);
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

  it("should fetch all documents when daysBack is 0", async () => {
    const page1 = {
      docs: Array.from({ length: 50 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Note ${i}`,
        created_at: "2024-01-18T10:00:00Z",
        last_viewed_panel: { content: { type: "doc", content: [] } },
      })),
    };

    (requestUrl as jest.Mock).mockResolvedValueOnce({ json: page1 });

    const result = await fetchGranolaDocumentsByDaysBack(mockAccessToken, 0);

    expect(result).toHaveLength(50);
  });

  it("should stop when empty page is returned", async () => {
    const page1 = {
      docs: Array.from({ length: 100 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Note ${i}`,
        created_at: "2024-01-18T10:00:00Z",
        last_viewed_panel: { content: { type: "doc", content: [] } },
      })),
    };
    const emptyPage = { docs: [] };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: page1 })
      .mockResolvedValueOnce({ json: emptyPage });

    const result = await fetchGranolaDocumentsByDaysBack(mockAccessToken, 7);

    expect(result).toHaveLength(100);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("should handle pagination when all documents are recent", async () => {
    const page1 = {
      docs: Array.from({ length: 100 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Note ${i}`,
        created_at: "2024-01-18T10:00:00Z",
        last_viewed_panel: { content: { type: "doc", content: [] } },
      })),
    };
    const page2 = {
      docs: Array.from({ length: 50 }, (_, i) => ({
        id: `doc-${i + 100}`,
        title: `Note ${i + 100}`,
        created_at: "2024-01-17T10:00:00Z",
        last_viewed_panel: { content: { type: "doc", content: [] } },
      })),
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: page1 })
      .mockResolvedValueOnce({ json: page2 });

    const result = await fetchGranolaDocumentsByDaysBack(mockAccessToken, 7);

    expect(result).toHaveLength(150);
    expect(requestUrl).toHaveBeenCalledTimes(2);
    // Verify offset was incremented
    expect(requestUrl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.stringContaining('"offset":100'),
      })
    );
  });

  it("should use updated_at when created_at is missing", async () => {
    const doc = {
      id: "doc-1",
      title: "Note",
      updated_at: "2024-01-18T10:00:00Z",
      last_viewed_panel: { content: { type: "doc", content: [] } },
    };

    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: { docs: [doc] },
    });

    const result = await fetchGranolaDocumentsByDaysBack(mockAccessToken, 7);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("doc-1");
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

describe("fetchDocumentSet", () => {
  const mockAccessToken = "test-token";

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).PLUGIN_VERSION = "1.0.0";
  });

  it("should return document set keyed by ID", async () => {
    const mockResponse = {
      documents: {
        "doc-1": { updated_at: "2024-01-15T10:00:00Z", owner: true },
        "doc-2": { updated_at: "2024-01-16T10:00:00Z", shared: true },
      },
    };
    (requestUrl as jest.Mock).mockResolvedValue({ json: mockResponse });

    const result = await fetchDocumentSet(mockAccessToken);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result["doc-1"]).toEqual({ updated_at: "2024-01-15T10:00:00Z", owner: true });
    expect(result["doc-2"]).toEqual({ updated_at: "2024-01-16T10:00:00Z", shared: true });
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.granola.ai/v1/get-document-set",
        method: "POST",
      })
    );
  });

  it("should handle empty document set", async () => {
    (requestUrl as jest.Mock).mockResolvedValue({
      json: { documents: {} },
    });

    const result = await fetchDocumentSet(mockAccessToken);

    expect(Object.keys(result)).toHaveLength(0);
  });

  it("should throw on invalid response", async () => {
    (requestUrl as jest.Mock).mockResolvedValue({
      json: { not_documents: {} },
    });

    await expect(fetchDocumentSet(mockAccessToken)).rejects.toThrow(
      "Invalid response from Granola API (DocumentSetResponseSchema)"
    );
  });
});

describe("fetchDocumentsBatch", () => {
  const mockAccessToken = "test-token";

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).PLUGIN_VERSION = "1.0.0";
  });

  it("should return empty array for empty input", async () => {
    const result = await fetchDocumentsBatch(mockAccessToken, []);

    expect(result).toEqual([]);
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("should fetch documents by IDs", async () => {
    const mockResponse = {
      docs: [
        { id: "doc-1", title: "Shared Note" },
        { id: "doc-2", title: "Another Shared Note" },
      ],
    };
    (requestUrl as jest.Mock).mockResolvedValue({ json: mockResponse });

    const result = await fetchDocumentsBatch(mockAccessToken, ["doc-1", "doc-2"]);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("doc-1");
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.granola.ai/v1/get-documents-batch",
        body: JSON.stringify({ document_ids: ["doc-1", "doc-2"] }),
      })
    );
  });

  it("should throw on invalid response", async () => {
    (requestUrl as jest.Mock).mockResolvedValue({
      json: { not_docs: [] },
    });

    await expect(
      fetchDocumentsBatch(mockAccessToken, ["doc-1"])
    ).rejects.toThrow("Invalid response from Granola API (DocumentsBatchResponseSchema)");
  });
});

describe("getAllDocuments", () => {
  const mockAccessToken = "test-token";
  const makeDoc = (id: string) => ({
    id,
    title: `Note ${id}`,
    last_viewed_panel: { content: { type: "doc", content: [] } },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).PLUGIN_VERSION = "1.0.0";
  });

  it("should merge shared documents into owned documents", async () => {
    // First call: fetchAllGranolaDocuments (owned docs, 1 page)
    // Second call: fetchDocumentSet
    // Third call: fetchDocumentsBatch (shared docs)
    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: { docs: [makeDoc("owned-1")] } })
      .mockResolvedValueOnce({
        json: {
          documents: {
            "owned-1": { updated_at: "2024-01-15T10:00:00Z", owner: true },
            "shared-1": { updated_at: "2024-01-16T10:00:00Z", shared: true },
          },
        },
      })
      .mockResolvedValueOnce({ json: { docs: [makeDoc("shared-1")] } });

    const result = await getAllDocuments(mockAccessToken);

    expect(result).toHaveLength(2);
    expect(result.map((d) => d.id).sort()).toEqual(["owned-1", "shared-1"]);
  });

  it("should return only owned docs when no shared docs exist", async () => {
    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: { docs: [makeDoc("owned-1")] } })
      .mockResolvedValueOnce({
        json: {
          documents: {
            "owned-1": { updated_at: "2024-01-15T10:00:00Z", owner: true },
          },
        },
      });

    const result = await getAllDocuments(mockAccessToken);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("owned-1");
    // fetchDocumentsBatch should not have been called
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("should gracefully fall back when document set fetch fails", async () => {
    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: { docs: [makeDoc("owned-1")] } })
      .mockRejectedValueOnce(new Error("API error"));

    const result = await getAllDocuments(mockAccessToken);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("owned-1");
  });

  it("should gracefully fall back when batch fetch fails", async () => {
    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: { docs: [makeDoc("owned-1")] } })
      .mockResolvedValueOnce({
        json: {
          documents: {
            "owned-1": { updated_at: "2024-01-15T10:00:00Z", owner: true },
            "shared-1": { updated_at: "2024-01-16T10:00:00Z", shared: true },
          },
        },
      })
      .mockRejectedValueOnce(new Error("Batch API error"));

    const result = await getAllDocuments(mockAccessToken);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("owned-1");
  });

  it("should exclude deleted documents from batch results", async () => {
    const deletedDoc = {
      id: "deleted-1",
      title: null,
      deleted_at: "2024-01-14T10:00:00Z",
      last_viewed_panel: { content: { type: "doc", content: [] } },
    };
    const activeSharedDoc = {
      id: "shared-1",
      title: "Active Shared Note",
      deleted_at: null,
      last_viewed_panel: { content: { type: "doc", content: [] } },
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: { docs: [makeDoc("owned-1")] } })
      .mockResolvedValueOnce({
        json: {
          documents: {
            "owned-1": { updated_at: "2024-01-15T10:00:00Z", owner: true },
            "shared-1": { updated_at: "2024-01-16T10:00:00Z", shared: true },
            "deleted-1": { updated_at: "2024-01-14T10:00:00Z", shared: true },
          },
        },
      })
      .mockResolvedValueOnce({
        json: { docs: [activeSharedDoc, deletedDoc] },
      });

    const result = await getAllDocuments(mockAccessToken);

    expect(result).toHaveLength(2);
    const ids = result.map((d) => d.id).sort();
    expect(ids).toEqual(["owned-1", "shared-1"]);
    expect(result.find((d) => d.id === "deleted-1")).toBeUndefined();
  });

  it("should exclude all batch docs when all are deleted", async () => {
    const deletedDoc1 = {
      id: "deleted-1",
      title: null,
      deleted_at: "2024-01-14T10:00:00Z",
    };
    const deletedDoc2 = {
      id: "deleted-2",
      title: null,
      deleted_at: "2024-01-13T10:00:00Z",
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: { docs: [makeDoc("owned-1")] } })
      .mockResolvedValueOnce({
        json: {
          documents: {
            "owned-1": { updated_at: "2024-01-15T10:00:00Z", owner: true },
            "deleted-1": { updated_at: "2024-01-14T10:00:00Z" },
            "deleted-2": { updated_at: "2024-01-13T10:00:00Z" },
          },
        },
      })
      .mockResolvedValueOnce({
        json: { docs: [deletedDoc1, deletedDoc2] },
      });

    const result = await getAllDocuments(mockAccessToken);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("owned-1");
  });
});

describe("getRecentDocuments", () => {
  const mockAccessToken = "test-token";
  const makeDoc = (id: string, created_at: string) => ({
    id,
    title: `Note ${id}`,
    created_at,
    last_viewed_panel: { content: { type: "doc", content: [] } },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-20T12:00:00Z"));
    (global as any).PLUGIN_VERSION = "1.0.0";
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should include recent shared docs and exclude old ones", async () => {
    const ownedDoc = makeDoc("owned-1", "2024-01-18T10:00:00Z");

    // fetchGranolaDocumentsByDaysBack (1 page of owned docs)
    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: { docs: [ownedDoc] } })
      // fetchDocumentSet
      .mockResolvedValueOnce({
        json: {
          documents: {
            "owned-1": { updated_at: "2024-01-18T10:00:00Z", owner: true },
            "shared-recent": { updated_at: "2024-01-19T10:00:00Z", shared: true },
            "shared-old": { updated_at: "2024-01-01T10:00:00Z", shared: true },
          },
        },
      })
      // fetchDocumentsBatch (only shared-recent, shared-old filtered by cutoff)
      .mockResolvedValueOnce({
        json: { docs: [makeDoc("shared-recent", "2024-01-19T10:00:00Z")] },
      });

    const result = await getRecentDocuments(mockAccessToken, 7);

    expect(result).toHaveLength(2);
    const ids = result.map((d) => d.id).sort();
    expect(ids).toEqual(["owned-1", "shared-recent"]);
  });

  it("should exclude deleted shared docs from recent results", async () => {
    const ownedDoc = makeDoc("owned-1", "2024-01-18T10:00:00Z");

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: { docs: [ownedDoc] } })
      .mockResolvedValueOnce({
        json: {
          documents: {
            "owned-1": { updated_at: "2024-01-18T10:00:00Z", owner: true },
            "shared-active": { updated_at: "2024-01-19T10:00:00Z", shared: true },
            "shared-deleted": { updated_at: "2024-01-19T10:00:00Z", shared: true },
          },
        },
      })
      .mockResolvedValueOnce({
        json: {
          docs: [
            { ...makeDoc("shared-active", "2024-01-19T10:00:00Z"), deleted_at: null },
            { ...makeDoc("shared-deleted", "2024-01-19T10:00:00Z"), deleted_at: "2024-01-19T12:00:00Z" },
          ],
        },
      });

    const result = await getRecentDocuments(mockAccessToken, 7);

    expect(result).toHaveLength(2);
    const ids = result.map((d) => d.id).sort();
    expect(ids).toEqual(["owned-1", "shared-active"]);
  });

  it("should delegate to getAllDocuments when daysBack is 0", async () => {
    // daysBack=0 calls fetchAllGranolaDocuments internally
    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({ json: { docs: [makeDoc("owned-1", "2024-01-18T10:00:00Z")] } })
      .mockResolvedValueOnce({
        json: {
          documents: {
            "owned-1": { updated_at: "2024-01-18T10:00:00Z", owner: true },
            "shared-1": { updated_at: "2023-06-01T10:00:00Z", shared: true },
          },
        },
      })
      .mockResolvedValueOnce({
        json: { docs: [makeDoc("shared-1", "2023-06-01T10:00:00Z")] },
      });

    const result = await getRecentDocuments(mockAccessToken, 0);

    // daysBack=0 means no cutoff — all shared docs included
    expect(result).toHaveLength(2);
  });
});
