import { App } from "obsidian";

export function startCredentialsServer() {
  // No-op for mobile compatibility
}

export function stopCredentialsServer() {
  // No-op for mobile compatibility  
}

export async function loadCredentials(app: App, tokenPath: string): Promise<{
  accessToken: string | null;
  error: string | null;
}> {
  let accessToken: string | null = null;
  let tokenLoadError: string | null = null;
  
  try {
    // Use Vault API to read credentials file from the vault
    const fileContent = await app.vault.adapter.read(tokenPath);
    
    try {
      const tokenData = JSON.parse(fileContent);
      const workosTokens = JSON.parse(tokenData.workos_tokens);
      accessToken = workosTokens.access_token;
      if (!accessToken) {
        tokenLoadError =
          "No access token found in credentials file. The token may have expired.";
      }
    } catch (parseError) {
      console.error("Failed to parse credentials file:", parseError);
      tokenLoadError =
        "Invalid JSON format in credentials file. Please ensure the file contains valid JSON.";
    }
  } catch (error) {
    tokenLoadError =
      `Failed to load credentials from '${tokenPath}'. Please ensure the file exists in your vault and contains valid Granola credentials.`;
    console.error("Credentials loading error:", error);
  }
  
  return { accessToken, error: tokenLoadError };
}
