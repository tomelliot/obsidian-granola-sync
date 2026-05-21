import { requestUrl, Platform } from "obsidian";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "../utils/logger";

/**
 * The token object Granola persists per account, mirroring fields it writes to
 * `stored-accounts.json`. `account_email` is plugin metadata captured at
 * import time so we can show which account is signed in (the JWT often
 * doesn't carry the email itself).
 */
export interface WorkosTokens {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
  obtained_at: number;
  session_id?: string;
  external_id?: string;
  sign_in_method?: string;
  account_email?: string;
}

/**
 * Minimal slice of the plugin instance that credential loading needs. Defined
 * here (rather than importing `GranolaSync` from main.ts) to keep this module
 * cheap to test and avoid a circular import.
 */
export interface CredentialsHost {
  settings: {
    useCustomCredentials?: boolean;
  };
  app: {
    secretStorage: {
      getSecret(id: string): string | null;
      setSecret(id: string, secret: string): void;
    };
  };
}

export const CUSTOM_CREDENTIALS_SECRET_ID = "granola-sync-custom-credentials";

interface StoredAccount {
  tokens: string | WorkosTokens;
}

interface StoredAccountsData {
  accounts: string | StoredAccount[];
}

interface RefreshTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
}

function getTokenFilePath(): string {
  if (Platform.isWin) {
    return path.join(
      os.homedir(),
      "AppData",
      "Roaming",
      "Granola",
      "stored-accounts.json"
    );
  }
  if (Platform.isLinux) {
    return path.join(os.homedir(), ".config", "Granola", "stored-accounts.json");
  }
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Granola",
    "stored-accounts.json"
  );
}

const filePath = getTokenFilePath();

/**
 * Returns true if the access token has expired or expires within 5 minutes.
 */
function isTokenExpired(workosTokens: WorkosTokens): boolean {
  const expirationTime = workosTokens.obtained_at + workosTokens.expires_in * 1000;
  const bufferMs = 5 * 60 * 1000;
  const expired = Date.now() >= expirationTime - bufferMs;
  if (expired) {
    log.debug(
      `isTokenExpired=true — effective_expiry=${new Date(expirationTime - bufferMs).toISOString()}, now=${new Date().toISOString()}`
    );
  }
  return expired;
}

async function refreshAccessToken(workosTokens: WorkosTokens): Promise<WorkosTokens> {
  log.debug("Attempting to refresh access token");

  const response = await requestUrl({
    url: "https://api.granola.ai/v1/refresh-access-token",
    method: "POST",
    headers: {
      Authorization: `Bearer ${workosTokens.access_token}`,
      "Content-Type": "application/json",
      "User-Agent": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
      "X-Client-Version": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
    },
    body: JSON.stringify({
      refresh_token: workosTokens.refresh_token,
      provider: "workos",
    }),
  });

  const refreshResponse = response.json as RefreshTokenResponse;

  return {
    ...workosTokens,
    access_token: refreshResponse.access_token,
    // Floor at 60s so a pathological zero/negative from the API doesn't put us
    // in an infinite refresh loop on the next sync.
    expires_in: Math.max(refreshResponse.expires_in, 60),
    token_type: refreshResponse.token_type,
    obtained_at: Date.now(),
    refresh_token: refreshResponse.refresh_token ?? workosTokens.refresh_token,
  };
}

/**
 * Refreshes the access token against Granola's auth endpoint and writes the
 * refreshed token object back to Obsidian Keychain. Shared between the
 * custom-credentials branch of `loadCredentials` and `verifyCustomCredentials`.
 * Callers handle their own error reporting / logging.
 */
async function refreshAndStoreCustomCredentials(
  host: CredentialsHost,
  tokens: WorkosTokens
): Promise<WorkosTokens> {
  const refreshed = await refreshAccessToken(tokens);
  host.app.secretStorage.setSecret(
    CUSTOM_CREDENTIALS_SECRET_ID,
    JSON.stringify(refreshed)
  );
  return refreshed;
}

/**
 * Parses stored-accounts.json. `accounts` is a JSON-encoded string holding an
 * array; each account's `tokens` field is itself a JSON-encoded string of the
 * token object.
 */
function parseTokens(fileContents: string): WorkosTokens {
  const data = JSON.parse(fileContents) as StoredAccountsData;

  if (!data.accounts) {
    throw new Error(`Missing 'accounts' field in credentials file at ${filePath}.`);
  }

  const accounts: StoredAccount[] =
    typeof data.accounts === "string"
      ? (JSON.parse(data.accounts) as StoredAccount[])
      : data.accounts;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error(
      `No accounts found in credentials file at ${filePath}. Please sign in via the Granola app.`
    );
  }

  const account = accounts[0];
  if (!account.tokens) {
    throw new Error(
      `Missing 'tokens' field on first account in credentials file at ${filePath}.`
    );
  }

  return typeof account.tokens === "string"
    ? (JSON.parse(account.tokens) as WorkosTokens)
    : account.tokens;
}

export async function loadCredentials(plugin?: CredentialsHost): Promise<{
  accessToken: string | null;
  error: string | null;
}> {
  // Custom credentials mode: use Obsidian Keychain token, but only when explicitly enabled
  if (plugin?.settings.useCustomCredentials) {
    log.debug("loadCredentials — custom credentials enabled, checking Obsidian Keychain");
    const secretJson = plugin.app.secretStorage.getSecret(
      CUSTOM_CREDENTIALS_SECRET_ID
    );
    if (secretJson) {
      log.debug("loadCredentials — stored credentials found in Obsidian Keychain");
      let tokens: WorkosTokens;
      try {
        tokens = JSON.parse(secretJson) as WorkosTokens;
      } catch (parseError) {
        log.error("Failed to parse stored credentials JSON from Obsidian Keychain:", parseError);
        return {
          accessToken: null,
          error: "Stored credentials are malformed. Please re-paste your credentials in Settings.",
        };
      }
      log.debug(
        `loadCredentials — stored credentials metadata: ` +
        `token_type=${tokens.token_type ?? "unknown"}, ` +
        `expires_in=${tokens.expires_in}s, ` +
        `obtained_at=${tokens.obtained_at ? new Date(tokens.obtained_at).toISOString() : "missing"}`
      );
      if (isTokenExpired(tokens)) {
        log.debug("loadCredentials — stored credentials expired, refreshing");
        try {
          tokens = await refreshAndStoreCustomCredentials(plugin, tokens);
          log.debug("loadCredentials — stored credentials refreshed and saved");
        } catch (refreshError) {
          log.error("loadCredentials — failed to refresh stored credentials:", refreshError);
          return {
            accessToken: null,
            error:
              "Access token expired and refresh failed. Please re-paste your credentials in Settings.",
          };
        }
      } else {
        log.debug("loadCredentials — stored credentials are valid, no refresh needed");
      }
      log.debug("loadCredentials — returning access token from Obsidian Keychain");
      return { accessToken: tokens.access_token, error: null };
    }
    // Toggle is on but no credentials stored — return error rather than falling through.
    log.error("loadCredentials — custom credentials enabled but no token stored in keychain");
    return {
      accessToken: null,
      error: "Custom credentials are enabled but none are stored. Import credentials in Settings, or disable the custom credentials toggle.",
    };
  }

  let fileContents: string;
  try {
    fileContents = await fs.promises.readFile(filePath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    log.error("Credentials file read error:", error);
    if (code === "ENOENT") {
      return {
        accessToken: null,
        error: `Credentials file not found at ${filePath}. Please ensure the Granola app has created the credentials file.`,
      };
    }
    if (code === "EACCES") {
      return {
        accessToken: null,
        error: `Permission denied reading credentials file at ${filePath}. Please check file permissions.`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      accessToken: null,
      error: `Failed to read credentials file at ${filePath}: ${message}`,
    };
  }

  log.debug("Successfully read credentials file");

  let workosTokens: WorkosTokens;
  try {
    workosTokens = parseTokens(fileContents);
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : String(parseError);
    log.error("Failed to parse credentials file:", parseError);
    return {
      accessToken: null,
      error: message.startsWith("Missing") || message.startsWith("No accounts")
        ? message
        : `Invalid JSON format in credentials file at ${filePath}: ${message}. Please ensure the file contains valid JSON.`,
    };
  }

  if (!workosTokens.access_token) {
    const error = `Missing 'access_token' field in credentials file at ${filePath}. The token may have expired.`;
    log.error("Missing access token:", error);
    return { accessToken: null, error };
  }

  if (isTokenExpired(workosTokens)) {
    log.debug("Access token has expired or will expire soon, refreshing...");
    try {
      workosTokens = await refreshAccessToken(workosTokens);
      log.debug("Token refresh completed successfully");
    } catch (refreshError) {
      log.error("Failed to refresh token:", refreshError);
      return {
        accessToken: null,
        error:
          "Access token has expired and refresh failed. Please re-authenticate in the Granola app.",
      };
    }
  }

  return { accessToken: workosTokens.access_token, error: null };
}

/**
 * Verify the stored custom credentials by forcing a refresh against Granola's
 * auth endpoint. Does NOT consult the `useCustomCredentials` toggle — it
 * always exercises the keychain-stored token, so users can verify credentials
 * before enabling custom credentials mode.
 *
 * On success: refreshed token is written back to the keychain and the new
 * access token is returned. On failure: a descriptive error is returned.
 */
export async function verifyCustomCredentials(plugin: CredentialsHost): Promise<{
  accessToken: string | null;
  error: string | null;
}> {
  log.debug("verifyCustomCredentials — reading stored token from Obsidian Keychain");
  const secretJson = plugin.app.secretStorage.getSecret(CUSTOM_CREDENTIALS_SECRET_ID);
  if (!secretJson) {
    return { accessToken: null, error: "No credentials stored." };
  }

  let tokens: WorkosTokens;
  try {
    tokens = JSON.parse(secretJson) as WorkosTokens;
  } catch (parseError) {
    log.error("verifyCustomCredentials — failed to parse stored token:", parseError);
    return { accessToken: null, error: "Stored credentials are malformed." };
  }

  if (!tokens.refresh_token) {
    return { accessToken: null, error: "Stored credentials are missing a refresh token." };
  }

  try {
    log.debug("verifyCustomCredentials — forcing token refresh");
    const refreshed = await refreshAndStoreCustomCredentials(plugin, tokens);
    log.debug("verifyCustomCredentials — refresh succeeded, saved updated token");
    return { accessToken: refreshed.access_token, error: null };
  } catch (refreshError) {
    log.error("verifyCustomCredentials — refresh failed:", refreshError);
    const msg = refreshError instanceof Error ? refreshError.message : String(refreshError);
    return { accessToken: null, error: `Refresh failed: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Credential import helpers — used by the settings UI to turn a pasted file
// into a token pair and to surface the signed-in account's email.
// ---------------------------------------------------------------------------

/**
 * Narrows an unknown value to `{ access_token, refresh_token }` if it looks
 * like a tokens object. Returns null otherwise.
 */
function asTokenPair(
  v: unknown
): { access_token: string; refresh_token: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.access_token !== "string" || typeof o.refresh_token !== "string") {
    return null;
  }
  return { access_token: o.access_token, refresh_token: o.refresh_token };
}

/**
 * Parses a `stored-accounts.json` (or one of its sub-shapes) and returns the
 * first account's tokens, plus the user's email if one appears anywhere in
 * the input text. Three shapes are accepted, in order:
 *
 *   1. Full file: `{ accounts: <string|array> }`
 *   2. Just the `accounts` array
 *   3. Just the inner tokens object
 *
 * The email is regex-scanned from the raw text rather than parsed from
 * structure — it lives at the account level in some Granola versions but
 * not all, and JWT base64 doesn't contain `@` so false positives are rare.
 */
export function extractTokensFromImport(input: string): {
  access_token: string;
  refresh_token: string;
  account_email?: string;
} | null {
  const trimmed = input.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const emailMatch = trimmed.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const account_email = emailMatch ? emailMatch[0] : undefined;

  // A value that may be a JSON-encoded string or already-parsed object.
  const unwrap = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch { return null; }
  };

  const tokenPairFromFirstAccount = (accounts: unknown) => {
    if (!Array.isArray(accounts) || accounts.length === 0) return null;
    const first = accounts[0] as { tokens?: unknown };
    return asTokenPair(unwrap(first.tokens));
  };

  // Case 1: full stored-accounts.json
  if (parsed && typeof parsed === "object" && "accounts" in parsed) {
    const pair = tokenPairFromFirstAccount(unwrap(parsed.accounts));
    return pair ? { ...pair, account_email } : null;
  }

  // Case 2: parsed `accounts` array directly
  if (Array.isArray(parsed)) {
    const pair = tokenPairFromFirstAccount(parsed);
    return pair ? { ...pair, account_email } : null;
  }

  // Case 3: just the inner tokens object
  const pair = asTokenPair(parsed);
  return pair ? { ...pair, account_email } : null;
}

/**
 * Best-effort extraction of the signed-in user's email from a JWT access
 * token. JWTs are three dot-separated base64url segments; the middle is JSON
 * claims. We scan all string claims for an email-shaped value rather than
 * relying on a specific claim name — different identity providers put the
 * email in different places. Returns null if no email is found.
 */
export function extractEmailFromJwt(accessToken: string): string | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "===".slice((payload.length + 3) % 4);
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>;
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const value of Object.values(claims)) {
      if (typeof value === "string" && emailRe.test(value)) return value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads the stored credentials from Obsidian Keychain and returns the
 * signed-in account's email, or null if nothing is stored / no email is
 * available. Prefers the `account_email` captured at import time over a
 * JWT scan (the latter handles tokens saved before that field existed).
 */
export function getStoredAccountEmail(host: CredentialsHost): string | null {
  const secretJson = host.app.secretStorage.getSecret(CUSTOM_CREDENTIALS_SECRET_ID);
  if (!secretJson) return null;
  let tokens: WorkosTokens;
  try {
    tokens = JSON.parse(secretJson) as WorkosTokens;
  } catch {
    return null;
  }
  if (tokens.account_email) return tokens.account_email;
  if (tokens.access_token) return extractEmailFromJwt(tokens.access_token);
  return null;
}
