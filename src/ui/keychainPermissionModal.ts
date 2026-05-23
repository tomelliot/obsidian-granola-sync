import { App, Modal } from "obsidian";

const CREDENTIALS_DOC_URL =
  "https://github.com/tomelliot/obsidian-granola-sync/blob/main/docs/CREDENTIALS.md";

export class KeychainPermissionModal extends Modal {
  constructor(app: App) {
    super(app);

    this.setTitle("Granola needs keychain access");

    this.contentEl.createEl("p", {
      text:
        "Granola stores its API credentials encrypted on disk. The decryption key lives in your operating system's keychain. The plugin can't sync until you allow it to read that key.",
    });

    this.contentEl.createEl("p", {
      text:
        "Re-run the sync and choose 'always allow' when your OS asks. You can revoke access at any time from the keychain UI.",
    });

    const linkParagraph = this.contentEl.createEl("p", {
      text: "For more information on how credentials are loaded, see the",
    });
    linkParagraph.createEl("a", {
      // Link text is intentionally lowercase — it appears mid-sentence after
      // "see the …", so the sentence-case rule doesn't apply.
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text: "documentation.",
      href: CREDENTIALS_DOC_URL,
    });
    linkParagraph.appendText(".");
  }
}
