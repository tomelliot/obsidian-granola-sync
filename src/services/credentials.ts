import { requestUrl, Platform } from "obsidian";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "../utils/logger";

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
      const tokenData =
        typeof response.json === "string"
          ? JSON.parse(response.json)
          : response.json;
      const workosTokens = JSON.parse(tokenData.workos_tokens);
      accessToken = workosTokens.access_token;
      if (!accessToken) {
        log.debug("Credentials server: No access token found in response");
        tokenLoadError =
          "No access token found in credentials file. The token may have expired.";
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
