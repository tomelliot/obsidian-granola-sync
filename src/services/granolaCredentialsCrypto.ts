import { Platform } from "obsidian";
import fs from "fs";
import crypto from "crypto";
import { execFile } from "child_process";

function execFileAsync(
  file: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(error as Error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

const KEYCHAIN_ITEM = "Granola Safe Storage";
const LINUX_SECRET_APPLICATION = "Granola";
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

export class UnsupportedPlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPlatformError";
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

export async function getKeychainPassword(): Promise<string> {
  if (Platform.isMacOS) {
    return getMacOSKeychainPassword();
  }
  if (Platform.isLinux) {
    return getLinuxKeychainPassword();
  }
  throw new UnsupportedPlatformError(
    "Encrypted Granola credentials are not yet supported on this platform"
  );
}

async function getMacOSKeychainPassword(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-w",
      "-s",
      KEYCHAIN_ITEM,
    ]);
    return stdout.replace(/\n$/, "");
  } catch (error) {
    throw new KeychainAccessError(
      `Could not read '${KEYCHAIN_ITEM}' from macOS Keychain: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function getLinuxKeychainPassword(): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("secret-tool", [
      "lookup",
      "application",
      LINUX_SECRET_APPLICATION,
    ]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message)) {
      throw new KeychainAccessError(
        "secret-tool is not installed. Install libsecret-tools (e.g. 'sudo apt install libsecret-tools') and try again."
      );
    }
    throw new KeychainAccessError(
      `Could not read Granola password from libsecret: ${message}`
    );
  }
  const password = stdout.replace(/\n$/, "");
  if (!password) {
    throw new KeychainAccessError(
      `No password found in libsecret for application='${LINUX_SECRET_APPLICATION}'. Make sure Granola is installed and you have logged in.`
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
  const password = await getKeychainPassword();
  const dek = decryptDek(password, dekBlob);
  const plaintext = decryptPayload(dek, encBlob);
  return plaintext.toString("utf-8");
}
