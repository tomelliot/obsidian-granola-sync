import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Entry as EntryClass } from "@napi-rs/keyring";

// Obsidian evaluates plugin code in a context where bare-name requires don't
// walk up to the plugin's own node_modules (the calling module appears as
// electron's renderer init). The plugin must set its absolute directory at
// startup so we can resolve @napi-rs/keyring by absolute path.
let pluginDirectory: string | null = null;
export function setPluginDirectory(dir: string): void {
  pluginDirectory = dir;
}

let entryCtor: typeof EntryClass | null = null;
function getEntry(): typeof EntryClass {
  if (entryCtor) return entryCtor;
  if (!pluginDirectory) {
    throw new Error(
      "Plugin directory has not been initialised; call setPluginDirectory() in onload()."
    );
  }
  const keyringPath = path.join(
    pluginDirectory,
    "node_modules",
    "@napi-rs",
    "keyring"
  );
  entryCtor = (
    require(keyringPath) as { Entry: typeof EntryClass }
  ).Entry;
  return entryCtor;
}

const KEYCHAIN_SERVICE = "Granola Safe Storage";
const KEYCHAIN_ACCOUNT = "Granola Key";
const DEK_PREFIX = "v10";
const PBKDF2_SALT = "saltysalt";
const PBKDF2_ITERATIONS = 1003;
const PBKDF2_KEY_LENGTH = 16;
const PBKDF2_DIGEST = "sha1";
const DEK_IV = Buffer.alloc(16, 0x20); // 16 ASCII spaces
const DEK_LENGTH = 32;
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

export class KeychainAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeychainAccessError";
  }
}

export class CredentialDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialDecryptionError";
  }
}

export function decryptDek(password: string, dekBlob: Buffer): Buffer {
  if (dekBlob.subarray(0, DEK_PREFIX.length).toString("utf8") !== DEK_PREFIX) {
    throw new CredentialDecryptionError(
      `storage.dek does not start with ${DEK_PREFIX} prefix`
    );
  }
  const wrappingKey = crypto.pbkdf2Sync(
    password,
    PBKDF2_SALT,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LENGTH,
    PBKDF2_DIGEST
  );
  const decipher = crypto.createDecipheriv("aes-128-cbc", wrappingKey, DEK_IV);
  let unwrapped: Buffer;
  try {
    unwrapped = Buffer.concat([
      decipher.update(dekBlob.subarray(DEK_PREFIX.length)),
      decipher.final(),
    ]);
  } catch (error) {
    throw new CredentialDecryptionError(
      `Failed to unwrap DEK: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const dek = Buffer.from(unwrapped.toString("utf8"), "base64");
  if (dek.length !== DEK_LENGTH) {
    throw new CredentialDecryptionError(
      `Expected ${DEK_LENGTH}-byte DEK, got ${dek.length}`
    );
  }
  return dek;
}

export function decryptPayload(dek: Buffer, encBlob: Buffer): Buffer {
  if (encBlob.length < GCM_IV_LENGTH + GCM_TAG_LENGTH) {
    throw new CredentialDecryptionError(
      "Encrypted payload is too short to contain IV and auth tag"
    );
  }
  const iv = encBlob.subarray(0, GCM_IV_LENGTH);
  const tag = encBlob.subarray(encBlob.length - GCM_TAG_LENGTH);
  const ciphertext = encBlob.subarray(
    GCM_IV_LENGTH,
    encBlob.length - GCM_TAG_LENGTH
  );
  const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new CredentialDecryptionError(
      `Failed to decrypt credentials payload: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function getKeychainPassword(): string {
  let password: string | null;
  try {
    const Entry = getEntry();
    const entry = new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    password = entry.getPassword();
  } catch (error) {
    throw new KeychainAccessError(
      `Could not read '${KEYCHAIN_SERVICE}' from system keychain: ${error instanceof Error ? error.message : String(error)}. Make sure Granola is installed and you have logged in.`
    );
  }
  if (!password) {
    throw new KeychainAccessError(
      `No password found in system keychain for service='${KEYCHAIN_SERVICE}', account='${KEYCHAIN_ACCOUNT}'. Make sure Granola is installed and you have logged in.`
    );
  }
  return password;
}

export async function loadEncryptedCredentials(
  encPath: string,
  dekPath: string
): Promise<string> {
  const [dekBlob, encBlob] = await Promise.all([
    fs.promises.readFile(dekPath),
    fs.promises.readFile(encPath),
  ]);
  const password = getKeychainPassword();
  const dek = decryptDek(password, dekBlob);
  const plaintext = decryptPayload(dek, encBlob);
  return plaintext.toString("utf-8");
}
