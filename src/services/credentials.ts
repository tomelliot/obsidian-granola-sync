import { requestUrl } from "obsidian";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";

let server: http.Server | null = null;

const filePath = path.join(
  os.homedir(),
  "Library/Application Support/Granola/supabase.json"
);

export function startCredentialsServer() {
  server = http
    .createServer((req, res) => {
      if (req.url === "/supabase.json" || req.url === "/") {
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.write(err.message);
            res.end("File not found");
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(data);
          }
        });
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    })
    .listen(2590, "127.0.0.1");

  // Graceful shutdown on process exit
  process.on("SIGINT", stopCredentialsServer);
  process.on("SIGTERM", stopCredentialsServer);
  process.on("exit", stopCredentialsServer);
}

export function stopCredentialsServer() {
  if (server) {
    server.close(() => (server = null));
  }
}

export async function loadCredentials(): Promise<{
  accessToken: string | null;
  error: string | null;
}> {
  let accessToken: string | null = null;
  let tokenLoadError: string | null = null;
  startCredentialsServer();
  try {
    const response = await requestUrl({
      url: "http://127.0.0.1:2590/",
      method: "GET",
      throw: true,
    });
    try {
      const tokenData =
        typeof response.json === "string"
          ? JSON.parse(response.json)
          : response.json;
      const cognitoTokens = JSON.parse(tokenData.cognito_tokens);
      accessToken = cognitoTokens.access_token;
      if (!accessToken) {
        tokenLoadError =
          "No access token found in credentials file. The token may have expired.";
      }
    } catch (parseError) {
      console.error(`Failed to parse response: `, response);
      console.error(`Failed to parse response: `, response.json);
      tokenLoadError =
        "Invalid JSON format in credentials response. Please ensure the server returns valid JSON.";
      console.error("Token response parse error:", parseError);
    }
  } catch (error) {
    tokenLoadError =
      "Failed to load credentials from http://127.0.0.1:2590/. Please check if the credentials server is running.";
    console.error("Credentials loading error:", error);
  } finally {
    stopCredentialsServer();
  }
  return { accessToken, error: tokenLoadError };
}
