# How the plugin loads your Granola credentials

To sync with Granola, the plugin needs the same access token the Granola desktop app uses. Granola stores that token encrypted on disk; the way the wrapping key is held differs between macOS/Linux and Windows. This document walks through both chains.

Everything described here runs locally inside the Obsidian process. No part of the credentials, the wrapping key, or the intermediate files ever leaves your machine. Only the final access token is sent to Granola's API — to the same endpoints the Granola app itself talks to.

The source of truth for the implementation is [`src/services/granolaCredentialsCrypto.ts`](../src/services/granolaCredentialsCrypto.ts) and [`src/services/credentials.ts`](../src/services/credentials.ts). The code is authoritative; this page is a high-level map.

> **Breaking change — macOS, Granola ≥ 7.427.0.** Granola deleted the `storage.dek` file and moved the data-encryption key into an iCloud (data-protection) keychain item, `com.granola.app.dek`, that only the Granola app can read. The macOS chain described below unwraps `storage.dek`, so it no longer works on that version. The `.enc` file formats are unchanged — only the key's location moved. See the [change log](#change-log--granolas-on-disk-credential-storage) for detail.

## Where Granola keeps the tokens

Granola writes your account state — including the WorkOS access and refresh tokens — to two encrypted files. Both decrypt with the same `storage.dek` and carry the same token payload:

| File | Shape | Role |
| --- | --- | --- |
| `supabase.json.enc` | `workos_tokens` as a top-level JSON-encoded string, alongside `session_id` and `user_info`. | Granola's primary store. The desktop app opens this first at launch. |
| `stored-accounts.json.enc` | An `accounts` array (a JSON-encoded string); the first account carries a `tokens` object. | Secondary copy, kept in sync. The file this plugin reads. |

The plugin reads `stored-accounts.json.enc`. If a future Granola release stops maintaining it, the same tokens remain in `supabase.json.enc` in the shape above — the DEK and decrypt step are identical; only the JSON parsing differs. (On Granola ≥ 7.427.0 the DEK itself is no longer reachable from disk; see the breaking-change note above.)

Other files in the same directory (`user-preferences.json.enc`, `cache-v6.json.enc`, `window-state.json.enc`) are encrypted with the same DEK but hold UI preferences and cached app data. They carry no tokens.

## macOS and Linux: the keychain chain

This is the chain the plugin implements today. It holds on Linux and on macOS up to Granola 7.394.x; on macOS 7.427.0 and later, step 2 fails because `storage.dek` no longer exists (see the breaking-change note near the top).

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

Granola on Windows does not use Windows Credential Manager. Instead, the encryption follows the standard Chromium/Electron OSCrypt design: a random AES-256 "safeStorage" key is stored in Granola's Electron `Local State` file, itself wrapped with the [Windows Data Protection API (DPAPI)](https://learn.microsoft.com/en-us/windows/win32/seccrypto/cryptoapi-system-architecture). DPAPI is per-Windows-user and silent — no prompt is shown when reading the key, but only the same user account that wrote it can read it back.

Granola's per-user files on Windows live under `%APPDATA%\Granola` (i.e. `C:\Users\<you>\AppData\Roaming\Granola`):

| File | What it contains |
| --- | --- |
| `Local State` | Electron metadata JSON, containing `os_crypt.encrypted_key` — the DPAPI-wrapped safeStorage key. |
| `storage.dek` | The data-encryption key (DEK), wrapped with the safeStorage key (Chromium `v10` AES-256-GCM envelope). |
| `stored-accounts.json.enc` | Your account state, encrypted with the DEK. |

### The decoding chain

1. **Read `Local State`** and pull out `os_crypt.encrypted_key`. The value is base64; once decoded it starts with the literal 5-byte ASCII prefix `DPAPI` followed by the actual DPAPI ciphertext.
2. **Call `CryptUnprotectData`** with `NULL` entropy under the `CurrentUser` scope — the same options Chromium/Electron's `safeStorage` uses on Windows. This returns the 32-byte safeStorage AES key. No prompt is shown.
3. **Decrypt `storage.dek`** with the safeStorage key. The blob is `v10` (3 ASCII bytes) + AES-256-GCM (12-byte IV + ciphertext + 16-byte tag). The plaintext is the base64-encoded DEK; base64-decode it to recover the raw 32-byte DEK.
4. **Decrypt `stored-accounts.json.enc`** with the DEK. The on-disk layout is bare AES-256-GCM (12-byte IV + ciphertext + 16-byte tag) — the same Granola uses on the other platforms.
5. **Pick the first account, refresh if needed** — identical to step 4 onward of the keychain chain above.

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

## Change log — Granola's on-disk credential storage

Concise notes on how Granola's credential storage has changed and where the plugin stands against it. Newest first.

### 2026-07-16 — Granola 7.427.0 (macOS) — breaking

- **`storage.dek` deleted; the DEK moved into the keychain.** Granola removed the on-disk `storage.dek` file and now holds the 32-byte data-encryption key in an **iCloud (data-protection) keychain** item named `com.granola.app.dek` (a synchronizable generic / "application password").
- **The plugin's macOS decryption breaks on this version.** Its chain unwraps `storage.dek`, which no longer exists. The DEK now lives in a keychain domain gated by Granola's keychain access group: a process without Granola's entitlement gets `errSecItemNotFound` and can enumerate zero items there. Obsidian runs under a different team ID, so the plugin cannot read it — and this is access-group gating, not an "Always Allow" prompt the user can approve. Verified with an `fs_usage` capture (`storage.dek` gone) and a Swift `SecItemCopyMatching` probe against the data-protection keychain.
- **The old `Granola Safe Storage` login-keychain item still exists but is now vestigial** — it holds a 16-byte OSCrypt value that does not decrypt the `.enc` files.
- **`.enc` formats unchanged.** `stored-accounts.json.enc` and `supabase.json.enc` are still bare AES-256-GCM with the same JSON shapes; only the key source moved out of reach.
- **Open questions:** whether `storage.dek` deletion is universal or per-machine; whether the Windows (DPAPI) and Linux paths changed too; whether Granola's companion CLI is the sanctioned external credential path going forward.

### 2026-07-16 — Granola 7.394.x

- **Two token stores now exist** under the single `storage.dek`: `supabase.json.enc` (primary) and `stored-accounts.json.enc` (secondary). Confirmed with `fs_usage` at app launch — Granola opens `storage.dek`, then `supabase.json.enc`, then `stored-accounts.json.enc`, all read-only. Reproduce with [`scripts/watch-granola-fs.sh`](../scripts/watch-granola-fs.sh).
- **`supabase.json.enc` is the flatter, canonical shape** — `workos_tokens` as a top-level JSON-encoded string, no `accounts[]` wrapper. Same token payload as `stored-accounts.json.enc`.
- **The plaintext `stored-accounts.json` is gone** on macOS; recent Granola writes only the `.enc` form. The plugin's plaintext fallback is now effectively dead on macOS.
- **Encryption spread to more state files** — `user-preferences.json.enc`, `cache-v6.json.enc`, and `window-state.json.enc` replaced their plaintext predecessors, all under the same DEK. None carry tokens (`cache-v6.json.enc` does hold third-party integration keys such as Affinity and Zapier).
- **Plugin status:** reads `stored-accounts.json.enc` and works. Reading `supabase.json.enc` first, with `stored-accounts.json.enc` as fallback, is the more future-proof order and is a tracked consideration.
