import { requestUrl, Platform } from "obsidian";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "../utils/logger";

interface WorkOsTokens {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  obtained_at?: string | number;
  session_id?: string;
  external_id?: string;
  [key: string]: unknown;
}

type TokenFileContent = Record<string, unknown> & {
  workos_tokens?: unknown;
};

const TOKEN_REFRESH_ENDPOINT =
  "https://api.granola.ai/v1/refresh-access-token";
const TOKEN_EXPIRY_GRACE_PERIOD_MS = 60 * 1000; // 1 minute

let server: http.Server | null = null;

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

function parseWorkOsTokens(tokenData: TokenFileContent): WorkOsTokens | null {
  const rawTokens = tokenData.workos_tokens;
  if (!rawTokens) {
    return null;
  }

  try {
    if (typeof rawTokens === "string") {
      return JSON.parse(rawTokens) as WorkOsTokens;
    }
    if (typeof rawTokens === "object") {
      return rawTokens as WorkOsTokens;
    }
  } catch (error) {
    log.error("Failed to parse workos_tokens:", error);
  }
  return null;
}

function getExpiryTimestamp(tokens: WorkOsTokens): number | null {
  if (!tokens.expires_in || !tokens.obtained_at) {
    return null;
  }

  let obtainedAtMs: number | null = null;
  if (typeof tokens.obtained_at === "number") {
    obtainedAtMs =
      tokens.obtained_at > 1e12
        ? tokens.obtained_at
        : Math.trunc(tokens.obtained_at * 1000);
  } else if (typeof tokens.obtained_at === "string") {
    const numericValue = Number(tokens.obtained_at);
    if (!Number.isNaN(numericValue)) {
      obtainedAtMs =
        numericValue > 1e12
          ? numericValue
          : Math.trunc(numericValue * 1000);
    } else {
      const parsedDate = Date.parse(tokens.obtained_at);
      if (!Number.isNaN(parsedDate)) {
        obtainedAtMs = parsedDate;
      }
    }
  }

  if (!obtainedAtMs) {
    return null;
  }

  return obtainedAtMs + tokens.expires_in * 1000;
}

function isTokenExpired(tokens: WorkOsTokens): boolean {
  const expiryTimestamp = getExpiryTimestamp(tokens);
  if (!expiryTimestamp) {
    return false;
  }
  return Date.now() + TOKEN_EXPIRY_GRACE_PERIOD_MS >= expiryTimestamp;
}

async function refreshWorkOsTokens(
  tokens: WorkOsTokens
): Promise<WorkOsTokens> {
  if (!tokens.refresh_token) {
    throw new Error("No refresh token available.");
  }

  const response = await requestUrl({
    url: TOKEN_REFRESH_ENDPOINT,
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "GranolaObsidianPlugin",
    },
    body: JSON.stringify({
      refresh_token: tokens.refresh_token,
      provider: "workos",
    }),
    throw: true,
  });

  const responseJson =
    typeof response.json === "string" ? JSON.parse(response.json) : response.json;

  let refreshedTokens: WorkOsTokens | null = null;
  if (responseJson) {
    if (responseJson.workos_tokens) {
      try {
        refreshedTokens =
          typeof responseJson.workos_tokens === "string"
            ? (JSON.parse(responseJson.workos_tokens) as WorkOsTokens)
            : (responseJson.workos_tokens as WorkOsTokens);
      } catch (error) {
        log.error("Failed to parse workos_tokens from refresh response:", error);
      }
    } else {
      refreshedTokens = responseJson as WorkOsTokens;
    }
  }

  if (!refreshedTokens || !refreshedTokens.access_token) {
    throw new Error(
      "Granola refresh response did not include an access token."
    );
  }

  return {
    ...tokens,
    ...refreshedTokens,
    obtained_at: refreshedTokens.obtained_at ?? new Date().toISOString(),
  };
}

async function persistRefreshedTokens(
  tokenData: TokenFileContent,
  updatedTokens: WorkOsTokens
): Promise<void> {
  const updatedData: TokenFileContent = {
    ...tokenData,
  };

  const originalValue = tokenData.workos_tokens;
  updatedData.workos_tokens =
    typeof originalValue === "string" || !originalValue
      ? JSON.stringify(updatedTokens)
      : updatedTokens;

  await fs.promises.writeFile(
    filePath,
    JSON.stringify(updatedData, null, 2),
    "utf8"
  );
}

export async function startCredentialsServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Graceful shutdown on process exit
    process.on("SIGINT", stopCredentialsServer);
    process.on("SIGTERM", stopCredentialsServer);
    process.on("exit", stopCredentialsServer);

    server = http.createServer((req, res) => {
      if (req.url === "/supabase.json" || req.url === "/") {
        fs.readFile(filePath, (err, data) => {
          if (err) {
            const errorMessage = `Failed to read credentials file at ${filePath}: ${err.message}`;
            log.error("startCredentialsServer", errorMessage);
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end(errorMessage);
          } else {
            log.debug(
              "Credentials server: Successfully served credentials file"
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(data);
          }
        });
      } else {
        const message = `Unsupported credentials server route: ${
          req.url ?? "unknown"
        }`;
        log.error("startCredentialsServer", message);
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(message);
      }
    });

    server.on("error", (err) => {
      log.error("Server startup error:", err);
      reject(err);
    });

    server.listen(2590, "127.0.0.1", () => {
      log.debug("Credentials server: Started");
      resolve();
    });
  });
}

export function stopCredentialsServer() {
  if (server) {
    server.close(() => {
      server = null;
      log.debug("Credentials server: Stopped");
    });
  }
}

export async function loadCredentials(): Promise<{
  accessToken: string | null;
  error: string | null;
}> {
  let accessToken: string | null = null;
  let tokenLoadError: string | null = null;

  try {
    // Wait for the server to be ready before making the request
    await startCredentialsServer();

    // Add a small delay to ensure the server is fully ready

    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (serverError) {
    const errorMessage =
      serverError instanceof Error ? serverError.message : String(serverError);
    tokenLoadError = `Failed to start credentials server: ${errorMessage}`;
    log.error("Server startup error:", serverError);
    return { accessToken, error: tokenLoadError };
  }

  try {
    const response = await requestUrl({
      url: "http://127.0.0.1:2590/",
      method: "GET",
      throw: true,
    });
    log.debug("Credentials server: Received successful response");
    try {
      const tokenData: TokenFileContent =
        typeof response.json === "string"
          ? JSON.parse(response.json)
          : (response.json as TokenFileContent);

      const workosTokens = parseWorkOsTokens(tokenData);
      if (!workosTokens || !workosTokens.access_token) {
        log.debug(
          "Credentials server: No access token found in workos_tokens response"
        );
        tokenLoadError =
          "No access token found in credentials file. The token may have expired.";
      } else {
        let activeTokens = workosTokens;

        if (isTokenExpired(workosTokens)) {
          try {
            log.debug("Access token expired. Refreshing via Granola API...");
            activeTokens = await refreshWorkOsTokens(workosTokens);
            await persistRefreshedTokens(tokenData, activeTokens);
            log.debug("Granola access token successfully refreshed.");
          } catch (refreshError) {
            log.error("Failed to refresh access token:", refreshError);
            tokenLoadError =
              "Failed to refresh expired access token. Please re-authenticate in Granola.";
            return { accessToken: null, error: tokenLoadError };
          }
        }

        accessToken = activeTokens.access_token;
      }
    } catch (parseError) {
      log.error("Failed to parse response:", response);
      log.error("Response JSON:", response.json);
      log.error("Token response parse error:", parseError);
      tokenLoadError =
        "Invalid JSON format in credentials response. Please ensure the server returns valid JSON.";
    }
  } catch (error) {
    tokenLoadError =
      "Failed to load credentials from http://127.0.0.1:2590/. Please check if the credentials server is running.";
    log.error("Credentials loading error:", error);
  } finally {
    stopCredentialsServer();
  }
  return { accessToken, error: tokenLoadError };
}
