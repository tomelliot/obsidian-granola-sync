# How the plugin loads your Granola credentials

To sync with Granola, the plugin needs the same access token the Granola desktop app uses. Granola stores that token encrypted on disk and keeps the decryption key in your operating system's keychain. This document walks through the chain the plugin follows.

Everything described here runs locally inside the Obsidian process. No part of the credentials, the decryption key, or the intermediate files ever leaves your machine. Only the final access token is sent to Granola's API — to the same endpoints the Granola app itself talks to.

The source of truth for the implementation is [`src/services/granolaCredentialsCrypto.ts`](../src/services/granolaCredentialsCrypto.ts) and [`src/services/credentials.ts`](../src/services/credentials.ts). The code is authoritative; this page is a high-level map.

## The files involved

Granola writes two files into its per-user data directory:

| File | What it contains |
| --- | --- |
| `stored-accounts.json.enc` | Your account state (including the access and refresh tokens), encrypted. |
| `storage.dek` | The wrapped data-encryption key needed to decrypt the file above. |

On macOS those live under `~/Library/Application Support/Granola`. On Linux it is `~/.config/Granola`, and on Windows `%APPDATA%/Granola`.

The third piece — the one the plugin has to ask the OS for — is a password kept in the keychain under the service name `Granola Safe Storage`. That password is what Granola itself wrote there during install.

## The decoding chain

1. **Ask the OS keychain** for the `Granola Safe Storage` password. The first time the plugin does this, the OS prompts you (`Always Allow` on macOS, the libsecret prompt on Linux, the Credential Manager prompt on Windows). The plugin can't bypass this; if you deny it, sync fails and the plugin tells you what happened.
2. **Unwrap the data-encryption key.** `storage.dek` is wrapped with a key derived from that password. The plugin runs the derivation, decrypts the blob, and gets the raw 32-byte DEK.
3. **Decrypt `stored-accounts.json.enc`** with the DEK. The result is the same JSON shape Granola used to write to disk in cleartext: a list of accounts, each carrying a `tokens` object.
4. **Pick the first account** and parse its `tokens`. That object holds the access token, refresh token, expiry, and a few other fields the plugin needs.
5. **Refresh if needed.** If the access token is expired or about to expire, the plugin uses the refresh token to mint a new one via Granola's API. That refreshed token is held in memory for the rest of the sync — the plugin does not write it back to disk.

The plugin never persists the keychain password, the DEK, or the decrypted JSON anywhere. They live in memory for as long as one sync takes and are then garbage-collected.

## What can go wrong

- **You deny the keychain prompt.** You'll see a modal explaining why access is needed, with a link back here. Re-run the sync and approve when prompted.
- **Granola isn't installed, or you haven't logged into it.** The encrypted file or the keychain entry won't exist; the plugin reports which one is missing.
- **The file format changed.** A future Granola update could change the encryption scheme or the JSON shape. The plugin will fail with a clear "could not decrypt" or "missing field" error and you can file an issue.

For the exact algorithms, IV lengths, and key derivation parameters, read the source files linked above.
