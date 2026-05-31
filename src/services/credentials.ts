import { requestUrl, Platform } from "obsidian";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "../utils/logger";
import {
  loadEncryptedCredentials,
  LoadEncryptedCredentialsOpts,
  KeychainAccessError,
  DpapiAccessError,
  CredentialDecryptionError,
} from "./granolaCredentialsCrypto";

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

function getGranolaDirectory(): string {
  if (Platform.isWin) {
    return path.join(os.homedir(), "AppData", "Roaming", "Granola");
  }
  if (Platform.isLinux) {
    return path.join(os.homedir(), ".config", "Granola");
  }
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Granola"
  );
}

export function getCredentialPaths(): LoadEncryptedCredentialsOpts {
  const dir = getGranolaDirectory();
  const encPath = path.join(dir, "stored-accounts.json.enc");
  const dekPath = path.join(dir, "storage.dek");
  if (Platform.isWin) {
    return {
      mode: "dpapi",
      encPath,
      dekPath,
      localStatePath: path.join(dir, "Local State"),
    };
  }
  return {
    mode: "keychain",
    encPath,
    dekPath,
  };
}

function getPlaintextCredentialPath(): string {
  return path.join(getGranolaDirectory(), "stored-accounts.json");
}

const credentialPaths = getCredentialPaths();
const plaintextCredentialPath = getPlaintextCredentialPath();

/**
 * Checks if the access token has expired.
 * Returns true if the token has expired or will expire in the next 5 minutes.
 */
function isTokenExpired(workosTokens: WorkosTokens): boolean {
  const currentTime = Date.now();
  const tokenObtainedAt = workosTokens.obtained_at;
  const expiresIn = workosTokens.expires_in * 1000; // Convert seconds to milliseconds
  const expirationTime = tokenObtainedAt + expiresIn;

  // Add 5-minute buffer to refresh before actual expiration
  const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds

  return currentTime >= expirationTime - bufferTime;
}

/**
 * Refreshes the access token using the refresh token.
 */
async function refreshAccessToken(
  workosTokens: WorkosTokens
): Promise<WorkosTokens> {
  log.debug("Attempting to refresh access token");

  try {
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

    // Update the tokens with new values
    const updatedTokens: WorkosTokens = {
      ...workosTokens,
      access_token: refreshResponse.access_token,
      expires_in: refreshResponse.expires_in,
      token_type: refreshResponse.token_type,
      obtained_at: Date.now(),
      // Keep the same refresh_token if not provided in response
      refresh_token:
        refreshResponse.refresh_token ?? workosTokens.refresh_token,
    };

    log.debug("Successfully refreshed access token");
    return updatedTokens;
  } catch (error) {
    log.error("Failed to refresh access token:", error);
    throw new Error(
      `Failed to refresh access token: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Parses the decrypted stored-accounts.json payload. `accounts` is a
 * JSON-encoded string holding an array; each account's `tokens` field is itself
 * a JSON-encoded string of the token object.
 */
function parseTokens(fileContents: string): WorkosTokens {
  const data = JSON.parse(fileContents) as StoredAccountsData;

  if (!data.accounts) {
    throw new Error(
      "Missing 'accounts' field in decrypted credentials. Please ensure the Granola app is up to date."
    );
  }

  const accounts: StoredAccount[] =
    typeof data.accounts === "string"
      ? (JSON.parse(data.accounts) as StoredAccount[])
      : data.accounts;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error(
      "No accounts found in decrypted credentials. Please sign in via the Granola app."
    );
  }

  const account = accounts[0];
  if (!account.tokens) {
    throw new Error(
      "Missing 'tokens' field on first account in decrypted credentials."
    );
  }

  return typeof account.tokens === "string"
    ? (JSON.parse(account.tokens) as WorkosTokens)
    : account.tokens;
}

export type CredentialsErrorKind =
  | "keychain"
  | "dpapi"
  | "decryption"
  | "file_not_found"
  | "permission_denied"
  | "invalid_credentials"
  | "refresh_failed"
  | "unknown";

export interface CredentialsResult {
  accessToken: string | null;
  error: string | null;
  errorKind?: CredentialsErrorKind;
}

interface LoadErrorDescription {
  message: string;
  kind: CredentialsErrorKind;
}

function describeLoadError(error: unknown): LoadErrorDescription {
  if (error instanceof KeychainAccessError) {
    return {
      message: `Could not read Granola password from system keychain. Make sure Granola is installed and you have logged in. (${error.message})`,
      kind: "keychain",
    };
  }
  if (error instanceof DpapiAccessError) {
    return {
      message: `Could not unwrap Granola's encryption key via Windows DPAPI. Make sure Granola is installed under the same Windows user account and you have signed in. (${error.message})`,
      kind: "dpapi",
    };
  }
  if (error instanceof CredentialDecryptionError) {
    return {
      message: `Failed to decrypt Granola credentials. The file may be corrupt or from an unsupported Granola version. (${error.message})`,
      kind: "decryption",
    };
  }
  const errorCode = (error as NodeJS.ErrnoException)?.code;
  const allPaths =
    credentialPaths.mode === "keychain"
      ? [credentialPaths.encPath, credentialPaths.dekPath, plaintextCredentialPath]
      : [
          credentialPaths.encPath,
          credentialPaths.dekPath,
          credentialPaths.localStatePath,
          plaintextCredentialPath,
        ];
  const pathList = allPaths.join(", ");
  if (errorCode === "ENOENT") {
    return {
      message: `Granola credentials file not found. Checked: ${pathList}. Please ensure the Granola app has created the credentials files.`,
      kind: "file_not_found",
    };
  }
  if (errorCode === "EACCES") {
    return {
      message: `Permission denied reading Granola credentials. Checked: ${pathList}. Please check file permissions.`,
      kind: "permission_denied",
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    message: `Failed to load Granola credentials: ${message}`,
    kind: "unknown",
  };
}

async function loadCredentialFileContents(): Promise<string> {
  try {
    return await loadEncryptedCredentials(credentialPaths);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }

    log.debug(
      "Encrypted Granola credentials not found, falling back to stored-accounts.json"
    );
    return fs.promises.readFile(plaintextCredentialPath, "utf-8");
  }
}

export async function loadCredentials(): Promise<CredentialsResult> {
  let accessToken: string | null = null;

  let fileContents: string;
  try {
    fileContents = await loadCredentialFileContents();
    log.debug("Successfully loaded credentials");
  } catch (error) {
    const { message, kind } = describeLoadError(error);
    log.error("Credentials load error:", error);
    return { accessToken, error: message, errorKind: kind };
  }

  try {
    let workosTokens = parseTokens(fileContents);

    if (!workosTokens.access_token) {
      const error = `Missing 'access_token' field in decrypted credentials. The token may have expired.`;
      log.error("Missing access token:", error);
      return { accessToken, error, errorKind: "invalid_credentials" };
    }

    if (isTokenExpired(workosTokens)) {
      log.debug(
        "Access token has expired or will expire soon, refreshing..."
      );
      try {
        workosTokens = await refreshAccessToken(workosTokens);
        log.debug("Token refresh completed successfully");
      } catch (refreshError) {
        log.error("Failed to refresh token:", refreshError);
        return {
          accessToken,
          error:
            "Access token has expired and refresh failed. Please re-authenticate in the Granola app.",
          errorKind: "refresh_failed",
        };
      }
    }

    accessToken = workosTokens.access_token;
    return { accessToken, error: null };
  } catch (parseError) {
    const parseErrorMessage =
      parseError instanceof Error ? parseError.message : String(parseError);
    const error =
      parseError instanceof SyntaxError
        ? `Invalid JSON format in decrypted credentials: ${parseErrorMessage}. The credentials file may be corrupt.`
        : parseErrorMessage;
    log.error("Failed to parse decrypted credentials:", parseError);
    return { accessToken, error, errorKind: "invalid_credentials" };
  }
}
