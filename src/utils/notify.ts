import { Notice } from "obsidian";

/**
 * Centralised wrapper around Obsidian's `Notice` for routine sync-status
 * messages (sync started/complete, no documents found).
 *
 * These notices are shown only when the user has sync notifications enabled.
 * Error notices should NOT use this helper - they call `new Notice(...)`
 * directly so they always surface regardless of the user's setting.
 *
 * @param show - Whether sync notifications are enabled (`settings.showSyncNotifications`).
 * @param message - The notice text to display.
 * @param timeout - Optional display duration in milliseconds.
 * @returns The created `Notice`, or `null` when notifications are disabled.
 */
export function notifySync(
  show: boolean,
  message: string,
  timeout?: number
): Notice | null {
  return show ? new Notice(message, timeout) : null;
}
