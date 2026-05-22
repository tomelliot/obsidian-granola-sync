import type { GranolaSyncSettings } from "../settings";
import { loadCredentials } from "./credentials";
import { log } from "../utils/logger";

/**
 * Resolved authentication for a sync run.
 *
 * `token` is the bearer token for the appropriate Granola endpoint:
 * - `desktop`: WorkOS access token for `api.granola.ai`
 * - `api_key`: `grn_*` key for `public-api.granola.ai`
 */
export type AuthResult =
  | { method: "desktop"; token: string }
  | { method: "api_key"; token: string };

/**
 * Resolves authentication for a sync run based on plugin settings.
 *
 * - When `authMethod === "api_key"`, validates the key shape (non-empty,
 *   `grn_` prefix). No network call.
 * - When `authMethod === "desktop"`, delegates to {@link loadCredentials}
 *   which reads the Granola app credentials file and (if needed) refreshes
 *   the access token.
 *
 * Returns `{ auth: null, error }` on failure so callers can surface a Notice
 * and bail out — matches the existing {@link loadCredentials} return shape.
 */
export async function resolveAuth(
  settings: GranolaSyncSettings
): Promise<{ auth: AuthResult | null; error: string | null }> {
  if (settings.authMethod === "api_key") {
    const key = settings.apiKey?.trim() ?? "";
    if (!key) {
      return {
        auth: null,
        error:
          "Granola API key is required when API key authentication is selected. " +
          "Add your key in Settings → Authentication, or switch back to Desktop credentials.",
      };
    }
    if (!key.startsWith("grn_")) {
      return {
        auth: null,
        error:
          "Granola API key has an unexpected format (expected to start with 'grn_'). " +
          "Double-check the key in Settings → Authentication.",
      };
    }
    log.debug("resolveAuth — using API key authentication");
    return { auth: { method: "api_key", token: key }, error: null };
  }

  log.debug("resolveAuth — using desktop credentials");
  const { accessToken, error } = await loadCredentials();
  if (!accessToken) {
    return { auth: null, error };
  }
  return { auth: { method: "desktop", token: accessToken }, error: null };
}
