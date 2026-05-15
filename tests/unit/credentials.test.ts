import { loadCredentials } from "../../src/services/credentials";
import { requestUrl } from "obsidian";
import fs from "fs";

jest.mock("obsidian");
jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

(global as any).PLUGIN_VERSION = "1.0.0-test";

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
  tokens: TokensShape | undefined,
  extra: Record<string, unknown> = {}
): string {
  const account: Record<string, unknown> = {
    userId: "user-1",
    email: "user@example.com",
    userInfo: JSON.stringify({ id: "user-1" }),
    savedAt: Date.now(),
    ...extra,
  };
  if (tokens !== undefined) {
    account.tokens = JSON.stringify(tokens);
  }
  return JSON.stringify({ accounts: JSON.stringify([account]) });
}

function mockRead(response: string | Error): void {
  const mock = fs.promises.readFile as jest.Mock;
  mock.mockReset();
  if (response instanceof Error) {
    mock.mockRejectedValueOnce(response);
  } else {
    mock.mockResolvedValueOnce(response);
  }
}

describe("Credentials Service - stored-accounts.json", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads access token when not expired", async () => {
    mockRead(storedAccountsFile(buildTokens()));

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockAccessToken);
    expect(result.error).toBeNull();
    expect(fs.promises.readFile).toHaveBeenCalledTimes(1);
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("accepts already-parsed accounts/tokens objects", async () => {
    const tokens = buildTokens();
    mockRead(JSON.stringify({ accounts: [{ tokens }] }));

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockAccessToken);
    expect(result.error).toBeNull();
  });

  it("surfaces a helpful error when accounts array is empty", async () => {
    mockRead(JSON.stringify({ accounts: JSON.stringify([]) }));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("No accounts found");
  });

  it("surfaces a helpful error when the first account has no tokens", async () => {
    mockRead(storedAccountsFile(undefined));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Missing 'tokens' field");
  });

  it("reports missing 'accounts' field", async () => {
    mockRead(JSON.stringify({}));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Missing 'accounts' field");
  });
});

describe("Credentials Service - refresh behaviour", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("refreshes an expired token", async () => {
    const expiredAt = Date.now() - 6 * 60 * 60 * 1000;
    mockRead(storedAccountsFile(buildTokens({ obtained_at: expiredAt })));
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: { access_token: mockNewAccessToken, expires_in: 21600, token_type: "Bearer" },
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
    const call = (requestUrl as jest.Mock).mock.calls[0][0];
    expect(call.url).toBe("https://api.granola.ai/v1/refresh-access-token");
    expect(JSON.parse(call.body)).toEqual({
      refresh_token: mockRefreshToken,
      provider: "workos",
    });
  });

  it("refreshes when token expires within 5 minutes", async () => {
    const expiresIn = 21600;
    const obtainedAt = Date.now() - expiresIn * 1000 + 3 * 60 * 1000;
    mockRead(storedAccountsFile(buildTokens({ obtained_at: obtainedAt, expires_in: expiresIn })));
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: { access_token: mockNewAccessToken, expires_in: 21600, token_type: "Bearer" },
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
  });

  it("returns a clear error when refresh fails", async () => {
    const expiredAt = Date.now() - 6 * 60 * 60 * 1000;
    mockRead(storedAccountsFile(buildTokens({ obtained_at: expiredAt })));
    (requestUrl as jest.Mock).mockRejectedValueOnce(new Error("network down"));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Access token has expired and refresh failed");
  });

  it("uses the new refresh_token from the refresh response", async () => {
    const expiredAt = Date.now() - 6 * 60 * 60 * 1000;
    mockRead(storedAccountsFile(buildTokens({ obtained_at: expiredAt })));
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: {
        access_token: mockNewAccessToken,
        expires_in: 21600,
        token_type: "Bearer",
        refresh_token: "new-refresh-token",
      },
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
  });

  it("falls back to the existing refresh_token if not in response", async () => {
    const expiredAt = Date.now() - 6 * 60 * 60 * 1000;
    mockRead(storedAccountsFile(buildTokens({ obtained_at: expiredAt })));
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: { access_token: mockNewAccessToken, expires_in: 21600, token_type: "Bearer" },
    });

    const result = await loadCredentials();

    expect(result.accessToken).toBe(mockNewAccessToken);
    expect(result.error).toBeNull();
  });

  it("sends Authorization and Content-Type headers on refresh", async () => {
    const expiredAt = Date.now() - 6 * 60 * 60 * 1000;
    mockRead(storedAccountsFile(buildTokens({ obtained_at: expiredAt })));
    (requestUrl as jest.Mock).mockResolvedValueOnce({
      json: { access_token: mockNewAccessToken, expires_in: 21600, token_type: "Bearer" },
    });

    await loadCredentials();

    const call = (requestUrl as jest.Mock).mock.calls[0][0];
    expect(call.headers.Authorization).toBe(`Bearer ${mockAccessToken}`);
    expect(call.headers["Content-Type"]).toBe("application/json");
  });
});

describe("Credentials Service - error handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports file-not-found", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockRead(err);

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Credentials file not found");
    expect(result.error).toContain("Please ensure the Granola app has created the credentials file");
  });

  it("reports permission denied", async () => {
    const err = new Error("Permission denied") as NodeJS.ErrnoException;
    err.code = "EACCES";
    mockRead(err);

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Permission denied");
    expect(result.error).toContain("Please check file permissions");
  });

  it("reports invalid JSON", async () => {
    mockRead("not json at all");

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Invalid JSON format");
  });

  it("reports missing access_token inside the tokens object", async () => {
    const tokens = buildTokens();
    delete (tokens as Partial<TokensShape>).access_token;
    mockRead(storedAccountsFile(tokens as TokensShape));

    const result = await loadCredentials();

    expect(result.accessToken).toBeNull();
    expect(result.error).toContain("Missing 'access_token' field");
  });
});
