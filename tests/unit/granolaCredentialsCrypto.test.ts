import crypto from "crypto";
import fs from "fs";
import { execFile } from "child_process";
import { Platform } from "obsidian";
import {
  decryptDek,
  decryptPayload,
  getKeychainPassword,
  loadEncryptedCredentials,
  KeychainAccessError,
  CredentialDecryptionError,
  UnsupportedPlatformError,
} from "../../src/services/granolaCredentialsCrypto";

jest.mock("obsidian", () => ({
  Platform: { isMacOS: true, isLinux: false, isWin: false },
}));

jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

const PBKDF2_SALT = "saltysalt";
const PBKDF2_ITERATIONS = 1003;
const DEK_IV = Buffer.alloc(16, 0x20);

function encryptDek(password: string, dekBytes: Buffer): Buffer {
  const wrappingKey = crypto.pbkdf2Sync(
    password,
    PBKDF2_SALT,
    PBKDF2_ITERATIONS,
    16,
    "sha1"
  );
  const cipher = crypto.createCipheriv("aes-128-cbc", wrappingKey, DEK_IV);
  const dekBase64 = Buffer.from(dekBytes.toString("base64"), "utf8");
  const ciphertext = Buffer.concat([cipher.update(dekBase64), cipher.final()]);
  return Buffer.concat([Buffer.from("v10", "utf8"), ciphertext]);
}

function encryptPayload(dek: Buffer, plaintext: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

function setPlatform(platform: "macos" | "linux" | "windows" | "other") {
  (Platform as { isMacOS: boolean }).isMacOS = platform === "macos";
  (Platform as { isLinux: boolean }).isLinux = platform === "linux";
  (Platform as { isWin: boolean }).isWin = platform === "windows";
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform("macos");
});

describe("decryptDek", () => {
  it("recovers the original DEK from a v10-prefixed blob", () => {
    const password = "test-password";
    const dek = crypto.randomBytes(32);
    const blob = encryptDek(password, dek);

    const result = decryptDek(password, blob);

    expect(result.equals(dek)).toBe(true);
  });

  it("throws CredentialDecryptionError when the v10 prefix is missing", () => {
    const password = "test-password";
    const dek = crypto.randomBytes(32);
    const blob = encryptDek(password, dek);
    const tampered = Buffer.concat([Buffer.from("xxx"), blob.subarray(3)]);

    expect(() => decryptDek(password, tampered)).toThrow(
      CredentialDecryptionError
    );
  });

  it("throws CredentialDecryptionError when the password is wrong", () => {
    const dek = crypto.randomBytes(32);
    const blob = encryptDek("correct-password", dek);

    expect(() => decryptDek("wrong-password", blob)).toThrow(
      CredentialDecryptionError
    );
  });
});

describe("decryptPayload", () => {
  it("recovers the original plaintext", () => {
    const dek = crypto.randomBytes(32);
    const plaintext = Buffer.from(JSON.stringify({ hello: "world" }), "utf8");
    const blob = encryptPayload(dek, plaintext);

    const result = decryptPayload(dek, blob);

    expect(result.toString("utf8")).toBe(plaintext.toString("utf8"));
  });

  it("throws CredentialDecryptionError when the auth tag is tampered", () => {
    const dek = crypto.randomBytes(32);
    const plaintext = Buffer.from("secret data", "utf8");
    const blob = encryptPayload(dek, plaintext);
    blob[blob.length - 1] ^= 0xff;

    expect(() => decryptPayload(dek, blob)).toThrow(CredentialDecryptionError);
  });

  it("throws CredentialDecryptionError when the blob is too short", () => {
    const dek = crypto.randomBytes(32);
    expect(() => decryptPayload(dek, Buffer.alloc(8))).toThrow(
      CredentialDecryptionError
    );
  });
});

describe("getKeychainPassword", () => {
  it("invokes `security` on macOS and trims the trailing newline", async () => {
    setPlatform("macos");
    (execFile as unknown as jest.Mock).mockImplementation(
      (_file, _args, _opts, cb) => cb(null, "macos-pw\n", "")
    );

    await expect(getKeychainPassword()).resolves.toBe("macos-pw");

    const [file, args] = (execFile as unknown as jest.Mock).mock.calls[0];
    expect(file).toBe("security");
    expect(args).toEqual([
      "find-generic-password",
      "-w",
      "-s",
      "Granola Safe Storage",
    ]);
  });

  it("wraps macOS keychain failures in KeychainAccessError", async () => {
    setPlatform("macos");
    (execFile as unknown as jest.Mock).mockImplementation(
      (_file, _args, _opts, cb) => cb(new Error("item not found"), "", "")
    );

    await expect(getKeychainPassword()).rejects.toBeInstanceOf(
      KeychainAccessError
    );
  });

  it("invokes `secret-tool` on Linux and returns the password", async () => {
    setPlatform("linux");
    (execFile as unknown as jest.Mock).mockImplementation(
      (_file, _args, _opts, cb) => cb(null, "linux-pw\n", "")
    );

    await expect(getKeychainPassword()).resolves.toBe("linux-pw");

    const [file, args] = (execFile as unknown as jest.Mock).mock.calls[0];
    expect(file).toBe("secret-tool");
    expect(args).toEqual(["lookup", "application", "Granola"]);
  });

  it("throws KeychainAccessError when secret-tool returns an empty password", async () => {
    setPlatform("linux");
    (execFile as unknown as jest.Mock).mockImplementation(
      (_file, _args, _opts, cb) => cb(null, "", "")
    );

    await expect(getKeychainPassword()).rejects.toBeInstanceOf(
      KeychainAccessError
    );
  });

  it("throws KeychainAccessError pointing at libsecret-tools when secret-tool is missing", async () => {
    setPlatform("linux");
    const enoent = Object.assign(new Error("spawn secret-tool ENOENT"), {
      code: "ENOENT",
    });
    (execFile as unknown as jest.Mock).mockImplementation(
      (_file, _args, _opts, cb) => cb(enoent, "", "")
    );

    await expect(getKeychainPassword()).rejects.toThrow(/libsecret-tools/);
  });

  it("throws UnsupportedPlatformError on Windows", async () => {
    setPlatform("windows");

    await expect(getKeychainPassword()).rejects.toBeInstanceOf(
      UnsupportedPlatformError
    );
  });
});

describe("loadEncryptedCredentials", () => {
  it("reads both files, decrypts, and returns the plaintext string", async () => {
    setPlatform("macos");
    const password = "kc-secret";
    const dek = crypto.randomBytes(32);
    const dekBlob = encryptDek(password, dek);
    const plaintext = JSON.stringify({ workos_tokens: "stringified-tokens" });
    const encBlob = encryptPayload(dek, Buffer.from(plaintext, "utf8"));

    (fs.promises.readFile as jest.Mock).mockImplementation((p: string) => {
      if (p === "/granola/storage.dek") return Promise.resolve(dekBlob);
      if (p === "/granola/supabase.json.enc") return Promise.resolve(encBlob);
      return Promise.reject(new Error(`unexpected path: ${p}`));
    });
    (execFile as unknown as jest.Mock).mockImplementation(
      (_file, _args, _opts, cb) => cb(null, `${password}\n`, "")
    );

    const result = await loadEncryptedCredentials(
      "/granola/supabase.json.enc",
      "/granola/storage.dek"
    );

    expect(result).toBe(plaintext);
  });

  it("propagates ENOENT from a missing storage.dek", async () => {
    setPlatform("macos");
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    (fs.promises.readFile as jest.Mock).mockRejectedValue(enoent);

    await expect(
      loadEncryptedCredentials("/x.enc", "/y.dek")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("propagates KeychainAccessError when the keychain lookup fails", async () => {
    setPlatform("macos");
    const dek = crypto.randomBytes(32);
    const dekBlob = encryptDek("anything", dek);
    const encBlob = encryptPayload(dek, Buffer.from("{}", "utf8"));
    (fs.promises.readFile as jest.Mock).mockImplementation((p: string) =>
      Promise.resolve(p.endsWith(".dek") ? dekBlob : encBlob)
    );
    (execFile as unknown as jest.Mock).mockImplementation(
      (_file, _args, _opts, cb) => cb(new Error("denied"), "", "")
    );

    await expect(
      loadEncryptedCredentials("/x.enc", "/y.dek")
    ).rejects.toBeInstanceOf(KeychainAccessError);
  });
});
