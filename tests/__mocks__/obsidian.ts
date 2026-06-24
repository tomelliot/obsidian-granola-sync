import { stringify as yamlStringify, parse as yamlParse } from "yaml";

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
export class Modal {
  app: unknown;
  titleEl = {
    setText: jest.fn(),
    createEl: jest.fn(),
  };
  contentEl = {
    createEl: jest.fn(() => ({ createEl: jest.fn(), setText: jest.fn() })),
    createDiv: jest.fn(() => ({ createEl: jest.fn(), setText: jest.fn() })),
    empty: jest.fn(),
    setText: jest.fn(),
  };

  constructor(app: unknown) {
    this.app = app;
  }

  setTitle = jest.fn();
  setContent = jest.fn();
  open = jest.fn();
  close = jest.fn();
}
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
// Re-export the real moment package so tests get a callable moment with
// the full API surface, matching what Obsidian provides at runtime.
import realMoment from "moment";
export const moment = realMoment;

export const Platform = {
  isWin: false,
  isLinux: false,
  isMacOS: true,
  isMobile: false,
  isDesktop: true,
};

/**
 * Mock of Obsidian's stringifyYaml / parseYaml.
 *
 * Obsidian's YAML helpers wrap the eemeli `yaml` library. We delegate to that
 * same library (pinned in devDependencies) instead of approximating it, so
 * tests exercise real YAML serialization — block scalars, quoting, escaping —
 * and can catch invalid output such as the unindented block scalar behind
 * issue #139. A hand-rolled approximation previously masked that bug.
 */
export function stringifyYaml(value: unknown): string {
  return yamlStringify(value);
}

export function parseYaml(value: string): unknown {
  return yamlParse(value);
}
