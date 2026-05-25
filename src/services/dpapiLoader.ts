import fs from "fs";
import path from "path";
import { Platform } from "obsidian";
import {
  DPAPI_VERSION,
  EMBEDDED_DPAPI_BINARIES,
} from "./embeddedDpapiBinaries";

// Mirrors keyringLoader.ts: Obsidian's plugin loader can't resolve
// `require("@primno/dpapi")` from bundled main.js, so we embed each Windows
// architecture's prebuilt `.node` as base64, extract the matching one to the
// plugin directory on first use, and `process.dlopen` it directly.

export interface DpapiBindings {
  unprotectData(
    data: Uint8Array,
    entropy: Uint8Array | null,
    scope: "CurrentUser" | "LocalMachine"
  ): Buffer;
}

let pluginDirectory: string | null = null;
export function setPluginDirectory(dir: string): void {
  pluginDirectory = dir;
}

export function detectDpapiPlatformTag(): string {
  if (!Platform.isWin) {
    throw new Error("DPAPI is only available on Windows.");
  }
  return `win32-${process.arch}`;
}

let dpapiBindings: DpapiBindings | null = null;
export function loadDpapi(): DpapiBindings {
  if (dpapiBindings) return dpapiBindings;
  if (!pluginDirectory) {
    throw new Error(
      "Plugin directory has not been initialised; call setPluginDirectory() in onload()."
    );
  }
  const tag = detectDpapiPlatformTag();
  const base64 = EMBEDDED_DPAPI_BINARIES[tag];
  if (!base64) {
    throw new Error(
      `No bundled DPAPI binary for platform '${tag}'. Bundled platforms: ${Object.keys(
        EMBEDDED_DPAPI_BINARIES
      ).join(", ")}.`
    );
  }
  // Stamp the cached binary with the dpapi version so plugin updates that
  // bump @primno/dpapi force a re-extraction.
  const binaryPath = path.join(
    pluginDirectory,
    `dpapi-${DPAPI_VERSION}-${tag}.node`
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
  const unprotectData = moduleObj.exports.unprotectData as
    | DpapiBindings["unprotectData"]
    | undefined;
  if (typeof unprotectData !== "function") {
    throw new Error(
      `Native DPAPI binary at ${binaryPath} did not export unprotectData. The file may be corrupt.`
    );
  }
  dpapiBindings = { unprotectData };
  return dpapiBindings;
}
