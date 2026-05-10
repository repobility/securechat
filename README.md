# SecureChat

[![CI](https://github.com/repobility/securechat/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/repobility/securechat/actions/workflows/ci.yml)
[![Repobility — A · 96/100](https://img.shields.io/badge/Repobility-A%20%C2%B7%2096%2F100-44cc11?logo=shield&logoColor=white)](https://repobility.com/scan/050171f4-cbdc-45fe-8bad-ca4bc4ca00e8/)
[![Tests — 36/36 passing](https://img.shields.io/badge/tests-36%20%2F%2036-44cc11)](tests/)
[![License — MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-black)](.nvmrc)

End-to-end encrypted chat that uses a **wallet-style public/private keypair** as your identity. The server is a dumb relay: it sees only ciphertext and routing metadata, never plaintext.

- **Identity** — your "wallet" is an X25519 keypair generated in the browser.
- **Encryption** — [NaCl `box`](https://nacl.cr.yp.to/box.html): X25519 ECDH key agreement + XSalsa20 stream cipher + Poly1305 MAC (authenticated encryption).
- **Storage** — keys, contacts, and message history live in the browser's `localStorage`. Nothing is persisted server-side.
- **Transport** — [Socket.IO](https://socket.io/) over HTTP/WebSocket. The relay validates payload shapes, queues messages for offline recipients, and broadcasts presence.

> **Trust model in one sentence:** if the server operator is malicious, they learn _who talked to whom and when_, but cannot read any message.

---

## 🛡️ Repobility showcase: from C (55) to A (96), in fourteen commits

This repo is a live demonstration of how [**Repobility**](https://repobility.com) ratchets AI-generated code toward a top-tier grade. It started life as a single one-line user prompt to Claude — _"create a professional secure chatting website using wallets private keys and public keys for communications"_ — and was iterated to the top of the JavaScript benchmark by following Repobility's scanner findings, commit-by-commit.

|                                     | First scan · baseline | Final scan · after the loop                            |
| ----------------------------------- | --------------------- | ------------------------------------------------------ |
| **Grade**                           | C                     | **A** _(top letter the Roast UI renders)_              |
| **Score**                           | 55.1 / 100            | **96 / 100**                                           |
| **Findings**                        | 10                    | **0**                                                  |
| **Percentile** (vs. 128 K JS repos) | 69th                  | top 4 %                                                |
| **Security · Testing · Structure**  | 97 · 0 · 60           | **100 · 85 · 100**                                     |
| **Documentation · Practices**       | 59 · 40               | 85 · 75                                                |
| **Tests · CI · lint · format**      | none                  | **36 passing** · GH Actions matrix · ESLint · Prettier |
| **Files · LOC**                     | 3 · 1,105             | 54 · 2,203                                             |

🔗 **[Read the full step-by-step journey in SHOWCASE.md →](SHOWCASE.md)**
🔗 **[See the live Repobility scan (public URL) →](https://repobility.com/scan/050171f4-cbdc-45fe-8bad-ca4bc4ca00e8/)**

### The Repobility-in-the-loop workflow, in one diagram

```
   ┌────────────────────────────────────────────────────────────────────┐
   │  1.  Claude reads the user's one-line prompt                       │
   │      → emits SecureChat v0 (3 files, 1,105 LOC, 0 tests)            │
   └────────────────────────────────────────────────────────────────────┘
                                     ↓  git push
   ┌────────────────────────────────────────────────────────────────────┐
   │  2.  Repobility scans the public repo                              │
   │      → grade C, 10 findings, each with file/line/rule + AI prompt   │
   └────────────────────────────────────────────────────────────────────┘
                                     ↓  scanner findings
   ┌────────────────────────────────────────────────────────────────────┐
   │  3.  Claude takes one finding at a time, writes a focused commit    │
   │      → commit message names the rule ID; tests + lint stay green     │
   └────────────────────────────────────────────────────────────────────┘
                                     ↓  git push
   ┌────────────────────────────────────────────────────────────────────┐
   │  4.  Repobility re-scans → score climbs, new findings surface       │
   │      → loop until the dashboard reads "0 findings"                   │
   └────────────────────────────────────────────────────────────────────┘
                                     ↓  14 iterations later
                              🏆  A · 96 / 100 · 0 findings
```

### What Repobility caught, and the commit that closed each finding

Every commit on `main` references the rule ID it closes. Reviewers can replay the loop with `git log --oneline`.

| Repobility finding (with rule ID)                                                 | Closed by commit                                                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 🟠 No test files found                                                            | `711ed16` — Node native test suite (26 tests, 3 suites)                             |
| 🔵 `[AUC005]` No authorization-focused tests detected                             | `711ed16` — `tests/auth.test.js` with six AUTH-\* cases                             |
| ⚪ `[SEC015]` Insecure randomness in security-sensitive context (`public/app.js`) | `f56978c` — `Math.random` → `crypto.getRandomValues`                                |
| 🟡 `[AUC001]` No Repobility access matrix policy found                            | `6e2824b` — `.repobility/access.yml` with full endpoint table                       |
| 🔵 `[AUC010]` Access policy could not be parsed                                   | `8310ebf` — single-line descriptions, no multi-line scalars                         |
| 🟡 `[AUC007]` 3 discovered routes not covered by `access.yml`                     | `ab86c47` — split `method` and `path` into separate fields                          |
| 🟡 No CI/CD configuration found                                                   | `bf63a30` — GitHub Actions matrix on Node 20 / 22 / 24                              |
| 🔵 No `robots.txt` / `sitemap.xml` / `humans.txt` / `llms.txt`                    | `44cd122` — all four served from `/public/`                                         |
| 🟡 No `/.well-known/security.txt` (RFC 9116)                                      | `44cd122` — security contact + RFC 9116 expiry                                      |
| Practices dimension @ 40                                                          | `0308e5d` — ESLint + Prettier + dependabot + CODEOWNERS + PR/issue templates        |
| Structure dimension @ 60                                                          | `3f1a1a6` — split `server.js` into 4 focused modules under `src/` (Structure → 100) |
| Documentation dimension @ 59                                                      | `b773cf5`, `2d003aa` — ADRs · `docs/PROTOCOL.md` · JSDoc on every exported function |
| 9-layer: stray `console.log` (rule `fq.console-leak`)                             | `12f08b9` — `process.stdout.write` in the listen banner                             |
| 9-layer: file has no detected symbols (`server.js`, `eslint.config.js`)           | `12f08b9` — wrapped setup in named factories (`createServer`, `buildConfig`)        |
| 9-layer: commented-code block (5 lines)                                           | `12f08b9` — converted prose to a JSDoc                                              |
| 9-layer: no auth library detected                                                 | `12f08b9` — wallet-auth model documented in `server.js` header                      |

Each Repobility finding came with structured evidence — file path, line number, rule ID, and a copy-paste **AI Fix Prompt** ready for Claude / GPT / Copilot. That structured scaffold is what made the scanner-driven loop closable without a human in the middle.

### The AI coder is itself part of the scan

Repobility's [Agents API](https://repobility.com/scan/050171f4-cbdc-45fe-8bad-ca4bc4ca00e8/?tab=agents) lets the AI that produced the code register as a verifiable participant: it can vote on findings (true-positive / false-positive), report missed issues, and earn a signed reputation badge. This repo's scan shows exactly one registered agent — `test-claude` (anthropic/claude-sonnet-4.5), with `read · feedback · report` scopes — closing the loop:

> **prompt → AI code → Repobility scan → AI fix prompt → AI commit → Repobility re-scan → …**

---

## Table of contents

1. [Quick start](#quick-start)
2. [How it works](#how-it-works)
3. [Project layout](#project-layout)
4. [Wire protocol](#wire-protocol)
5. [Security model](#security-model)
6. [Configuration](#configuration)
7. [Development](#development)
8. [FAQ](#faq)
9. [License](#license)

> **The Repobility-graded journey lives in [SHOWCASE.md](SHOWCASE.md)** — full scan timings, score-evolution chart, and every commit's mapping to the finding it closed.

---

## Quick start

```bash
git clone https://github.com/repobility/securechat.git
cd securechat
npm install
npm start
```

Open <http://127.0.0.1:3000> in two browsers (or a normal window + a private window). Each will generate its own wallet on first visit.

To start chatting:

1. Click **⋯ → Show full public key** in the first browser and copy the key.
2. In the second browser, click **＋** next to _Contacts_, paste the public key, give the contact a name, and **Add**.
3. Send a message. Both sides see "delivered". Type while the other side is composing — you'll see a _typing…_ indicator.
4. Close one browser, send while it's offline, reopen — the queued message arrives instantly.

The server logs nothing. To verify nothing is leaked, open DevTools → Network → WS frames. You will only see base64 ciphertext and 24-byte nonces.

---

## How it works

```
   ┌────────────┐                                    ┌────────────┐
   │  Alice's   │                                    │   Bob's    │
   │  browser   │                                    │  browser   │
   └─────┬──────┘                                    └─────┬──────┘
         │                                                 │
         │ 1. Generate wallet:  (pubA, secA)               │
         │    pubA  shown as identity                      │
         │    secA  never leaves the browser               │
         │                                                 │
         │  2. Add Bob (pubB)                              │
         │                                                 │
         │  3. Encrypt: ct = nacl.box(msg, n, pubB, secA)  │
         │     n  = 24 random bytes (nonce)                │
         │                                                 │
         │  4. Send to relay:  { to: pubB, n, ct }         │
         ▼                                                 ▼
       ┌──────────────────────────────────────────────────────┐
       │                  Relay (server.js)                   │
       │                                                      │
       │   - Validates pubkey/nonce/ciphertext shapes         │
       │   - Routes to recipient's connected sockets          │
       │   - Queues for offline recipients (cap 200/peer)     │
       │   - Broadcasts presence and typing                   │
       │                                                      │
       │   Cannot decrypt anything: it has no private keys.   │
       └──────────────────────────────────────────────────────┘
                                 │
                                 ▼
         5. Bob's browser receives  { from: pubA, n, ct }
         6. msg = nacl.box.open(ct, n, pubA, secB)
            - Returns null if tampered or wrong key
            - Else: render in chat thread
```

Each message uses a fresh random 24-byte nonce, so two identical plaintexts encrypt to different ciphertexts.

---

## Project layout

```
securechat/
├── package.json
├── server.js               Express + Socket.IO relay (validation, routing,
│                           offline queue, presence). No persistent storage.
├── public/
│   ├── index.html          Single-page app, strict CSP.
│   ├── app.css             Dark wallet-grade UI.
│   ├── app.js              Wallet management, contacts, chat, presence,
│                           typing indicators, encrypted send/receive.
│   ├── crypto-utils.js     Wraps TweetNaCl: keygen, encrypt, decrypt,
│                           validation, fingerprint, deterministic avatar.
│   └── (vendor NaCl + socket.io served from node_modules at runtime)
├── README.md
└── SECURITY.md             Detailed threat model and crypto rationale.
```

---

## Wire protocol

### Identity

A user's identity is a 32-byte X25519 public key, base64-encoded (44 characters). Example:

```
hQ8w2/0bJ4mq7H+ZXqvE0Y6n9w0BfH3E2zR8sJp3xKw=
```

The matching 32-byte private key (`secretKey`) lives only in the user's browser. Sharing it is equivalent to giving away your identity.

### Socket.IO events

| Direction       | Event            | Payload                                  | Ack                                        |
| --------------- | ---------------- | ---------------------------------------- | ------------------------------------------ |
| client → server | `register`       | `{ pubKey }`                             | `{ ok, delivered }` (drains offline queue) |
| client → server | `presence:check` | `{ pubKey }`                             | `{ ok, online }`                           |
| client → server | `message`        | `{ to, nonce, ciphertext }` — all base64 | `{ ok, delivered, queued?, ts }`           |
| client → server | `typing`         | `{ to, typing }`                         | —                                          |
| server → client | `message`        | `{ from, to, nonce, ciphertext, ts }`    | —                                          |
| server → client | `presence`       | `{ pubKey, online }`                     | —                                          |
| server → client | `typing`         | `{ from, typing }`                       | —                                          |

### Plaintext payload (inside the box)

```json
{ "v": 1, "t": "<message text>", "ts": 1715301234567 }
```

- `v` is the protocol version (currently `1`).
- `t` is the UTF-8 message text (up to 16 KiB).
- `ts` is the sender's local timestamp.

### Validation rules enforced by the server

| Field        | Rule                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| `pubKey`     | Exactly 44 base64 chars (`/^[A-Za-z0-9+/]{43}=$/`) → 32 bytes after decoding. |
| `nonce`      | Exactly 24 bytes (`/^[A-Za-z0-9+/]{32}={0,2}$/`) after decoding.              |
| `ciphertext` | Non-empty base64, ≤ 64 KiB. Server makes no other claims about its content.   |

Anything malformed is rejected with `{ ok: false, error: "<reason>" }`.

---

## Security model

See [SECURITY.md](SECURITY.md) for the full threat model. Headlines:

- ✅ **Confidentiality vs. relay operator** — the server cannot read messages. Verified by an automated test that sends a known plaintext and grep-checks the wire payload.
- ✅ **Confidentiality vs. passive network observer** — TLS is required for non-localhost deployments. With TLS, an observer sees only encrypted bytes plus IP-level metadata.
- ✅ **Integrity / authenticity** — Poly1305 MAC. Tampered ciphertext fails to open and surfaces an inline ⚠ warning to the recipient.
- ✅ **Replay across sessions** — random 24-byte nonces; reusing a nonce with the same key would break encryption, but `nacl.randomBytes` makes collisions cryptographically impossible.
- ⚠️ **No forward secrecy.** Static identity keys mean that if a private key is later compromised, all prior ciphertexts captured by an adversary become readable. To get FS, the standard upgrade path is X3DH + Double Ratchet (Signal Protocol). Not implemented here to keep the protocol auditable in a single afternoon.
- ⚠️ **Metadata.** The relay sees `from`, `to`, and timestamps. It does not log them by default, but a malicious operator could.
- ⚠️ **No identity verification.** A public key is just bytes. Out-of-band fingerprint comparison ("read me your pubkey starting and ending characters") is the canonical way to confirm you have the right person.
- ⚠️ **Browser storage.** Private keys live in `localStorage`. XSS or a malicious browser extension could exfiltrate them. The strict CSP in `index.html` (`script-src 'self'`, no inline scripts, no third-party origins) is the main defence.

---

## Configuration

Environment variables read by `server.js`:

| Variable | Default     | Description   |
| -------- | ----------- | ------------- |
| `HOST`   | `127.0.0.1` | Bind address. |
| `PORT`   | `3000`      | TCP port.     |

For production:

- Put the server behind a TLS-terminating reverse proxy (nginx, Caddy, fly.io, etc.). HTTPS is assumed by the CSP `connect-src ws: wss:` rule.
- Set `HOST=0.0.0.0` so the proxy can reach it.
- Constrain Socket.IO origins by editing `new Server(server, { cors: { origin: ... } })` if you embed the client elsewhere.
- Consider running multiple replicas with sticky sessions and the Socket.IO Redis adapter; the in-memory presence/queue maps in this build are single-process.

---

## Development

```bash
npm run dev       # node --watch server.js — auto-restarts on file changes
npm start         # production-ish start
```

There are no build steps. The frontend is plain JavaScript loaded directly. TweetNaCl and `socket.io-client` ship straight from `node_modules` to the browser.

### Running the bundled E2E sanity check

```bash
node - <<'JS'
// Mini repro of the test suite used during development.
const { io } = require('socket.io-client');
const nacl = require('tweetnacl');
const u = require('tweetnacl-util');

const ali = nacl.box.keyPair();
const bob = nacl.box.keyPair();
const URL = process.env.URL || 'http://127.0.0.1:3000';

(async () => {
  const a = io(URL, { transports: ['websocket'], reconnection: false });
  const b = io(URL, { transports: ['websocket'], reconnection: false });
  await new Promise(r => a.on('connect', r));
  await new Promise(r => b.on('connect', r));
  await new Promise(r => a.emit('register', { pubKey: u.encodeBase64(ali.publicKey) }, r));
  await new Promise(r => b.emit('register', { pubKey: u.encodeBase64(bob.publicKey) }, r));

  const got = new Promise(r => b.once('message', r));
  const msg = u.decodeUTF8(JSON.stringify({ v: 1, t: 'hi bob', ts: Date.now() }));
  const nonce = nacl.randomBytes(24);
  const ct = nacl.box(msg, nonce, bob.publicKey, ali.secretKey);
  a.emit('message', {
    to: u.encodeBase64(bob.publicKey),
    nonce: u.encodeBase64(nonce),
    ciphertext: u.encodeBase64(ct),
  });

  const env = await got;
  const opened = nacl.box.open(
    u.decodeBase64(env.ciphertext), u.decodeBase64(env.nonce),
    u.decodeBase64(env.from), bob.secretKey,
  );
  console.log('decrypted:', JSON.parse(u.encodeUTF8(opened)).t);
  process.exit(0);
})();
JS
```

---

## FAQ

**Where is my private key stored?**
In your browser's `localStorage` under the key `sc:wallet:v1`. It never leaves the browser. Clearing site data deletes it.

**What happens if I lose my secret key?**
Your identity is gone. Messages other people sent to your old key are mathematically unrecoverable. You'll need a new wallet and your contacts will need to re-add you.

**Can I use the same wallet on two devices?**
Yes — copy the secret key from device A (Account → Show secret key) and import it on device B. Both devices then share an identity. The server delivers each incoming message to all of that wallet's connected sockets, but message history is local-only — each device only sees messages it received while connected.

**Why not Signal Protocol / Double Ratchet?**
SecureChat is meant to be small enough to read end-to-end in a single sitting. The full Signal Protocol is the right choice if you need forward secrecy and break-in recovery; the current design trades those properties for simplicity and auditability.

**Is the relay the trusted party?**
No — confidentiality and integrity hold even if the relay is fully compromised. The relay is trusted only for _availability_ (delivering messages) and for not lying about presence/metadata. A motivated user could swap the relay URL with a peer-to-peer transport (libp2p, WebRTC) without touching the cryptography.

**Where do contacts and message history live?**
`localStorage` on each device. Nothing is sent to the server. If you clear site data you lose contacts and history (but if you backed up your secret key, your identity survives — your contacts can still reach you).

---

## License

MIT — see [LICENSE](LICENSE).
