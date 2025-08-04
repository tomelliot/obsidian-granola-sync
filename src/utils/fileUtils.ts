import { Editor } from "codemirror";
import { App, MarkdownView, TFile, normalizePath, Notice, TFolder } from "obsidian";

// Define the type for the Obsidian editor that wraps CodeMirror
interface ObsidianEditor {
  cmEditor: Editor;
}

export function getEditorForFile(app: App, file: TFile): Editor | null {
  let editor = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (leaf.view instanceof MarkdownView && leaf.view.file === file) {
      // Cast to unknown first to safely access the cmEditor property
      editor = (leaf.view.editor as unknown as ObsidianEditor).cmEditor;
    }
  });
  return editor;
}

function formatAsFilename(str: string) {
  // Remove any characters that aren't in this explicit list, to ensure safety for file paths
  let validStr = str.replace(/[^a-zA-Z0-9\s\.\-_]/g, '');

  // Remove leading and trailing spaces
  validStr = validStr.trim();

  // Ensure the filename is not too long
  const MAX_LENGTH = 150;
  validStr = validStr.substring(0, MAX_LENGTH);

  return validStr;
}


/**
 * A utility to make sure that all folders exist, if not, they will get created as an empty file
 * @param app
 * @param path eg. path/to/file.md
 */
async function touchFileAtPath(app: App, path: string) {
  const { vault } = app;
  const pathParts = path.split('/');
  const currentPath = [];

  if (pathParts.length === 0) {
    return;
  }
  
  // Create all necessary folders
  while (pathParts.length > 1) {
    const part = pathParts.shift();
    currentPath.push(part);
    const currentFolderPath = currentPath.join('/');
    const folder = vault.getAbstractFileByPath(currentFolderPath);

    if (!folder || !(folder instanceof TFolder)) {
      await vault.createFolder(currentFolderPath)
    }
  }

  // All necessary folders exist. Create the file at the end
  const file = vault.getAbstractFileByPath(path);
  
  if (!file || !(file instanceof TFile)) {
    return await vault.create(path, '');
  }

  return file;
}

