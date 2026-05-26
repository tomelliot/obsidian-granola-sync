import crypto from "crypto";
import fs from "fs";
import { loadEntry } from "../../src/services/keyringLoader";
import { loadDpapi } from "../../src/services/dpapiLoader";
import {
  decryptKeychainDek,
  decryptDpapiDek,
  decryptPayload,
  extractDpapiWrappedKey,
  unwrapDpapiKey,
  getKeychainPassword,
  loadEncryptedCredentials,
  KeychainAccessError,
  DpapiAccessError,
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

jest.mock("../../src/services/dpapiLoader", () => ({
  loadDpapi: jest.fn(),
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

const mockLoadDpapi = loadDpapi as jest.MockedFunction<typeof loadDpapi>;

function mockDpapi(
  unprotectData:
    | ((data: Uint8Array, entropy: Uint8Array | null, scope: string) => Buffer)
    | jest.Mock
) {
  const fn =
    typeof unprotectData === "function"
      ? jest.fn(unprotectData)
      : unprotectData;
  mockLoadDpapi.mockReturnValue({
    unprotectData: fn as unknown as ReturnType<typeof loadDpapi>["unprotectData"],
  });
  return fn;
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

function makeLocalStateJson(wrappedKey: Buffer): string {
  return JSON.stringify({
    os_crypt: {
      encrypted_key: Buffer.concat([
        Buffer.from("DPAPI", "ascii"),
        wrappedKey,
      ]).toString("base64"),
    },
  });
}

/**
 * Builds a v10-prefixed AES-256-GCM-encrypted `storage.dek` blob whose
 * plaintext is the base64-encoded DEK — matches the Windows on-disk format.
 */
function encryptDpapiDek(safeStorageKey: Buffer, dek: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", safeStorageKey, iv);
  const dekBase64 = Buffer.from(dek.toString("base64"), "utf8");
  const ciphertext = Buffer.concat([cipher.update(dekBase64), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("v10", "utf8"), iv, ciphertext, tag]);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("decryptKeychainDek", () => {
  it("recovers the original DEK from a v10-prefixed blob", () => {
    const password = "test-password";
    const dek = crypto.randomBytes(32);
    const blob = encryptDek(password, dek);

    const result = decryptKeychainDek(password, blob);

    expect(result.equals(dek)).toBe(true);
  });

  it("throws CredentialDecryptionError when the v10 prefix is missing", () => {
    const password = "test-password";
    const dek = crypto.randomBytes(32);
    const blob = encryptDek(password, dek);
    const tampered = Buffer.concat([Buffer.from("xxx"), blob.subarray(3)]);

    expect(() => decryptKeychainDek(password, tampered)).toThrow(
      CredentialDecryptionError
    );
  });

  it("throws CredentialDecryptionError when the password is wrong", () => {
    const dek = crypto.randomBytes(32);
    const blob = encryptDek("correct-password", dek);

    expect(() => decryptKeychainDek("wrong-password", blob)).toThrow(
      CredentialDecryptionError
    );
  });
});

describe("decryptDpapiDek", () => {
  it("recovers the original DEK from a v10-prefixed GCM blob", () => {
    const safeStorageKey = crypto.randomBytes(32);
    const dek = crypto.randomBytes(32);
    const blob = encryptDpapiDek(safeStorageKey, dek);

    const result = decryptDpapiDek(safeStorageKey, blob);

    expect(result.equals(dek)).toBe(true);
  });

  it("throws CredentialDecryptionError when the v10 prefix is missing", () => {
    const safeStorageKey = crypto.randomBytes(32);
    const dek = crypto.randomBytes(32);
    const blob = encryptDpapiDek(safeStorageKey, dek);
    const tampered = Buffer.concat([Buffer.from("xxx"), blob.subarray(3)]);

    expect(() => decryptDpapiDek(safeStorageKey, tampered)).toThrow(
      CredentialDecryptionError
    );
  });

  it("throws CredentialDecryptionError when the safeStorage key is wrong (GCM auth fails)", () => {
    const dek = crypto.randomBytes(32);
    const blob = encryptDpapiDek(crypto.randomBytes(32), dek);

    expect(() => decryptDpapiDek(crypto.randomBytes(32), blob)).toThrow(
      CredentialDecryptionError
    );
  });

  it("throws CredentialDecryptionError when the plaintext is not a 32-byte base64 DEK", () => {
    const safeStorageKey = crypto.randomBytes(32);
    const shortDek = crypto.randomBytes(16);
    const blob = encryptDpapiDek(safeStorageKey, shortDek);

    expect(() => decryptDpapiDek(safeStorageKey, blob)).toThrow(
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

describe("extractDpapiWrappedKey", () => {
  it("base64-decodes encrypted_key and strips the DPAPI prefix", () => {
    const wrapped = crypto.randomBytes(80);
    const localState = makeLocalStateJson(wrapped);

    const result = extractDpapiWrappedKey(localState);

    expect(result.equals(wrapped)).toBe(true);
  });

  it("throws DpapiAccessError when Local State is not valid JSON", () => {
    expect(() => extractDpapiWrappedKey("not json")).toThrow(DpapiAccessError);
  });

  it("throws DpapiAccessError when os_crypt.encrypted_key is missing", () => {
    expect(() =>
      extractDpapiWrappedKey(JSON.stringify({ os_crypt: {} }))
    ).toThrow(DpapiAccessError);
    expect(() => extractDpapiWrappedKey(JSON.stringify({}))).toThrow(
      DpapiAccessError
    );
  });

  it("throws DpapiAccessError when the DPAPI prefix is missing", () => {
    const noPrefix = JSON.stringify({
      os_crypt: {
        encrypted_key: Buffer.from("XXXXX-not-the-right-prefix").toString(
          "base64"
        ),
      },
    });
    expect(() => extractDpapiWrappedKey(noPrefix)).toThrow(DpapiAccessError);
  });
});

describe("unwrapDpapiKey", () => {
  it("calls unprotectData with NULL entropy and CurrentUser scope, returning a 32-byte DEK", () => {
    const wrapped = crypto.randomBytes(80);
    const dek = crypto.randomBytes(32);
    const unprotect = mockDpapi(() => dek);

    const result = unwrapDpapiKey(wrapped);

    expect(result.equals(dek)).toBe(true);
    expect(unprotect).toHaveBeenCalledTimes(1);
    const [data, entropy, scope] = unprotect.mock.calls[0];
    expect(Buffer.from(data).equals(wrapped)).toBe(true);
    expect(entropy).toBeNull();
    expect(scope).toBe("CurrentUser");
  });

  it("throws DpapiAccessError when unprotectData throws (different user/profile)", () => {
    mockDpapi(
      jest.fn(() => {
        throw new Error("CRYPT_E_DECRYPT_FAILED");
      })
    );

    expect(() => unwrapDpapiKey(crypto.randomBytes(80))).toThrow(
      DpapiAccessError
    );
  });

  it("throws DpapiAccessError when the unwrapped key is the wrong length", () => {
    mockDpapi(() => Buffer.alloc(16));

    expect(() => unwrapDpapiKey(crypto.randomBytes(80))).toThrow(
      DpapiAccessError
    );
  });

  it("throws DpapiAccessError when the loader itself throws", () => {
    mockLoadDpapi.mockImplementation(() => {
      throw new Error("no bundled binary for win32-ia32");
    });

    expect(() => unwrapDpapiKey(crypto.randomBytes(80))).toThrow(
      DpapiAccessError
    );
  });
});

describe("loadEncryptedCredentials (keychain mode)", () => {
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

    const result = await loadEncryptedCredentials({
      mode: "keychain",
      encPath: "/granola/stored-accounts.json.enc",
      dekPath: "/granola/storage.dek",
    });

    expect(result).toBe(plaintext);
  });

  it("propagates ENOENT from a missing storage.dek", async () => {
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    (fs.promises.readFile as jest.Mock).mockRejectedValue(enoent);

    await expect(
      loadEncryptedCredentials({
        mode: "keychain",
        encPath: "/x.enc",
        dekPath: "/y.dek",
      })
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
      loadEncryptedCredentials({
        mode: "keychain",
        encPath: "/x.enc",
        dekPath: "/y.dek",
      })
    ).rejects.toBeInstanceOf(KeychainAccessError);
  });
});

describe("loadEncryptedCredentials (dpapi mode)", () => {
  const ENC_PATH = "/granola/stored-accounts.json.enc";
  const DEK_PATH = "/granola/storage.dek";
  const LOCAL_STATE_PATH = "/granola/Local State";

  function setupTwoStageChain(plaintext: string): {
    wrappedKey: Buffer;
    safeStorageKey: Buffer;
    dek: Buffer;
    dekBlob: Buffer;
    encBlob: Buffer;
    localState: string;
  } {
    const safeStorageKey = crypto.randomBytes(32);
    const dek = crypto.randomBytes(32);
    const wrappedKey = crypto.randomBytes(80);
    const localState = makeLocalStateJson(wrappedKey);
    const dekBlob = encryptDpapiDek(safeStorageKey, dek);
    const encBlob = encryptPayload(dek, Buffer.from(plaintext, "utf8"));

    (fs.promises.readFile as jest.Mock).mockImplementation(
      (p: string, encoding?: string) => {
        if (p === LOCAL_STATE_PATH) {
          expect(encoding).toBe("utf-8");
          return Promise.resolve(localState);
        }
        if (p === DEK_PATH) return Promise.resolve(dekBlob);
        if (p === ENC_PATH) return Promise.resolve(encBlob);
        return Promise.reject(new Error(`unexpected path: ${p}`));
      }
    );
    mockDpapi((data) => {
      expect(Buffer.from(data).equals(wrappedKey)).toBe(true);
      return safeStorageKey;
    });

    return {
      wrappedKey,
      safeStorageKey,
      dek,
      dekBlob,
      encBlob,
      localState,
    };
  }

  it("runs the full two-stage chain: DPAPI → safeStorage key → storage.dek → DEK → payload", async () => {
    const plaintext = JSON.stringify({ accounts: "stringified-accounts" });
    setupTwoStageChain(plaintext);

    const result = await loadEncryptedCredentials({
      mode: "dpapi",
      encPath: ENC_PATH,
      dekPath: DEK_PATH,
      localStatePath: LOCAL_STATE_PATH,
    });

    expect(result).toBe(plaintext);
  });

  it("calls DPAPI exactly once with the wrapped key, NULL entropy, CurrentUser scope", async () => {
    const plaintext = JSON.stringify({ accounts: "stringified" });
    const safeStorageKey = crypto.randomBytes(32);
    const dek = crypto.randomBytes(32);
    const wrappedKey = crypto.randomBytes(80);
    const dekBlob = encryptDpapiDek(safeStorageKey, dek);
    const encBlob = encryptPayload(dek, Buffer.from(plaintext, "utf8"));

    (fs.promises.readFile as jest.Mock).mockImplementation((p: string) => {
      if (p === LOCAL_STATE_PATH)
        return Promise.resolve(makeLocalStateJson(wrappedKey));
      if (p === DEK_PATH) return Promise.resolve(dekBlob);
      return Promise.resolve(encBlob);
    });
    const unprotect = mockDpapi(() => safeStorageKey);

    await loadEncryptedCredentials({
      mode: "dpapi",
      encPath: ENC_PATH,
      dekPath: DEK_PATH,
      localStatePath: LOCAL_STATE_PATH,
    });

    expect(unprotect).toHaveBeenCalledTimes(1);
    const [data, entropy, scope] = unprotect.mock.calls[0];
    expect(Buffer.from(data).equals(wrappedKey)).toBe(true);
    expect(entropy).toBeNull();
    expect(scope).toBe("CurrentUser");
  });

  it("propagates ENOENT when any of the three files are missing", async () => {
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    (fs.promises.readFile as jest.Mock).mockRejectedValue(enoent);

    await expect(
      loadEncryptedCredentials({
        mode: "dpapi",
        encPath: ENC_PATH,
        dekPath: DEK_PATH,
        localStatePath: LOCAL_STATE_PATH,
      })
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("propagates DpapiAccessError when the unprotect call fails", async () => {
    const wrappedKey = crypto.randomBytes(80);
    (fs.promises.readFile as jest.Mock).mockImplementation((p: string) => {
      if (p === LOCAL_STATE_PATH)
        return Promise.resolve(makeLocalStateJson(wrappedKey));
      return Promise.resolve(Buffer.alloc(80));
    });
    mockDpapi(
      jest.fn(() => {
        throw new Error("CRYPT_E_DECRYPT_FAILED");
      })
    );

    await expect(
      loadEncryptedCredentials({
        mode: "dpapi",
        encPath: ENC_PATH,
        dekPath: DEK_PATH,
        localStatePath: LOCAL_STATE_PATH,
      })
    ).rejects.toBeInstanceOf(DpapiAccessError);
  });

  it("propagates DpapiAccessError when Local State is missing os_crypt.encrypted_key", async () => {
    (fs.promises.readFile as jest.Mock).mockImplementation((p: string) => {
      if (p === LOCAL_STATE_PATH) return Promise.resolve(JSON.stringify({}));
      return Promise.resolve(Buffer.alloc(80));
    });

    await expect(
      loadEncryptedCredentials({
        mode: "dpapi",
        encPath: ENC_PATH,
        dekPath: DEK_PATH,
        localStatePath: LOCAL_STATE_PATH,
      })
    ).rejects.toBeInstanceOf(DpapiAccessError);
  });

});
