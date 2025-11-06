import { Plugin } from "obsidian";

interface StatusBarPlugin extends Plugin {
  statusBarItemEl: HTMLElement | null;
  statusBarTimeoutId: number | null;
}

export function showStatusBar(plugin: StatusBarPlugin, message: string): void {
  // Create status bar item if it doesn't exist
  if (!plugin.statusBarItemEl) {
    plugin.statusBarItemEl = plugin.addStatusBarItem();
  }

  plugin.statusBarItemEl.setText(message);
  plugin.statusBarItemEl.style.display = "";
}

export function hideStatusBar(plugin: StatusBarPlugin): void {
  // Clear any pending timeout
  if (plugin.statusBarTimeoutId !== null) {
    window.clearTimeout(plugin.statusBarTimeoutId);
    plugin.statusBarTimeoutId = null;
  }

  if (plugin.statusBarItemEl) {
    // Remove the status bar item from the DOM
    plugin.statusBarItemEl.remove();
    plugin.statusBarItemEl = null;
  }
}

export function showStatusBarTemporary(
  plugin: StatusBarPlugin,
  message: string,
  durationMs: number = 5000
): number | null {
  // Clear any existing timeout
  if (plugin.statusBarTimeoutId !== null) {
    window.clearTimeout(plugin.statusBarTimeoutId);
    plugin.statusBarTimeoutId = null;
  }

  showStatusBar(plugin, message);

  // Hide after duration and return the new timeout ID
  plugin.statusBarTimeoutId = window.setTimeout(() => {
    hideStatusBar(plugin);
    plugin.statusBarTimeoutId = null;
  }, durationMs);

  return plugin.statusBarTimeoutId;
}
