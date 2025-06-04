import { loadCredentials, startCredentialsServer, stopCredentialsServer } from "../../src/services/credentials";

// Mock the requestUrl function from Obsidian
const mockRequestUrl = jest.fn();

// Mock fs and http modules
const mockHttpServer = {
  listen: jest.fn((port, host, callback) => {
    if (callback) callback();
    return mockHttpServer;
  }),
  close: jest.fn((callback) => {
    if (callback) callback();
  }),
};

const mockHttp = {
  createServer: jest.fn(() => mockHttpServer) as any,
};

const mockFs = {
  readFile: jest.fn(),
};

jest.mock("obsidian", () => ({
  requestUrl: mockRequestUrl,
}));

jest.mock("http", () => mockHttp);
jest.mock("fs", () => mockFs);
jest.mock("path", () => ({
  join: jest.fn((...args) => args.join("/")),
}));
jest.mock("os", () => ({
  homedir: jest.fn(() => "/Users/testuser"),
}));

describe("Credentials Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("loadCredentials", () => {
    it("should load credentials successfully", async () => {
      const mockCredentialsData = {
        cognito_tokens: JSON.stringify({
          access_token: "test-access-token-123",
          refresh_token: "test-refresh-token-456",
          expires_at: "2024-12-31T23:59:59Z"
        }),
        user_id: "user123"
      };

      mockRequestUrl.mockResolvedValue({
        json: mockCredentialsData
      });

      const result = await loadCredentials();

      expect(result.accessToken).toBe("test-access-token-123");
      expect(result.error).toBeNull();

      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: "http://127.0.0.1:2590/",
        method: "GET",
        throw: true,
      });
    });

    it("should handle string JSON response", async () => {
      const mockCredentialsData = {
        cognito_tokens: JSON.stringify({
          access_token: "string-response-token",
          refresh_token: "refresh-token"
        })
      };

      // Mock response as a string instead of object
      mockRequestUrl.mockResolvedValue({
        json: JSON.stringify(mockCredentialsData)
      });

      const result = await loadCredentials();

      expect(result.accessToken).toBe("string-response-token");
      expect(result.error).toBeNull();
    });

    it("should handle missing access token", async () => {
      const mockCredentialsData = {
        cognito_tokens: JSON.stringify({
          refresh_token: "test-refresh-token-456"
          // access_token is missing
        })
      };

      mockRequestUrl.mockResolvedValue({
        json: mockCredentialsData
      });

      const result = await loadCredentials();

      expect(result.accessToken).toBeNull();
      expect(result.error).toBe("No access token found in credentials file. The token may have expired.");
    });

    it("should handle invalid JSON in cognito_tokens", async () => {
      const mockCredentialsData = {
        cognito_tokens: "invalid-json-string"
      };

      mockRequestUrl.mockResolvedValue({
        json: mockCredentialsData
      });

      const result = await loadCredentials();

      expect(result.accessToken).toBeNull();
      expect(result.error).toBe("Invalid JSON format in credentials response. Please ensure the server returns valid JSON.");
    });

    it("should handle invalid JSON in main response", async () => {
      mockRequestUrl.mockResolvedValue({
        json: "not-valid-json"
      });

      const result = await loadCredentials();

      expect(result.accessToken).toBeNull();
      expect(result.error).toBe("Invalid JSON format in credentials response. Please ensure the server returns valid JSON.");
    });

    it("should handle server connection errors", async () => {
      const connectionError = new Error("Connection refused");
      mockRequestUrl.mockRejectedValue(connectionError);

      const result = await loadCredentials();

      expect(result.accessToken).toBeNull();
      expect(result.error).toBe("Failed to load credentials from http://127.0.0.1:2590/. Please check if the credentials server is running.");
    });

    it("should handle HTTP errors", async () => {
      const httpError = new Error("HTTP 404");
      mockRequestUrl.mockRejectedValue(httpError);

      const result = await loadCredentials();

      expect(result.accessToken).toBeNull();
      expect(result.error).toBe("Failed to load credentials from http://127.0.0.1:2590/. Please check if the credentials server is running.");
    });

    it("should handle empty response", async () => {
      mockRequestUrl.mockResolvedValue({
        json: {}
      });

      const result = await loadCredentials();

      expect(result.accessToken).toBeNull();
      expect(result.error).toBe("Invalid JSON format in credentials response. Please ensure the server returns valid JSON.");
    });
  });

  describe("startCredentialsServer", () => {
    it("should start the server on correct port and host", () => {
      startCredentialsServer();

      expect(mockHttp.createServer).toHaveBeenCalledWith(expect.any(Function));
      expect(mockHttpServer.listen).toHaveBeenCalledWith(
        2590,
        "127.0.0.1",
        expect.any(Function)
      );
    });

    it("should serve supabase.json file when requested", () => {
      let requestHandler: any;
      mockHttp.createServer.mockImplementation((handler) => {
        requestHandler = handler;
        return mockHttpServer;
      });

      mockFs.readFile.mockImplementation((path, callback) => {
        callback(null, '{"test": "data"}');
      });

      startCredentialsServer();

      const mockReq = { url: "/supabase.json" };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
      };

      requestHandler(mockReq, mockRes);

      expect(mockFs.readFile).toHaveBeenCalledWith(
        "/Users/testuser/Library/Application Support/Granola/supabase.json",
        expect.any(Function)
      );
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
      expect(mockRes.end).toHaveBeenCalledWith('{"test": "data"}');
    });

    it("should serve supabase.json file when root path is requested", () => {
      let requestHandler: any;
      mockHttp.createServer.mockImplementation((handler) => {
        requestHandler = handler;
        return mockHttpServer;
      });

      mockFs.readFile.mockImplementation((path, callback) => {
        callback(null, '{"root": "response"}');
      });

      startCredentialsServer();

      const mockReq = { url: "/" };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
      };

      requestHandler(mockReq, mockRes);

      expect(mockFs.readFile).toHaveBeenCalled();
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
      expect(mockRes.end).toHaveBeenCalledWith('{"root": "response"}');
    });

    it("should handle file not found errors", () => {
      let requestHandler: any;
      mockHttp.createServer.mockImplementation((handler) => {
        requestHandler = handler;
        return mockHttpServer;
      });

      mockFs.readFile.mockImplementation((path, callback) => {
        const error = new Error("ENOENT: no such file or directory");
        (error as any).code = "ENOENT";
        callback(error, null);
      });

      startCredentialsServer();

      const mockReq = { url: "/supabase.json" };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
      };

      requestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "text/plain" });
      expect(mockRes.end).toHaveBeenCalledWith("File not found");
    });

    it("should handle requests to unknown paths", () => {
      let requestHandler: any;
      mockHttp.createServer.mockImplementation((handler) => {
        requestHandler = handler;
        return mockHttpServer;
      });

      startCredentialsServer();

      const mockReq = { url: "/unknown-path" };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn(),
      };

      requestHandler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "text/plain" });
      expect(mockRes.end).toHaveBeenCalledWith("Not found");
    });
  });

  describe("stopCredentialsServer", () => {
    it("should stop the server if it exists", () => {
      // Start server first
      startCredentialsServer();
      
      // Then stop it
      stopCredentialsServer();

      expect(mockHttpServer.close).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should handle stopping when no server is running", () => {
      // Should not throw an error
      expect(() => stopCredentialsServer()).not.toThrow();
    });
  });

  describe("process event handlers", () => {
    it("should set up process exit handlers when starting server", () => {
      const originalProcess = global.process;
      const mockProcess = {
        ...originalProcess,
        on: jest.fn(),
      };
      global.process = mockProcess as any;

      startCredentialsServer();

      expect(mockProcess.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith("exit", expect.any(Function));

      global.process = originalProcess;
    });
  });
});