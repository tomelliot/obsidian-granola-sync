import { loadCredentials } from "../../src/services/credentials";
import { requestUrl } from "obsidian";
import fs from "fs";
import http from "http";

// Mock the modules
jest.mock("obsidian");
jest.mock("fs");
jest.mock("http");

// Mock the logger
jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock PLUGIN_VERSION global constant
(global as any).PLUGIN_VERSION = "1.0.0-test";

describe("Credentials Service - Token Refresh", () => {
  const mockAccessToken = "mock-access-token";
  const mockRefreshToken = "mock-refresh-token";
  const mockNewAccessToken = "mock-new-access-token";
  let mockServer: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock fs.promises
    (fs.promises as any) = {
      writeFile: jest.fn().mockResolvedValue(undefined),
    };

    // Mock http server
    mockServer = {
      listen: jest.fn((port, host, callback) => {
        callback();
      }),
      close: jest.fn((callback) => {
        if (callback) callback();
      }),
      on: jest.fn(),
    };

    (http.createServer as jest.Mock).mockReturnValue(mockServer);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should load credentials successfully when token is not expired", async () => {
    const currentTime = Date.now();
    const mockTokenData = {
      workos_tokens: JSON.stringify({
        access_token: mockAccessToken,
        expires_in: 21600, // 6 hours
        refresh_token: mockRefreshToken,
        token_type: "Bearer",
        obtained_at: currentTime, // Just obtained
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: mockTokenData,
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockAccessToken);
    expect(result.error).toBeNull();
    expect(requestUrl).toHaveBeenCalledTimes(1);
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  it("should refresh token when expired and save to file", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - (6 * 60 * 60 * 1000); // 6 hours ago
    
    const mockTokenData = {
      workos_tokens: JSON.stringify({
        access_token: mockAccessToken,
        expires_in: 21600, // 6 hours
        refresh_token: mockRefreshToken,
        token_type: "Bearer",
        obtained_at: expiredTime, // Expired
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    const mockRefreshResponse = {
      access_token: mockNewAccessToken,
      expires_in: 21600,
      token_type: "Bearer",
    };

    // First call returns expired token
    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({
        json: mockTokenData,
      })
      // Second call is the refresh request
      .mockResolvedValueOnce({
        json: mockRefreshResponse,
      });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
    expect(requestUrl).toHaveBeenCalledTimes(2);
    
    // Check that refresh was called with correct parameters
    const refreshCall = (requestUrl as jest.Mock).mock.calls[1][0];
    expect(refreshCall.url).toBe("https://api.granola.ai/v1/refresh-access-token");
    expect(refreshCall.method).toBe("POST");
    expect(JSON.parse(refreshCall.body)).toEqual({
      refresh_token: mockRefreshToken,
      provider: "workos",
    });

    // Check that tokens were saved to file
    expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
  });

  it("should refresh token when it will expire soon (within 5 minutes)", async () => {
    const currentTime = Date.now();
    const expiresIn = 21600; // 6 hours
    // Set obtained_at so that token expires in 3 minutes
    const obtainedAt = currentTime - (expiresIn * 1000) + (3 * 60 * 1000);
    
    const mockTokenData = {
      workos_tokens: JSON.stringify({
        access_token: mockAccessToken,
        expires_in: expiresIn,
        refresh_token: mockRefreshToken,
        token_type: "Bearer",
        obtained_at: obtainedAt,
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    const mockRefreshResponse = {
      access_token: mockNewAccessToken,
      expires_in: 21600,
      token_type: "Bearer",
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({
        json: mockTokenData,
      })
      .mockResolvedValueOnce({
        json: mockRefreshResponse,
      });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
  });

  it("should handle refresh token failure gracefully", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - (6 * 60 * 60 * 1000);
    
    const mockTokenData = {
      workos_tokens: JSON.stringify({
        access_token: mockAccessToken,
        expires_in: 21600,
        refresh_token: mockRefreshToken,
        token_type: "Bearer",
        obtained_at: expiredTime,
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    // First call returns expired token
    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({
        json: mockTokenData,
      })
      // Second call (refresh) fails
      .mockRejectedValueOnce(new Error("Refresh failed"));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Access token has expired and refresh failed");
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  it("should preserve refresh_token when response includes new one", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - (6 * 60 * 60 * 1000);
    const newRefreshToken = "new-refresh-token";
    
    const mockTokenData = {
      workos_tokens: JSON.stringify({
        access_token: mockAccessToken,
        expires_in: 21600,
        refresh_token: mockRefreshToken,
        token_type: "Bearer",
        obtained_at: expiredTime,
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    const mockRefreshResponse = {
      access_token: mockNewAccessToken,
      expires_in: 21600,
      refresh_token: newRefreshToken,
      token_type: "Bearer",
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({
        json: mockTokenData,
      })
      .mockResolvedValueOnce({
        json: mockRefreshResponse,
      });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
    
    // Check that the saved tokens include the new refresh token
    const writeFileCall = (fs.promises.writeFile as jest.Mock).mock.calls[0];
    const savedData = JSON.parse(writeFileCall[1]);
    const savedTokens = JSON.parse(savedData.workos_tokens);
    expect(savedTokens.refresh_token).toBe(newRefreshToken);
  });

  it("should keep original refresh_token when response doesn't include one", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - (6 * 60 * 60 * 1000);
    
    const mockTokenData = {
      workos_tokens: JSON.stringify({
        access_token: mockAccessToken,
        expires_in: 21600,
        refresh_token: mockRefreshToken,
        token_type: "Bearer",
        obtained_at: expiredTime,
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    const mockRefreshResponse = {
      access_token: mockNewAccessToken,
      expires_in: 21600,
      token_type: "Bearer",
      // No refresh_token in response
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({
        json: mockTokenData,
      })
      .mockResolvedValueOnce({
        json: mockRefreshResponse,
      });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
    
    // Check that the saved tokens include the original refresh token
    const writeFileCall = (fs.promises.writeFile as jest.Mock).mock.calls[0];
    const savedData = JSON.parse(writeFileCall[1]);
    const savedTokens = JSON.parse(savedData.workos_tokens);
    expect(savedTokens.refresh_token).toBe(mockRefreshToken);
  });

  it("should update obtained_at timestamp when refreshing token", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - (6 * 60 * 60 * 1000);
    
    const mockTokenData = {
      workos_tokens: JSON.stringify({
        access_token: mockAccessToken,
        expires_in: 21600,
        refresh_token: mockRefreshToken,
        token_type: "Bearer",
        obtained_at: expiredTime,
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    const mockRefreshResponse = {
      access_token: mockNewAccessToken,
      expires_in: 21600,
      token_type: "Bearer",
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({
        json: mockTokenData,
      })
      .mockResolvedValueOnce({
        json: mockRefreshResponse,
      });

    const beforeRefresh = Date.now();
    await loadCredentials();
    const afterRefresh = Date.now();

    // Check that obtained_at was updated to current time
    const writeFileCall = (fs.promises.writeFile as jest.Mock).mock.calls[0];
    const savedData = JSON.parse(writeFileCall[1]);
    const savedTokens = JSON.parse(savedData.workos_tokens);
    
    expect(savedTokens.obtained_at).toBeGreaterThanOrEqual(beforeRefresh);
    expect(savedTokens.obtained_at).toBeLessThanOrEqual(afterRefresh);
  });

  it("should include authorization header in refresh request", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - (6 * 60 * 60 * 1000);
    
    const mockTokenData = {
      workos_tokens: JSON.stringify({
        access_token: mockAccessToken,
        expires_in: 21600,
        refresh_token: mockRefreshToken,
        token_type: "Bearer",
        obtained_at: expiredTime,
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    const mockRefreshResponse = {
      access_token: mockNewAccessToken,
      expires_in: 21600,
      token_type: "Bearer",
    };

    (requestUrl as jest.Mock)
      .mockResolvedValueOnce({
        json: mockTokenData,
      })
      .mockResolvedValueOnce({
        json: mockRefreshResponse,
      });

    await loadCredentials();

    const refreshCall = (requestUrl as jest.Mock).mock.calls[1][0];
    expect(refreshCall.headers.Authorization).toBe(`Bearer ${mockAccessToken}`);
    expect(refreshCall.headers["Content-Type"]).toBe("application/json");
  });
});
