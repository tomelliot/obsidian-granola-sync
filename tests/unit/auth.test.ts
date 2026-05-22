import { resolveAuth } from "../../src/services/auth";
import { loadCredentials } from "../../src/services/credentials";
import { DEFAULT_SETTINGS, GranolaSyncSettings } from "../../src/settings";

jest.mock("../../src/services/credentials");
jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockLoadCredentials = loadCredentials as jest.MockedFunction<
  typeof loadCredentials
>;

function settings(overrides: Partial<GranolaSyncSettings> = {}): GranolaSyncSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("resolveAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("authMethod=api_key", () => {
    it("returns api_key auth when key looks valid", async () => {
      const result = await resolveAuth(
        settings({ authMethod: "api_key", apiKey: "grn_abc123" })
      );

      expect(result.auth).toEqual({ method: "api_key", token: "grn_abc123" });
      expect(result.error).toBeNull();
      expect(mockLoadCredentials).not.toHaveBeenCalled();
    });

    it("trims whitespace from the API key", async () => {
      const result = await resolveAuth(
        settings({ authMethod: "api_key", apiKey: "  grn_abc123  " })
      );

      expect(result.auth).toEqual({ method: "api_key", token: "grn_abc123" });
    });

    it("errors when the key is missing", async () => {
      const result = await resolveAuth(
        settings({ authMethod: "api_key", apiKey: "" })
      );

      expect(result.auth).toBeNull();
      expect(result.error).toContain("API key is required");
    });

    it("errors when the key is whitespace-only", async () => {
      const result = await resolveAuth(
        settings({ authMethod: "api_key", apiKey: "   " })
      );

      expect(result.auth).toBeNull();
      expect(result.error).toContain("API key is required");
    });

    it("errors when the key has the wrong prefix", async () => {
      const result = await resolveAuth(
        settings({ authMethod: "api_key", apiKey: "sk_abc123" })
      );

      expect(result.auth).toBeNull();
      expect(result.error).toContain("unexpected format");
    });
  });

  describe("authMethod=desktop", () => {
    it("delegates to loadCredentials and returns desktop auth on success", async () => {
      mockLoadCredentials.mockResolvedValueOnce({
        accessToken: "workos-token",
        error: null,
      });

      const result = await resolveAuth(settings({ authMethod: "desktop" }));

      expect(result.auth).toEqual({ method: "desktop", token: "workos-token" });
      expect(result.error).toBeNull();
      expect(mockLoadCredentials).toHaveBeenCalledTimes(1);
    });

    it("propagates the error from loadCredentials", async () => {
      mockLoadCredentials.mockResolvedValueOnce({
        accessToken: null,
        error: "Credentials file not found",
      });

      const result = await resolveAuth(settings({ authMethod: "desktop" }));

      expect(result.auth).toBeNull();
      expect(result.error).toBe("Credentials file not found");
    });
  });
});
