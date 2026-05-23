import crypto from "crypto";
import fs from "fs";
import { loadEntry } from "../../src/services/keyringLoader";
import {
  decryptDek,
  decryptPayload,
  getKeychainPassword,
  loadEncryptedCredentials,
  KeychainAccessError,
  CredentialDecryptionError,
} from "../../src/services/granolaCredentialsCrypto";

jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

jest.mock("../../src/services/keyringLoader", () => ({
  loadEntry: jest.fn(),
  setPluginDirectory: jest.fn(),
}));

const mockLoadEntry = loadEntry as jest.MockedFunction<typeof loadEntry>;
const MockEntry = jest.fn();

function mockEntry(getPassword: jest.Mock | (() => string | null)) {
  MockEntry.mockImplementation(() => ({
    getPassword:
      typeof getPassword === "function" ? getPassword : () => getPassword,
  }));
  mockLoadEntry.mockReturnValue(
    MockEntry as unknown as ReturnType<typeof loadEntry>
  );
}

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

beforeEach(() => {
  jest.clearAllMocks();
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
  it("constructs Entry with the Granola service and account, returning the password", () => {
    mockEntry(() => "kc-secret");

    expect(getKeychainPassword()).toBe("kc-secret");
    expect(MockEntry).toHaveBeenCalledWith(
      "Granola Safe Storage",
      "Granola Key"
    );
  });

  it("throws KeychainAccessError when loadEntry throws", () => {
    mockLoadEntry.mockImplementation(() => {
      throw new Error("native binary failed to load");
    });

    expect(() => getKeychainPassword()).toThrow(KeychainAccessError);
  });

  it("throws KeychainAccessError when Entry construction throws", () => {
    MockEntry.mockImplementation(() => {
      throw new Error("keyring backend not available");
    });
    mockLoadEntry.mockReturnValue(
      MockEntry as unknown as ReturnType<typeof loadEntry>
    );

    expect(() => getKeychainPassword()).toThrow(KeychainAccessError);
  });

  it("throws KeychainAccessError when getPassword throws", () => {
    mockEntry(
      jest.fn(() => {
        throw new Error("user denied");
      })
    );

    expect(() => getKeychainPassword()).toThrow(KeychainAccessError);
  });

  it("throws KeychainAccessError when the entry is empty", () => {
    mockEntry(() => null);

    expect(() => getKeychainPassword()).toThrow(KeychainAccessError);
  });
});

describe("loadEncryptedCredentials", () => {
  it("reads both files, decrypts, and returns the plaintext string", async () => {
    const password = "kc-secret";
    const dek = crypto.randomBytes(32);
    const dekBlob = encryptDek(password, dek);
    const plaintext = JSON.stringify({ accounts: "stringified-accounts" });
    const encBlob = encryptPayload(dek, Buffer.from(plaintext, "utf8"));

    (fs.promises.readFile as jest.Mock).mockImplementation((p: string) => {
      if (p === "/granola/storage.dek") return Promise.resolve(dekBlob);
      if (p === "/granola/stored-accounts.json.enc") return Promise.resolve(encBlob);
      return Promise.reject(new Error(`unexpected path: ${p}`));
    });
    mockEntry(() => password);

    const result = await loadEncryptedCredentials(
      "/granola/stored-accounts.json.enc",
      "/granola/storage.dek"
    );

    expect(result).toBe(plaintext);
  });

  it("propagates ENOENT from a missing storage.dek", async () => {
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    (fs.promises.readFile as jest.Mock).mockRejectedValue(enoent);

    await expect(
      loadEncryptedCredentials("/x.enc", "/y.dek")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("propagates KeychainAccessError when the keychain lookup fails", async () => {
    const dek = crypto.randomBytes(32);
    const dekBlob = encryptDek("anything", dek);
    const encBlob = encryptPayload(dek, Buffer.from("{}", "utf8"));
    (fs.promises.readFile as jest.Mock).mockImplementation((p: string) =>
      Promise.resolve(p.endsWith(".dek") ? dekBlob : encBlob)
    );
    mockEntry(
      jest.fn(() => {
        throw new Error("denied");
      })
    );

    await expect(
      loadEncryptedCredentials("/x.enc", "/y.dek")
    ).rejects.toBeInstanceOf(KeychainAccessError);
  });
});
