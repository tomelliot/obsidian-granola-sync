import { requestUrl, Platform } from "obsidian";
import path from "path";
import os from "os";
import { log } from "../utils/logger";
import {
  loadEncryptedCredentials,
  KeychainAccessError,
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

interface TokenData {
  workos_tokens: string;
}

interface RefreshTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
}

interface CredentialPaths {
  encPath: string;
  dekPath: string;
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

function getCredentialPaths(): CredentialPaths {
  const dir = getGranolaDirectory();
  return {
    encPath: path.join(dir, "supabase.json.enc"),
    dekPath: path.join(dir, "storage.dek"),
  };
}

const { encPath, dekPath } = getCredentialPaths();

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

function describeLoadError(error: unknown): string {
  if (error instanceof KeychainAccessError) {
    return `Could not read Granola password from system keychain. Make sure Granola is installed and you have logged in. (${error.message})`;
  }
  if (error instanceof CredentialDecryptionError) {
    return `Failed to decrypt Granola credentials. The file may be corrupt or from an unsupported Granola version. (${error.message})`;
  }
  const errorCode = (error as NodeJS.ErrnoException)?.code;
  if (errorCode === "ENOENT") {
    return `Granola credentials file not found at ${encPath} or ${dekPath}. Please ensure the Granola app has created the credentials files.`;
  }
  if (errorCode === "EACCES") {
    return `Permission denied reading Granola credentials at ${encPath} or ${dekPath}. Please check file permissions.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Failed to load Granola credentials: ${message}`;
}

export async function loadCredentials(): Promise<{
  accessToken: string | null;
  error: string | null;
}> {
  let accessToken: string | null = null;
  let tokenLoadError: string | null = null;

  let fileContents: string;
  try {
    fileContents = await loadEncryptedCredentials(encPath, dekPath);
    log.debug("Successfully decrypted credentials");
  } catch (error) {
    tokenLoadError = describeLoadError(error);
    log.error("Credentials load error:", error);
    return { accessToken, error: tokenLoadError };
  }

  try {
    const tokenData = JSON.parse(fileContents) as TokenData;

    if (
      !tokenData.workos_tokens ||
      typeof tokenData.workos_tokens !== "string"
    ) {
      tokenLoadError = `Missing or invalid 'workos_tokens' field in decrypted credentials. Please ensure the Granola app is up to date.`;
      log.error("Invalid credentials structure:", tokenLoadError);
      return { accessToken, error: tokenLoadError };
    }

    let workosTokens = JSON.parse(tokenData.workos_tokens) as WorkosTokens;

    if (!workosTokens.access_token) {
      tokenLoadError = `Missing 'access_token' field in decrypted credentials. The token may have expired.`;
      log.error("Missing access token:", tokenLoadError);
      return { accessToken, error: tokenLoadError };
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
        tokenLoadError =
          "Access token has expired and refresh failed. Please re-authenticate in the Granola app.";
        return { accessToken, error: tokenLoadError };
      }
    }

    accessToken = workosTokens.access_token;
    if (!accessToken) {
      log.debug("No access token found in decrypted credentials");
      tokenLoadError =
        "No access token found in decrypted credentials. The token may have expired.";
    }
  } catch (parseError) {
    const parseErrorMessage =
      parseError instanceof Error ? parseError.message : String(parseError);
    tokenLoadError = `Invalid JSON format in decrypted credentials: ${parseErrorMessage}. The credentials file may be corrupt.`;
    log.error("Failed to parse decrypted credentials:", parseError);
    return { accessToken, error: tokenLoadError };
  }

  return { accessToken, error: tokenLoadError };
}
