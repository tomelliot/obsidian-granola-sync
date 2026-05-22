import { requestUrl, Platform } from "obsidian";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "../utils/logger";

interface WorkosTokens {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
  obtained_at: number;
  session_id: string;
  external_id: string;
}

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

function getGranolaDir(): string {
  if (Platform.isWin) {
    return path.join(os.homedir(), "AppData", "Roaming", "Granola");
  }
  if (Platform.isLinux) {
    return path.join(os.homedir(), ".config", "Granola");
  }
  return path.join(os.homedir(), "Library", "Application Support", "Granola");
}

function getTokenFilePath(): string {
  return path.join(getGranolaDir(), "stored-accounts.json");
}

function getEncryptedTokenFilePath(): string {
  return path.join(getGranolaDir(), "stored-accounts.json.enc");
}

const filePath = getTokenFilePath();
const encryptedFilePath = getEncryptedTokenFilePath();

/**
 * Returns true if the access token has expired or expires within 5 minutes.
 */
function isTokenExpired(workosTokens: WorkosTokens): boolean {
  const expirationTime = workosTokens.obtained_at + workosTokens.expires_in * 1000;
  const bufferMs = 5 * 60 * 1000;
  return Date.now() >= expirationTime - bufferMs;
}

/**
 * Returns true if the access token's hard expiry has already passed.
 * Distinguished from {@link isTokenExpired} which includes a 5-minute refresh buffer.
 * Used by the refresh-failure fallback: an "expiring soon" token is still usable.
 */
function isTokenHardExpired(workosTokens: WorkosTokens): boolean {
  const expirationTime = workosTokens.obtained_at + workosTokens.expires_in * 1000;
  return Date.now() >= expirationTime;
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
    expires_in: refreshResponse.expires_in,
    token_type: refreshResponse.token_type,
    obtained_at: Date.now(),
    refresh_token: refreshResponse.refresh_token ?? workosTokens.refresh_token,
  };
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

/**
 * Checks whether the desktop Granola app has migrated to encrypted credentials
 * (`stored-accounts.json.enc`) while the plaintext file is stale.
 *
 * Returns true when the encrypted file exists and is newer than the plaintext
 * file (or the plaintext file is missing). This is the signal that the user
 * has updated to a Granola desktop build that no longer writes plaintext
 * credentials we can read.
 */
export async function encryptedCredentialsIsNewerThanPlaintext(): Promise<boolean> {
  try {
    const encStat = await fs.promises.stat(encryptedFilePath);
    try {
      const plainStat = await fs.promises.stat(filePath);
      return encStat.mtimeMs > plainStat.mtimeMs;
    } catch (plainErr) {
      const code = (plainErr as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Encrypted exists but plaintext does not — treat as newer.
        return true;
      }
      return false;
    }
  } catch {
    // Encrypted file does not exist, or stat failed for another reason.
    return false;
  }
}

export async function loadCredentials(): Promise<{
  accessToken: string | null;
  error: string | null;
}> {
  // Check if the desktop app has moved to encrypted storage. We log this even
  // on the happy path so users can correlate sync issues with the desktop
  // app update. The plain-file read below remains authoritative — if it
  // succeeds and the token still works, we use it.
  const encNewer = await encryptedCredentialsIsNewerThanPlaintext();
  if (encNewer) {
    log.warn(
      "Granola desktop credentials appear to have migrated to an encrypted file (stored-accounts.json.enc) " +
        "that is newer than the plaintext file this plugin reads. Sync may fail. " +
        "Consider switching to API key authentication (Granola Business/Enterprise) " +
        "or see https://github.com/tomelliot/obsidian-granola-sync/issues/126 for status."
    );
  }

  let fileContents: string;
  try {
    fileContents = await fs.promises.readFile(filePath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    log.error("Credentials file read error:", error);
    if (code === "ENOENT") {
      if (encNewer) {
        return {
          accessToken: null,
          error:
            `Credentials file not found at ${filePath}, but an encrypted credentials file ` +
            `(stored-accounts.json.enc) exists. The Granola desktop app has switched to encrypted ` +
            `credentials this plugin cannot read. See ` +
            `https://github.com/tomelliot/obsidian-granola-sync/issues/126 for status; ` +
            `Business/Enterprise users can configure an API key in plugin settings.`,
        };
      }
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

      // Refresh-failure fallback: if the existing access token has not actually
      // expired yet (only inside the 5-minute pre-expiry buffer), use it.
      // This is the common case when refresh transiently fails (network blip,
      // server hiccup) — the existing token is still valid for short calls and
      // a future sync will refresh again.
      if (!isTokenHardExpired(workosTokens)) {
        log.warn(
          "Falling back to existing access token after refresh failure; token is still within hard-expiry window."
        );
        return { accessToken: workosTokens.access_token, error: null };
      }

      const encNewerNow = encNewer || (await encryptedCredentialsIsNewerThanPlaintext());
      const hint = encNewerNow
        ? " The Granola desktop app appears to have switched to encrypted credential storage " +
          "(see https://github.com/tomelliot/obsidian-granola-sync/issues/126). Business/Enterprise users " +
          "can switch to API key authentication in plugin settings."
        : " Please re-authenticate in the Granola app.";
      return {
        accessToken: null,
        error: "Access token has expired and refresh failed." + hint,
      };
    }
  }

  return { accessToken: workosTokens.access_token, error: null };
}
