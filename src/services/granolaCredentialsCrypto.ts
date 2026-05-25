import fs from "fs";
import crypto from "crypto";
import {
  loadEntry,
  setPluginDirectory as setKeyringPluginDirectory,
} from "./keyringLoader";
import {
  loadDpapi,
  setPluginDirectory as setDpapiPluginDirectory,
} from "./dpapiLoader";

export function setPluginDirectory(dir: string): void {
  setKeyringPluginDirectory(dir);
  setDpapiPluginDirectory(dir);
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
const DPAPI_PREFIX = "DPAPI";

export class KeychainAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeychainAccessError";
  }
}

export class DpapiAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DpapiAccessError";
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
    const Entry = loadEntry();
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

interface LocalStateShape {
  os_crypt?: { encrypted_key?: string };
}

/**
 * Parses Granola's Electron `Local State` JSON and returns the DPAPI-wrapped
 * AES key blob (with the leading 5-byte `DPAPI` ASCII prefix stripped).
 */
export function extractDpapiWrappedKey(localStateJson: string): Buffer {
  let parsed: LocalStateShape;
  try {
    parsed = JSON.parse(localStateJson) as LocalStateShape;
  } catch (error) {
    throw new DpapiAccessError(
      `Failed to parse Local State JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const encoded = parsed.os_crypt?.encrypted_key;
  if (!encoded) {
    throw new DpapiAccessError(
      "Granola Local State is missing os_crypt.encrypted_key. The Granola app may not have created an OSCrypt key yet — sign in via the Granola desktop app and try again."
    );
  }
  const decoded = Buffer.from(encoded, "base64");
  if (
    decoded.subarray(0, DPAPI_PREFIX.length).toString("ascii") !== DPAPI_PREFIX
  ) {
    throw new DpapiAccessError(
      `os_crypt.encrypted_key does not start with the expected '${DPAPI_PREFIX}' prefix`
    );
  }
  return decoded.subarray(DPAPI_PREFIX.length);
}

/**
 * Unwraps Granola's OSCrypt AES key via Windows DPAPI (NULL entropy,
 * CurrentUser scope — the same options Chromium/Electron's `safeStorage`
 * uses on Windows).
 */
export function unwrapDpapiKey(wrappedKey: Buffer): Buffer {
  let dpapi: ReturnType<typeof loadDpapi>;
  try {
    dpapi = loadDpapi();
  } catch (error) {
    throw new DpapiAccessError(
      `Could not load native DPAPI binding: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  let dek: Buffer;
  try {
    dek = Buffer.from(dpapi.unprotectData(wrappedKey, null, "CurrentUser"));
  } catch (error) {
    throw new DpapiAccessError(
      `CryptUnprotectData failed: ${error instanceof Error ? error.message : String(error)}. The Granola key was encrypted by a different Windows user account or profile.`
    );
  }
  if (dek.length !== DEK_LENGTH) {
    throw new DpapiAccessError(
      `Expected ${DEK_LENGTH}-byte DEK from DPAPI unwrap, got ${dek.length}`
    );
  }
  return dek;
}

export type LoadEncryptedCredentialsOpts =
  | { mode: "keychain"; encPath: string; dekPath: string }
  | { mode: "dpapi"; encPath: string; localStatePath: string };

export async function loadEncryptedCredentials(
  opts: LoadEncryptedCredentialsOpts
): Promise<string> {
  if (opts.mode === "keychain") {
    const [dekBlob, encBlob] = await Promise.all([
      fs.promises.readFile(opts.dekPath),
      fs.promises.readFile(opts.encPath),
    ]);
    const password = getKeychainPassword();
    const dek = decryptDek(password, dekBlob);
    const plaintext = decryptPayload(dek, encBlob);
    return plaintext.toString("utf-8");
  }
  const [localStateRaw, encBlob] = await Promise.all([
    fs.promises.readFile(opts.localStatePath, "utf-8"),
    fs.promises.readFile(opts.encPath),
  ]);
  const wrappedKey = extractDpapiWrappedKey(localStateRaw);
  const dek = unwrapDpapiKey(wrappedKey);
  const plaintext = decryptPayload(dek, encBlob);
  return plaintext.toString("utf-8");
}
