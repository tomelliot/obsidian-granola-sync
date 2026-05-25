# How the plugin loads your Granola credentials

To sync with Granola, the plugin needs the same access token the Granola desktop app uses. Granola stores that token encrypted on disk; the way the wrapping key is held differs between macOS/Linux and Windows. This document walks through both chains.

Everything described here runs locally inside the Obsidian process. No part of the credentials, the wrapping key, or the intermediate files ever leaves your machine. Only the final access token is sent to Granola's API — to the same endpoints the Granola app itself talks to.

The source of truth for the implementation is [`src/services/granolaCredentialsCrypto.ts`](../src/services/granolaCredentialsCrypto.ts) and [`src/services/credentials.ts`](../src/services/credentials.ts). The code is authoritative; this page is a high-level map.

## macOS and Linux: the keychain chain

Granola writes two files into its per-user data directory:

| File | What it contains |
| --- | --- |
| `stored-accounts.json.enc` | Your account state (including the access and refresh tokens), encrypted. |
| `storage.dek` | The wrapped data-encryption key needed to decrypt the file above. |

On macOS those live under `~/Library/Application Support/Granola`. On Linux it is `~/.config/Granola`.

The third piece — the one the plugin has to ask the OS for — is a password kept in the keychain under the service name `Granola Safe Storage`. That password is what Granola itself wrote there during install.

### The decoding chain

1. **Ask the OS keychain** for the `Granola Safe Storage` password. The first time the plugin does this, the OS prompts you (`Always Allow` on macOS, the libsecret prompt on Linux). The plugin can't bypass this; if you deny it, sync fails and the plugin tells you what happened.
2. **Unwrap the data-encryption key.** `storage.dek` is wrapped with a key derived from that password. The plugin runs the derivation, decrypts the blob, and gets the raw 32-byte DEK.
3. **Decrypt `stored-accounts.json.enc`** with the DEK. The result is the same JSON shape Granola used to write to disk in cleartext: a list of accounts, each carrying a `tokens` object.
4. **Pick the first account** and parse its `tokens`. That object holds the access token, refresh token, expiry, and a few other fields the plugin needs.
5. **Refresh if needed.** If the access token is expired or about to expire, the plugin uses the refresh token to mint a new one via Granola's API. That refreshed token is held in memory for the rest of the sync — the plugin does not write it back to disk.

## Windows: the DPAPI chain

Granola on Windows does not use Windows Credential Manager. Instead, the encryption follows the standard Chromium/Electron OSCrypt design: a random AES-256 key is stored in Granola's Electron `Local State` file, itself wrapped with the [Windows Data Protection API (DPAPI)](https://learn.microsoft.com/en-us/windows/win32/seccrypto/cryptoapi-system-architecture). DPAPI is per-Windows-user and silent — no prompt is shown when reading the key, but only the same user account that wrote it can read it back.

Granola's per-user files on Windows live under `%APPDATA%\Granola` (i.e. `C:\Users\<you>\AppData\Roaming\Granola`):

| File | What it contains |
| --- | --- |
| `stored-accounts.json.enc` | Your account state, encrypted with the OSCrypt AES key. |
| `Local State` | Electron metadata JSON, containing `os_crypt.encrypted_key` — the DPAPI-wrapped AES key. |

### The decoding chain

1. **Read `Local State`** and pull out `os_crypt.encrypted_key`. The value is base64; once decoded it starts with the literal 5-byte ASCII prefix `DPAPI` followed by the actual DPAPI ciphertext.
2. **Call `CryptUnprotectData`** with `NULL` entropy under the `CurrentUser` scope — the same options Chromium/Electron's `safeStorage` uses on Windows. This returns the 32-byte AES key. No prompt is shown.
3. **Decrypt `stored-accounts.json.enc`** with that AES key. The on-disk layout is the same AES-256-GCM (12-byte IV + ciphertext + 16-byte authentication tag) Granola uses on the other platforms.
4. **Pick the first account, refresh if needed** — identical to step 4 onward of the keychain chain above.

The plugin uses [`@primno/dpapi`](https://www.npmjs.com/package/@primno/dpapi)'s prebuilt N-API binding for the `CryptUnprotectData` call; the Windows native binary is bundled into `main.js` alongside the platform keyring binaries and extracted to the plugin directory on first use.

### What can go wrong on Windows

- **Granola isn't installed or you've never signed in.** `Local State` or `stored-accounts.json.enc` won't exist; the plugin reports which file is missing.
- **You're signed into a different Windows user than the one that installed Granola.** DPAPI under the `CurrentUser` scope is per-user — `CryptUnprotectData` will fail. The plugin surfaces a "Could not unwrap Granola's encryption key via Windows DPAPI" notice.
- **Your Windows profile was migrated or restored from a backup.** DPAPI keys are tied to the user's master key, which is derived from the account password. A profile restored to a different machine or rebuilt user account cannot unwrap the old blob; you'll need to sign back into Granola so it can rewrite `Local State` under the current user.

## Shared properties

- The plugin never persists the keychain password, the DPAPI-unwrapped key, the DEK, or the decrypted JSON anywhere. They live in memory for as long as one sync takes and are then garbage-collected.
- The bundled native bindings (`@napi-rs/keyring` for macOS/Linux, `@primno/dpapi` for Windows) are open-source N-API addons; only the precompiled binary for your current platform is loaded at runtime.

## What can go wrong on macOS / Linux

- **You deny the keychain prompt.** You'll see a modal explaining why access is needed, with a link back here. Re-run the sync and approve when prompted.
- **Granola isn't installed, or you haven't logged into it.** The encrypted file or the keychain entry won't exist; the plugin reports which one is missing.
- **The file format changed.** A future Granola update could change the encryption scheme or the JSON shape. The plugin will fail with a clear "could not decrypt" or "missing field" error and you can file an issue.

For the exact algorithms, IV lengths, and key derivation parameters, read the source files linked above.
