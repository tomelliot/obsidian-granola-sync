import { loadCredentials } from "../../src/services/credentials";
import { requestUrl } from "obsidian";
import fs from "fs";
import {
  loadEncryptedCredentials,
  KeychainAccessError,
  DpapiAccessError,
  CredentialDecryptionError,
} from "../../src/services/granolaCredentialsCrypto";

jest.mock("obsidian");

jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock("../../src/services/granolaCredentialsCrypto", () => {
  class KeychainAccessError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "KeychainAccessError";
    }
  }
  class DpapiAccessError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "DpapiAccessError";
    }
  }
  class CredentialDecryptionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CredentialDecryptionError";
    }
  }
  return {
    loadEncryptedCredentials: jest.fn(),
    KeychainAccessError,
    DpapiAccessError,
    CredentialDecryptionError,
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

const mockAccessToken = "mock-access-token";
const mockRefreshToken = "mock-refresh-token";
const mockNewAccessToken = "mock-new-access-token";

interface TokensShape {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
  obtained_at: number;
  session_id: string;
  external_id: string;
}

function buildTokens(overrides: Partial<TokensShape> = {}): TokensShape {
  return {
    access_token: mockAccessToken,
    expires_in: 21600,
    refresh_token: mockRefreshToken,
    token_type: "Bearer",
    obtained_at: Date.now(),
    session_id: "session-123",
    external_id: "external-123",
    ...overrides,
  };
}

function storedAccountsFile(
  tokens: Partial<TokensShape> | string | null = {}
): string {
  const tokensField =
    typeof tokens === "string" || tokens === null
      ? tokens
      : JSON.stringify(buildTokens(tokens));
  return JSON.stringify({
    accounts: JSON.stringify([{ tokens: tokensField }]),
  });
}

describe("Credentials Service - Token Refresh", () => {
  const mockLoadEncrypted = loadEncryptedCredentials as jest.MockedFunction<
    typeof loadEncryptedCredentials
  >;
  const mockReadFile = fs.promises.readFile as jest.MockedFunction<
    typeof fs.promises.readFile
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should load credentials successfully when token is not expired", async () => {
    mockLoadEncrypted.mockResolvedValueOnce(storedAccountsFile());

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockAccessToken);
    expect(result.error).toBeNull();
    expect(mockLoadEncrypted).toHaveBeenCalledTimes(1);
  });

  it("should fall back to plaintext stored-accounts.json when encrypted files are missing", async () => {
    const missingEncryptedFile = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    mockLoadEncrypted.mockRejectedValueOnce(missingEncryptedFile);
    mockReadFile.mockResolvedValueOnce(storedAccountsFile());

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockAccessToken);
    expect(result.error).toBeNull();
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining("stored-accounts.json"),
      "utf-8"
    );
  });

  it("should refresh token when expired", async () => {
    const expiredTime = Date.now() - 6 * 60 * 60 * 1000;

    mockLoadEncrypted.mockResolvedValueOnce(
      storedAccountsFile({ obtained_at: expiredTime })
    );
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: {
        access_token: mockNewAccessToken,
        expires_in: 21600,
        token_type: "Bearer",
      },
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
    const expiresIn = 21600;
    const obtainedAt = Date.now() - expiresIn * 1000 + 3 * 60 * 1000;

    mockLoadEncrypted.mockResolvedValueOnce(
      storedAccountsFile({ expires_in: expiresIn, obtained_at: obtainedAt })
    );
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: {
        access_token: mockNewAccessToken,
        expires_in: 21600,
        token_type: "Bearer",
      },
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
  });

  it("should handle refresh token failure gracefully", async () => {
    const expiredTime = Date.now() - 6 * 60 * 60 * 1000;

    mockLoadEncrypted.mockResolvedValueOnce(
      storedAccountsFile({ obtained_at: expiredTime })
    );
    (requestUrl as jest.Mock).mockRejectedValueOnce(new Error("Refresh failed"));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Access token has expired and refresh failed");
  });

  it("should handle refresh response without new refresh_token", async () => {
    const expiredTime = Date.now() - 6 * 60 * 60 * 1000;

    mockLoadEncrypted.mockResolvedValueOnce(
      storedAccountsFile({ obtained_at: expiredTime })
    );
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: {
        access_token: mockNewAccessToken,
        expires_in: 21600,
        token_type: "Bearer",
      },
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
  });

  it("should include authorization header in refresh request", async () => {
    const expiredTime = Date.now() - 6 * 60 * 60 * 1000;

    mockLoadEncrypted.mockResolvedValueOnce(
      storedAccountsFile({ obtained_at: expiredTime })
    );
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: {
        access_token: mockNewAccessToken,
        expires_in: 21600,
        token_type: "Bearer",
      },
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
    mockReadFile.mockRejectedValueOnce(error);

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
    expect(result.errorKind).toBe("keychain");
  });

  it("should surface DPAPI failures with a Windows-specific message", async () => {
    mockLoadEncrypted.mockRejectedValueOnce(
      new DpapiAccessError("CRYPT_E_DECRYPT_FAILED")
    );

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Windows DPAPI");
    expect(result.error).not.toContain("system keychain");
    expect(result.errorKind).toBe("dpapi");
  });

  it("should surface decryption failures with a friendly message", async () => {
    mockLoadEncrypted.mockRejectedValueOnce(
      new CredentialDecryptionError("auth tag mismatch")
    );

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Failed to decrypt Granola credentials");
  });

  it("should handle invalid JSON format in the decrypted payload", async () => {
    mockLoadEncrypted.mockResolvedValueOnce("invalid json");

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Invalid JSON format");
  });

  it("should handle missing accounts field", async () => {
    mockLoadEncrypted.mockResolvedValueOnce(JSON.stringify({}));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Missing 'accounts' field");
  });

  it("should handle empty accounts array", async () => {
    mockLoadEncrypted.mockResolvedValueOnce(
      JSON.stringify({ accounts: JSON.stringify([]) })
    );

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("No accounts found");
  });

  it("should handle account missing tokens field", async () => {
    mockLoadEncrypted.mockResolvedValueOnce(
      JSON.stringify({ accounts: JSON.stringify([{}]) })
    );

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Missing 'tokens' field");
  });

  it("should handle missing access_token in tokens", async () => {
    const tokensWithoutAccess = JSON.stringify({
      expires_in: 21600,
      refresh_token: mockRefreshToken,
      token_type: "Bearer",
      obtained_at: Date.now(),
      session_id: "session-123",
      external_id: "external-123",
    });
    mockLoadEncrypted.mockResolvedValueOnce(
      JSON.stringify({
        accounts: JSON.stringify([{ tokens: tokensWithoutAccess }]),
      })
    );

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Missing 'access_token' field");
  });
});
