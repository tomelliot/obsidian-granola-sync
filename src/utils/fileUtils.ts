import { App, MarkdownView, TFile, Editor } from "obsidian";

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
