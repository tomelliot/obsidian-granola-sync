import { App, Vault } from 'obsidian';
import { GranolaDoc, ProseMirrorDoc } from './types';

export interface IFileSystem {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  normalizePath(path: string): string;
}

export interface IGranolaApi {
  getDocuments(accessToken: string): Promise<GranolaDoc[]>;
}

export interface IMarkdownConverter {
  convertProsemirrorToMarkdown(doc: ProseMirrorDoc | null | undefined): string;
}

export interface IDailyNotesService {
  getDailyNote(date: moment.Moment): any;
  createDailyNote(date: moment.Moment): Promise<any>;
  getAllDailyNotes(): Record<string, any>;
}

export interface IObsidianApp {
  vault: Vault;
  workspace: {
    containerEl: HTMLElement;
  };
}

export interface INotificationService {
  show(message: string, timeout?: number): void;
}

export interface IStatusBarService {
  setText(text: string): void;
} 