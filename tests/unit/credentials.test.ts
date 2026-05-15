import { loadCredentials } from "../../src/services/credentials";
import { requestUrl } from "obsidian";
import {
  loadEncryptedCredentials,
  KeychainAccessError,
  CredentialDecryptionError,
  UnsupportedPlatformError,
} from "../../src/services/granolaCredentialsCrypto";

jest.mock("obsidian");

jest.mock("../../src/services/granolaCredentialsCrypto", () => {
  class KeychainAccessError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "KeychainAccessError";
    }
  }
  class CredentialDecryptionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CredentialDecryptionError";
    }
  }
  class UnsupportedPlatformError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "UnsupportedPlatformError";
    }
  }
  return {
    loadEncryptedCredentials: jest.fn(),
    KeychainAccessError,
    CredentialDecryptionError,
    UnsupportedPlatformError,
  };
});

jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

(global as unknown as { PLUGIN_VERSION: string }).PLUGIN_VERSION = "1.0.0-test";

describe("Credentials Service - Token Refresh", () => {
  const mockAccessToken = "mock-access-token";
  const mockRefreshToken = "mock-refresh-token";
  const mockNewAccessToken = "mock-new-access-token";

  const mockLoadEncrypted = loadEncryptedCredentials as jest.MockedFunction<
    typeof loadEncryptedCredentials
  >;

  beforeEach(() => {
    jest.clearAllMocks();
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
        obtained_at: currentTime,
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    mockLoadEncrypted.mockResolvedValueOnce(JSON.stringify(mockTokenData));

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockAccessToken);
    expect(result.error).toBeNull();
    expect(mockLoadEncrypted).toHaveBeenCalledTimes(1);
  });

  it("should refresh token when expired", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - 6 * 60 * 60 * 1000;

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

    mockLoadEncrypted.mockResolvedValueOnce(JSON.stringify(mockTokenData));
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: mockRefreshResponse,
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
    expect(mockLoadEncrypted).toHaveBeenCalledTimes(1);
    expect(requestUrl).toHaveBeenCalledTimes(1);

    const refreshCall = (requestUrl as jest.Mock).mock.calls[0][0];
    expect(refreshCall.url).toBe(
      "https://api.granola.ai/v1/refresh-access-token"
    );
    expect(refreshCall.method).toBe("POST");
    expect(JSON.parse(refreshCall.body)).toEqual({
      refresh_token: mockRefreshToken,
      provider: "workos",
    });
  });

  it("should refresh token when it will expire soon (within 5 minutes)", async () => {
    const currentTime = Date.now();
    const expiresIn = 21600;
    const obtainedAt = currentTime - expiresIn * 1000 + 3 * 60 * 1000;

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

    mockLoadEncrypted.mockResolvedValueOnce(JSON.stringify(mockTokenData));
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: mockRefreshResponse,
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
  });

  it("should handle refresh token failure gracefully", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - 6 * 60 * 60 * 1000;

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

    mockLoadEncrypted.mockResolvedValueOnce(JSON.stringify(mockTokenData));
    (requestUrl as jest.Mock).mockRejectedValueOnce(new Error("Refresh failed"));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Access token has expired and refresh failed");
  });

  it("should handle refresh response without new refresh_token", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - 6 * 60 * 60 * 1000;

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

    mockLoadEncrypted.mockResolvedValueOnce(JSON.stringify(mockTokenData));
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: mockRefreshResponse,
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
  });

  it("should include authorization header in refresh request", async () => {
    const currentTime = Date.now();
    const expiredTime = currentTime - 6 * 60 * 60 * 1000;

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

    mockLoadEncrypted.mockResolvedValueOnce(JSON.stringify(mockTokenData));
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: mockRefreshResponse,
    });

    await loadCredentials();

    const refreshCall = (requestUrl as jest.Mock).mock.calls[0][0];
    expect(refreshCall.headers.Authorization).toBe(`Bearer ${mockAccessToken}`);
    expect(refreshCall.headers["Content-Type"]).toBe("application/json");
  });

  it("should handle file not found error", async () => {
    const error = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    mockLoadEncrypted.mockRejectedValueOnce(error);

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Granola credentials file not found");
  });

  it("should handle permission denied error", async () => {
    const error = Object.assign(new Error("Permission denied"), {
      code: "EACCES",
    });
    mockLoadEncrypted.mockRejectedValueOnce(error);

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Permission denied");
  });

  it("should surface keychain access failures with a friendly message", async () => {
    mockLoadEncrypted.mockRejectedValueOnce(
      new KeychainAccessError("security exited non-zero")
    );

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("system keychain");
  });

  it("should surface decryption failures with a friendly message", async () => {
    mockLoadEncrypted.mockRejectedValueOnce(
      new CredentialDecryptionError("auth tag mismatch")
    );

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Failed to decrypt Granola credentials");
  });

  it("should surface unsupported platform errors verbatim", async () => {
    mockLoadEncrypted.mockRejectedValueOnce(
      new UnsupportedPlatformError(
        "Encrypted Granola credentials are not yet supported on this platform"
      )
    );

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain(
      "Encrypted Granola credentials are not yet supported"
    );
  });

  it("should handle invalid JSON format in the decrypted payload", async () => {
    mockLoadEncrypted.mockResolvedValueOnce("invalid json");

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Invalid JSON format");
  });

  it("should handle missing workos_tokens field", async () => {
    mockLoadEncrypted.mockResolvedValueOnce(JSON.stringify({}));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Missing or invalid 'workos_tokens' field");
  });

  it("should handle missing access_token in workos_tokens", async () => {
    const mockTokenData = {
      workos_tokens: JSON.stringify({
        expires_in: 21600,
        refresh_token: mockRefreshToken,
        token_type: "Bearer",
        obtained_at: Date.now(),
        session_id: "session-123",
        external_id: "external-123",
      }),
    };

    mockLoadEncrypted.mockResolvedValueOnce(JSON.stringify(mockTokenData));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Missing 'access_token' field");
  });
});
