export const requestUrl = jest.fn();
export const normalizePath = (path: string) => path.replace(/\\/g, '/');
export const App = jest.fn();
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
  parseZone: jest.fn()
}; 