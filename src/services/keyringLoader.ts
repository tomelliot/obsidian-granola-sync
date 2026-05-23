import fs from "fs";
import path from "path";
import { Platform } from "obsidian";
import type { Entry as EntryClass } from "@napi-rs/keyring";
import {
  EMBEDDED_KEYRING_BINARIES,
  KEYRING_VERSION,
} from "./embeddedKeyringBinaries";

// Obsidian evaluates plugin code in a context where bare-name requires don't
// walk up to the plugin's own node_modules, and the community-plugin installer
// only ships main.js/manifest.json/styles.css. So we embed each platform's
// `@napi-rs/keyring` native binary as base64 inside main.js, extract the one
// matching the current host to the plugin directory on first use, and
// `process.dlopen` it directly.

let pluginDirectory: string | null = null;
export function setPluginDirectory(dir: string): void {
  pluginDirectory = dir;
}

export function detectPlatformTag(): string {
  if (Platform.isMobile) {
    throw new Error(
      "Granola credentials decryption is not supported on Obsidian mobile."
    );
  }
  if (Platform.isMacOS) {
    return `darwin-${process.arch}`;
  }
  if (Platform.isWin) {
    return `win32-${process.arch}-msvc`;
  }
  if (Platform.isLinux) {
    return `linux-${process.arch}-gnu`;
  }
  throw new Error(
    "Unsupported Obsidian platform for Granola credentials decryption."
  );
}

let entryCtor: typeof EntryClass | null = null;
export function loadEntry(): typeof EntryClass {
  if (entryCtor) return entryCtor;
  if (!pluginDirectory) {
    throw new Error(
      "Plugin directory has not been initialised; call setPluginDirectory() in onload()."
    );
  }
  const tag = detectPlatformTag();
  const base64 = EMBEDDED_KEYRING_BINARIES[tag];
  if (!base64) {
    throw new Error(
      `No bundled keyring binary for platform '${tag}'. Bundled platforms: ${Object.keys(
        EMBEDDED_KEYRING_BINARIES
      ).join(", ")}.`
    );
  }
  // Stamp the cached binary with the keyring version so plugin updates that
  // bump @napi-rs/keyring force a re-extraction.
  const binaryPath = path.join(
    pluginDirectory,
    `keyring-${KEYRING_VERSION}-${tag}.node`
  );
  if (!fs.existsSync(binaryPath)) {
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, Buffer.from(base64, "base64"));
  }
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  (
    process as unknown as {
      dlopen: (m: typeof moduleObj, filename: string) => void;
    }
  ).dlopen(moduleObj, binaryPath);
  const Entry = moduleObj.exports.Entry as typeof EntryClass | undefined;
  if (!Entry) {
    throw new Error(
      `Native keyring binary at ${binaryPath} did not export Entry. The file may be corrupt.`
    );
  }
  entryCtor = Entry;
  return entryCtor;
}
