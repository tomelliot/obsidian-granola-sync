export const requestUrl = jest.fn();
export const normalizePath = (path: string) => path.replace(/\\/g, "/");
export const App = jest.fn();
export class TFile {
  path: string;
  extension: string;

  constructor(path: string = "", extension: string = "md") {
    this.path = path;
    this.extension = extension;
  }
}
export const Editor = jest.fn();
export const MarkdownView = jest.fn();
export const Modal = jest.fn();
export const Notice = jest.fn();

// Mock Plugin class that properly sets the app property
export class Plugin {
  app: any;
  manifest: any;

  constructor(app: any, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }

  addStatusBarItem = jest.fn(() => ({ setText: jest.fn() }));
  addCommand = jest.fn();
  addSettingTab = jest.fn();
  registerInterval = jest.fn();
  loadData = jest.fn();
  saveData = jest.fn();
}

export const PluginSettingTab = jest.fn();
export const Setting = jest.fn();
export const moment = {
  format: jest.fn(),
  parseZone: jest.fn(),
};

export const Platform = {
  isWin: false,
  isLinux: false,
  isMacOS: true,
  isMobile: false,
  isDesktop: true,
};

/**
 * Mock implementation of Obsidian's stringifyYaml function
 * Converts a JavaScript value to YAML format
 *
 * Note: We assume Obsidian's stringifyYaml handles proper escaping of special characters.
 * This mock approximates real behavior: quotes strings containing special YAML
 * characters and replaces newlines, and always appends a trailing newline.
 */
export function stringifyYaml(value: unknown): string {
  if (typeof value === "string") {
    // Approximate real YAML: quote if the string contains special characters
    const needsQuoting = /["'\n\r:#{}[\],&*?|>!%@`]/.test(value);
    if (needsQuoting) {
      const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");
      return `"${escaped}"\n`;
    }
    return `${value}\n`;
  }

  // For arrays, objects, etc., use JSON stringification as a simple mock
  // In real Obsidian, this would use a proper YAML library
  return JSON.stringify(value) + "\n";
}
