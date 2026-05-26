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

// === Constants ===

const KEYCHAIN_SERVICE = "Granola Safe Storage";
const KEYCHAIN_ACCOUNT = "Granola Key";

// `storage.dek` is wrapped with a Chromium-style envelope: a 3-byte ASCII
// `v10` prefix followed by ciphertext. The cipher inside differs by platform
// (PBKDF2 + AES-128-CBC on macOS/Linux, AES-256-GCM keyed by the safeStorage
// key on Windows), but the prefix and the base64-encoded-DEK plaintext are
// the same.
const V10_PREFIX = "v10";
const DEK_LENGTH = 32;

// Keychain path: parameters of Chromium's macOS/Linux OSCrypt KDF.
const PBKDF2_SALT = "saltysalt";
const PBKDF2_ITERATIONS = 1003;
const PBKDF2_KEY_LENGTH = 16;
const PBKDF2_DIGEST = "sha1";
const KEYCHAIN_DEK_IV = Buffer.alloc(16, 0x20); // 16 ASCII spaces

// AES-256-GCM layout used both for `stored-accounts.json.enc` and for the
// inner ciphertext of a `v10`-wrapped `storage.dek` on Windows.
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

// `Local State.os_crypt.encrypted_key` is base64 of: 5-byte ASCII `DPAPI`
// prefix + the actual `CryptProtectData` blob.
const DPAPI_PREFIX = "DPAPI";

// === Errors ===

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

// === Shared crypto primitives ===

/**
 * Decrypts a bare AES-256-GCM blob in Granola's on-disk layout:
 * 12-byte IV + ciphertext + 16-byte authentication tag.
 *
 * Used both for `stored-accounts.json.enc` (keyed by the DEK) and, on
 * Windows, for the inner ciphertext of `storage.dek` after the `v10`
 * prefix has been stripped (keyed by the safeStorage key).
 */
export function decryptPayload(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < GCM_IV_LENGTH + GCM_TAG_LENGTH) {
    throw new CredentialDecryptionError(
      "Encrypted payload is too short to contain IV and auth tag"
    );
  }
  const iv = blob.subarray(0, GCM_IV_LENGTH);
  const tag = blob.subarray(blob.length - GCM_TAG_LENGTH);
  const ciphertext = blob.subarray(GCM_IV_LENGTH, blob.length - GCM_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new CredentialDecryptionError(
      `Failed to decrypt credentials payload: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function stripV10Prefix(blob: Buffer, source: string): Buffer {
  if (blob.subarray(0, V10_PREFIX.length).toString("utf8") !== V10_PREFIX) {
    throw new CredentialDecryptionError(
      `${source} does not start with ${V10_PREFIX} prefix`
    );
  }
  return blob.subarray(V10_PREFIX.length);
}

function decodeBase64Dek(plaintext: Buffer, source: string): Buffer {
  const dek = Buffer.from(plaintext.toString("utf8"), "base64");
  if (dek.length !== DEK_LENGTH) {
    throw new CredentialDecryptionError(
      `Expected ${DEK_LENGTH}-byte DEK from ${source}, got ${dek.length}`
    );
  }
  return dek;
}

// === Keychain path (macOS / Linux) ===

/**
 * Reads the `Granola Safe Storage` password from the OS keychain. Throws
 * `KeychainAccessError` on any failure (binary load, backend missing, user
 * denied the prompt, no entry stored).
 */
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

/**
 * Unwraps `storage.dek` using the keychain password — the format Chromium
 * uses on macOS/Linux: `v10` prefix + AES-128-CBC, key derived via
 * PBKDF2-HMAC-SHA1, plaintext is the base64-encoded 32-byte DEK.
 */
export function decryptKeychainDek(password: string, dekBlob: Buffer): Buffer {
  const wrappedCiphertext = stripV10Prefix(dekBlob, "storage.dek");
  const wrappingKey = crypto.pbkdf2Sync(
    password,
    PBKDF2_SALT,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LENGTH,
    PBKDF2_DIGEST
  );
  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    wrappingKey,
    KEYCHAIN_DEK_IV
  );
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([
      decipher.update(wrappedCiphertext),
      decipher.final(),
    ]);
  } catch (error) {
    throw new CredentialDecryptionError(
      `Failed to unwrap DEK: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return decodeBase64Dek(plaintext, "storage.dek");
}

async function resolveDekViaKeychain(dekPath: string): Promise<Buffer> {
  const dekBlob = await fs.promises.readFile(dekPath);
  const password = getKeychainPassword();
  return decryptKeychainDek(password, dekBlob);
}

// === DPAPI path (Windows) ===

interface LocalStateShape {
  os_crypt?: { encrypted_key?: string };
}

/**
 * Parses Granola's Electron `Local State` JSON and returns the DPAPI-wrapped
 * safeStorage key blob (with the leading 5-byte `DPAPI` ASCII prefix
 * stripped).
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
 * Unwraps Granola's OSCrypt safeStorage AES key via Windows DPAPI (NULL
 * entropy, `CurrentUser` scope — the same options Chromium/Electron's
 * `safeStorage` uses on Windows). Returns the 32-byte AES-256 key.
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
  let key: Buffer;
  try {
    key = Buffer.from(dpapi.unprotectData(wrappedKey, null, "CurrentUser"));
  } catch (error) {
    throw new DpapiAccessError(
      `CryptUnprotectData failed: ${error instanceof Error ? error.message : String(error)}. The Granola key was encrypted by a different Windows user account or profile.`
    );
  }
  if (key.length !== DEK_LENGTH) {
    throw new DpapiAccessError(
      `Expected ${DEK_LENGTH}-byte safeStorage key from DPAPI unwrap, got ${key.length}`
    );
  }
  return key;
}

/**
 * Unwraps `storage.dek` using the safeStorage key — the format Chromium uses
 * on Windows: `v10` prefix + AES-256-GCM. Plaintext is the base64-encoded
 * 32-byte DEK.
 */
export function decryptDpapiDek(
  safeStorageKey: Buffer,
  dekBlob: Buffer
): Buffer {
  const wrappedCiphertext = stripV10Prefix(dekBlob, "storage.dek");
  const plaintext = decryptPayload(safeStorageKey, wrappedCiphertext);
  return decodeBase64Dek(plaintext, "storage.dek");
}

async function resolveDekViaDpapi(
  dekPath: string,
  localStatePath: string
): Promise<Buffer> {
  const [dekBlob, localStateRaw] = await Promise.all([
    fs.promises.readFile(dekPath),
    fs.promises.readFile(localStatePath, "utf-8"),
  ]);
  const wrappedKey = extractDpapiWrappedKey(localStateRaw);
  const safeStorageKey = unwrapDpapiKey(wrappedKey);
  return decryptDpapiDek(safeStorageKey, dekBlob);
}

// === Entry point ===

export type LoadEncryptedCredentialsOpts =
  | { mode: "keychain"; encPath: string; dekPath: string }
  | {
      mode: "dpapi";
      encPath: string;
      dekPath: string;
      localStatePath: string;
    };

/**
 * Loads, decrypts, and returns the plaintext `stored-accounts.json` contents
 * for the current platform. The keychain and DPAPI branches converge on a
 * 32-byte DEK; the final payload decrypt is shared.
 */
export async function loadEncryptedCredentials(
  opts: LoadEncryptedCredentialsOpts
): Promise<string> {
  const dekPromise =
    opts.mode === "keychain"
      ? resolveDekViaKeychain(opts.dekPath)
      : resolveDekViaDpapi(opts.dekPath, opts.localStatePath);
  const [dek, encBlob] = await Promise.all([
    dekPromise,
    fs.promises.readFile(opts.encPath),
  ]);
  return decryptPayload(dek, encBlob).toString("utf-8");
}
