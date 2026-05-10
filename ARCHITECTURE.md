# Architecture

A single-page web app talking to a stateless Socket.IO relay. The relay never holds a private key and never sees plaintext.

```
                                                ┌──────────────────┐
                                                │  Alice's wallet  │
                                                │  (browser-only)  │
                                                │                  │
                                                │  pubA   secA     │
                                                │  ●●●●…  ●●●●…    │
                                                │                  │
                                                │  contacts: pubB  │
                                                │  threads: …      │
                                                └────────┬─────────┘
                                                         │ WebSocket
                                                         │ (TLS in prod)
                                                         ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │                          Relay (server.js)                         │
   │                                                                    │
   │  Express          ──▶  /, /healthz, static frontend, /vendor/nacl  │
   │  Socket.IO        ──▶  register, message, typing, presence:check   │
   │                                                                    │
   │  In-memory state                                                   │
   │  ──────────────                                                    │
   │  onlineByPubKey : Map<pubKey, Set<socketId>>                       │
   │  offlineQueue   : Map<pubKey, [{from, nonce, ciphertext, ts}]>     │
   │                                                                    │
   │  Validation                                                        │
   │  ──────────                                                        │
   │  PUBKEY_RE   = /^[A-Za-z0-9+/]{43}=$/        (32 bytes)            │
   │  NONCE_RE    = /^[A-Za-z0-9+/]{32}={0,2}$/   (24 bytes)            │
   │  ciphertext  ≤ 64 KiB, base64                                      │
   │  buffer      ≤ 128 KiB                                             │
   │                                                                    │
   │  No persistent storage. No logs of routing metadata.               │
   └────────────────────────────────────────────────────────────────────┘
                                                         ▲
                                                         │ WebSocket
                                                         │
                                                ┌────────┴─────────┐
                                                │   Bob's wallet   │
                                                │   pubB  secB     │
                                                └──────────────────┘
```

## Layers

### 1. Wallet (`public/crypto-utils.js`)

A wallet is an X25519 keypair created with `nacl.box.keyPair()` and stored as base64 in `localStorage`. The module is loaded into the browser as a plain script (no bundler) and also runs in the test suite via a small Node `vm` shim. Public-key validation is regex-first (length-cap before any base64 decode) so malformed input fails fast and consistently across both environments.

`encryptMessage(text, recipientPubKey, senderSecretKey)` returns `{ nonce, ciphertext }` — both base64. Plaintext is wrapped in a tiny JSON envelope `{v, t, ts}` so we can evolve the protocol later (`v` is the version field).

`decryptMessage(...)` returns `{ text, ts }` on success and `null` on every failure mode (forged sender, wrong recipient key, tampered nonce or ciphertext, or version mismatch). Callers cannot distinguish the failure modes — this is deliberate; surfacing more detail would help an attacker probe.

### 2. App shell (`public/app.js`)

Stateful UI built with vanilla DOM APIs. State partitions:

- **Wallet** (`sc:wallet:v1`) — the keypair plus an optional display name.
- **Contacts** (`sc:contacts:v1`) — array of `{pubKey, name, online, unread}`.
- **Threads** (`sc:threads:v1`) — `pubKey → [{id, dir, text, ts, status}]`.

The composer encrypts on the client, emits `message` over the socket with an ack callback, and updates the bubble's `status` from `sending` to `delivered` / `queued` / `failed` based on the ack. Incoming envelopes go through `decryptMessage`; on failure, the recipient sees an inline ⚠ error bubble — the message itself is not surfaced.

### 3. Relay (`server.js`)

Express serves the static SPA and the pinned NaCl libraries from `node_modules`. Socket.IO carries the messaging events. Three maps live in memory and nowhere else:

- `onlineByPubKey` — pubkey → set of live socket IDs.
- `offlineQueue` — pubkey → bounded FIFO of pending envelopes (cap 200).
- (None for messages — they are forwarded immediately if the recipient is connected, otherwise queued.)

Every event is validated before it touches state. The `from` field on outgoing envelopes is **always** stamped from the socket's registered identity; clients cannot forge sender identity. See `tests/auth.test.js` `AUTH-02` for the regression case.

### 4. Tests (`tests/`)

Three suites run under Node's built-in test runner:

- `crypto.test.js` — loads `public/crypto-utils.js` into a `vm` sandbox with `nacl` / `nacl-util` bound as globals, asserts roundtrip, MAC rejection, nonce uniqueness, validation, and avatar/fingerprint determinism.
- `server.test.js` — boots `server.js` on an ephemeral port, opens two `socket.io-client` connections, and asserts E2E delivery, validation rejection, presence broadcasts, and offline queue drain.
- `auth.test.js` — six AUTH-* cases that prove the policy in `.repobility/access.yml`: no anonymous publish, server-stamped sender identity, recipient-routing isolation, presence ownership transfer on re-register, and rejection of invalid registrations.

## Wire protocol summary

| Direction       | Event              | Payload (base64 except `typing`)                                |
| --------------- | ------------------ | --------------------------------------------------------------- |
| client → server | `register`         | `{ pubKey }`                                                    |
| client → server | `presence:check`   | `{ pubKey }`                                                    |
| client → server | `message`          | `{ to, nonce, ciphertext }`                                     |
| client → server | `typing`           | `{ to, typing: bool }`                                          |
| server → client | `message`          | `{ from, to, nonce, ciphertext, ts }` (server stamps `from`)    |
| server → client | `presence`         | `{ pubKey, online: bool }`                                      |
| server → client | `typing`           | `{ from, typing: bool }`                                        |

See [README.md](README.md#wire-protocol) for ack shapes and validation rules.

## Threat model summary

See [SECURITY.md](SECURITY.md) for the full breakdown. Headline:

| Adversary                          | Defended? |
| ---------------------------------- | --------- |
| Honest-but-curious relay operator  | ✅ confidentiality and integrity |
| Passive network observer           | ✅ via TLS |
| Active MITM                        | ✅ with TLS pinning + OOB fingerprint check |
| Compromised peer                   | ❌ out of scope by definition |
| Retroactive key compromise         | ❌ no forward secrecy (intentional simplicity trade-off) |
| Malicious browser extension / XSS  | ⚠️ best-effort via strict CSP |
| Compromised server delivering JS   | ⚠️ trust-the-server-once problem of any web E2E messenger |

## Operational notes

- Single-process by design. Multi-replica deployments need sticky sessions and the Socket.IO Redis adapter; the in-memory queue/presence maps don't survive restart.
- `HOST` and `PORT` are the only environment variables.
- Container deployments should put the relay behind a TLS-terminating reverse proxy. The CSP is written for HTTPS deployments (`connect-src ws: wss:`).
