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

interface TokenData {
  workos_tokens: string;
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
      "supabase.json"
    );
  } else if (Platform.isLinux) {
    return path.join(os.homedir(), ".config", "Granola", "supabase.json");
  } else {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Granola",
      "supabase.json"
    );
  }
}

const filePath = getTokenFilePath();

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

const TOKEN_REFRESH_API_URL = "https://api.granola.ai/v1/refresh-access-token";

/**
 * Refreshes the access token using the refresh token.
 */
async function refreshAccessToken(
  workosTokens: WorkosTokens
): Promise<WorkosTokens> {
  log.info(`Attempting to refresh access token via ${TOKEN_REFRESH_API_URL}`);

  let response;
  try {
    response = await requestUrl({
      url: TOKEN_REFRESH_API_URL,
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
  } catch (error) {
    // Obsidian's requestUrl throws on network errors and non-2xx status codes
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status;
    log.error(`Failed to refresh access token from ${TOKEN_REFRESH_API_URL}:`);
    log.error(`  Status: ${status ?? "unknown"}`);
    log.error(`  Error: ${errorMessage}`);
    // Note: We intentionally do not log the token or refresh_token for security
    throw new Error(
      `Failed to refresh access token: ${errorMessage}`
    );
  }

  log.info(`Token refresh API response status: ${response.status}`);

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

  log.info("Successfully refreshed access token");
  return updatedTokens;
}

/**
 * Forces a token refresh regardless of expiration status.
 * This is useful for debugging/development purposes.
 * @returns Object containing success status and optional error message
 */
export async function forceRefreshToken(): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const fileContents = await fs.promises.readFile(filePath, "utf-8");
    const tokenData: TokenData = JSON.parse(fileContents);

    if (!tokenData.workos_tokens || typeof tokenData.workos_tokens !== "string") {
      return { success: false, error: "Missing or invalid 'workos_tokens' field in credentials file." };
    }

    const workosTokens: WorkosTokens = JSON.parse(tokenData.workos_tokens);

    if (!workosTokens.refresh_token) {
      return { success: false, error: "No refresh token available." };
    }

    log.info("Forcing token refresh...");
    await refreshAccessToken(workosTokens);
    log.info("Token refresh forced successfully.");

    return { success: true, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("Failed to force token refresh:", error);
    return { success: false, error: errorMessage };
  }
}

export async function loadCredentials(): Promise<{
  accessToken: string | null;
  error: string | null;
}> {
  let accessToken: string | null = null;
  let tokenLoadError: string | null = null;

  try {
    // Read credentials file directly from filesystem
    const fileContents = await fs.promises.readFile(filePath, "utf-8");
    log.debug("Successfully read credentials file");

    try {
      const tokenData: TokenData = JSON.parse(fileContents);
      
      // Validate that workos_tokens field exists
      if (!tokenData.workos_tokens || typeof tokenData.workos_tokens !== "string") {
        tokenLoadError = `Missing or invalid 'workos_tokens' field in credentials file at ${filePath}. Please ensure the file contains a valid 'workos_tokens' string.`;
        log.error("Invalid credentials file structure:", tokenLoadError);
        return { accessToken, error: tokenLoadError };
      }

      let workosTokens: WorkosTokens = JSON.parse(tokenData.workos_tokens);

      // Validate required fields in workosTokens
      if (!workosTokens.access_token) {
        tokenLoadError = `Missing 'access_token' field in credentials file at ${filePath}. The token may have expired.`;
        log.error("Missing access token:", tokenLoadError);
        return { accessToken, error: tokenLoadError };
      }

      // Check if token has expired
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
        log.debug("No access token found in credentials file");
        tokenLoadError =
          "No access token found in credentials file. The token may have expired.";
      }
    } catch (parseError) {
      const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      tokenLoadError = `Invalid JSON format in credentials file at ${filePath}: ${parseErrorMessage}. Please ensure the file contains valid JSON.`;
      log.error("Failed to parse credentials file:", parseError);
      return { accessToken, error: tokenLoadError };
    }
  } catch (error) {
    // Handle filesystem errors
    if (error instanceof Error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        tokenLoadError = `Credentials file not found at ${filePath}. Please ensure the Granola app has created the credentials file.`;
      } else if (errorCode === "EACCES") {
        tokenLoadError = `Permission denied reading credentials file at ${filePath}. Please check file permissions.`;
      } else {
        tokenLoadError = `Failed to read credentials file at ${filePath}: ${error.message}`;
      }
    } else {
      tokenLoadError = `Failed to read credentials file at ${filePath}: ${String(error)}`;
    }
    log.error("Credentials file read error:", error);
  }

  return { accessToken, error: tokenLoadError };
}
