import type { CredentialsResult } from "./credentials";

export interface CredentialsErrorHandlers {
  onKeychainDenied: () => void;
  onDpapiFailed: (message: string) => void;
  onOtherError: (message: string) => void;
}

/**
 * Routes a credentials-load result to the appropriate UI handler. Kept free of
 * any Obsidian imports so the dispatch logic is testable without standing up a
 * Modal/Notice.
 */
export function presentCredentialsError(
  result: CredentialsResult,
  handlers: CredentialsErrorHandlers
): void {
  if (!result.error) return;

  if (result.errorKind === "keychain") {
    handlers.onKeychainDenied();
    return;
  }

  if (result.errorKind === "dpapi") {
    handlers.onDpapiFailed(result.error);
    return;
  }

  handlers.onOtherError(result.error);
}
