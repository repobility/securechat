# Security model

This document is the long-form companion to the security headlines in [README.md](README.md). It states what SecureChat tries to defend against, what it does *not* defend against, and the cryptographic and engineering reasoning behind both.

The goal is to let a security-minded reader audit the project in a single sitting.

---

## Cryptographic primitive

SecureChat uses [NaCl `box`](https://nacl.cr.yp.to/box.html) (TweetNaCl 1.0.3 in the browser, `tweetnacl` 1.x on the server side — though the server never decrypts anything).

`box(message, nonce, recipient_public_key, sender_secret_key)` is:

1. **X25519 ECDH** — the sender derives a shared secret from their secret key and the recipient's public key.
2. **HSalsa20** — derives a 256-bit symmetric key from that shared secret.
3. **XSalsa20** — encrypts the plaintext under that symmetric key with the 24-byte nonce.
4. **Poly1305** — appends a 16-byte authenticator over the ciphertext.

The recipient runs the same construction in reverse. If a single bit is altered, Poly1305 verification fails and `box.open` returns `null`.

This is a battle-tested authenticated-encryption construction with no known practical attacks. It is the same combination that powers `crypto_box` in libsodium, used by Signal-adjacent libraries, WireGuard's auth handshake, and many others.

### Why not Web Crypto?

The browser's [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) is available and standards-blessed, but its X25519 / Curve25519 surface is uneven across browsers and TweetNaCl is well-audited and tiny (~3 KB minified). The trade-off would be one more layer of defensive code without a meaningful security gain. If you need FIPS-validated crypto for compliance reasons, swap in Web Crypto behind the same `crypto-utils.js` interface.

---

## Threat model

Adversaries are listed roughly from "most realistic" to "most powerful":

### 1. The relay operator (honest-but-curious or actively malicious)

**Defended.** The relay holds no private keys and only forwards opaque ciphertext. A malicious operator cannot recover plaintext.

What they *can* see:

- Sender public key, recipient public key, timestamp.
- Connection metadata: IP address, user agent, presence/typing.
- The size of every message (cipher overhead is fixed, so size ≈ plaintext length + 16-byte MAC).

This is the metadata SecureChat does *not* try to hide. Signal hides slightly more with sealed-sender; Tor / mixnets hide more still. If hiding *who talks to whom* matters to you, this design is not enough.

### 2. A passive network observer (ISP, café Wi-Fi)

**Defended, conditional on TLS.** The relay must be deployed behind HTTPS for all non-localhost use. With TLS, the observer sees only encrypted bytes plus IP-level metadata. Without TLS, they see ciphertext + headers in the clear, which is still *confidential* (the box crypto holds), but they get every piece of metadata the relay would.

### 3. An active network attacker (MITM)

**Defended, conditional on TLS pinning of the relay (server side) and out-of-band pubkey verification (peer side).** A MITM cannot decrypt ciphertext — but they can trick a new user into talking to a fake "Bob" public key the attacker controls. SecureChat shows fingerprints (first/last 6 chars of base64) so users can verify a contact's pubkey out of band, the same way Signal users compare safety numbers.

### 4. A compromised peer (Eve has Bob's secret key right now)

**Not defended — this is by definition out of scope.** Anyone with the secret key can read messages addressed to the matching public key, just as anyone with your email password can read your inbox.

### 5. A retroactive key compromise (Eve gets Bob's secret key in 2027 and replays captured 2026 traffic)

**Not defended.** SecureChat has no forward secrecy. Identity keys are static, so any ciphertext an adversary captured in the past becomes readable as soon as a private key leaks.

The standard upgrade is the [Signal Protocol](https://signal.org/docs/) (X3DH + Double Ratchet): each message is encrypted under a fresh, ephemeral key derived via a continuously-evolving ratchet. SecureChat doesn't ship this because the protocol roughly triples the project's size and obscures the read-it-in-a-sitting goal. If you need FS, layering libsignal on top of this transport is the right path.

### 6. A malicious browser extension or XSS

**Best-effort defence.** The private key is stored in `localStorage`, which any same-origin script can read. The mitigations:

- **Strict Content-Security-Policy** in [public/index.html](public/index.html):
  ```
  default-src 'self';
  script-src  'self';        # no inline JS, no third-party origins
  style-src   'self' 'unsafe-inline';
  connect-src 'self' ws: wss:;
  base-uri    'self';
  form-action 'none';
  frame-ancestors 'none';
  ```
- **No third-party CDNs.** All JavaScript is served from the same origin (TweetNaCl and Socket.IO are copied out of `node_modules` by the server).
- **No use of `innerHTML` with untrusted content.** The frontend uses `textContent` and `createElement` exclusively. (`grep "innerHTML" public/` returns no hits.)
- **Sanitised inputs.** Display names are length-capped to 40 chars and rendered as text. Public keys are validated by length and base64 shape before use.

A browser-extension adversary with permission to read every page can still exfiltrate the secret key. There is no defence against an attacker who controls the renderer; that's why hardware-backed keystores exist for production messengers.

### 7. A compromised server delivering a backdoored client

**Not defended in code.** The server ships the JavaScript that does the encrypting. If the server is compromised, it can deliver a client that exfiltrates secret keys. This is the classic "trust the server *once*" problem of any web-delivered E2E messenger.

Production deployments typically address this with code signing, reproducible builds, and a separate code-distribution path (browser extensions, native apps). For SecureChat, the answer is "audit the source you cloned, or run your own relay."

---

## Server-side validation

The relay does not trust client payloads. Every value is checked before it touches any state:

| Field        | Regex / rule                                             | Source                                      |
| ------------ | -------------------------------------------------------- | ------------------------------------------- |
| `pubKey`     | `^[A-Za-z0-9+/]{43}=$` → 32 bytes                        | [server.js](server.js) `PUBKEY_RE`           |
| `nonce`      | `^[A-Za-z0-9+/]{32}={0,2}$` → 24 bytes                   | [server.js](server.js) `NONCE_RE`            |
| `ciphertext` | base64, non-empty, ≤ 64 KiB                              | [server.js](server.js) `isValidCiphertext`   |
| `to` / `from`| Must pass pubkey check; `from` is locked to the socket's registered identity | [server.js](server.js) `socket.on('message')` |

The Socket.IO `maxHttpBufferSize` is set to 128 KiB — small enough that ciphertext-flooding is bounded, large enough for normal use. Per-recipient offline queue is capped at 200 messages (oldest evicted) to bound memory under load.

---

## Known limitations and intentional non-goals

- **Group chats.** Not implemented. A naive "encrypt-to-each-member" group scheme is the obvious next step; for production, look at MLS ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420)).
- **Voice/video.** Not implemented. WebRTC over the same identity model is feasible.
- **Attachments.** Not implemented. The 16 KiB plaintext cap and 64 KiB ciphertext cap exist to keep the relay cheap. Files would want chunking + a separate blob store keyed by content hash.
- **Persistent server-side message history.** Intentionally absent. Messages live only on devices; if both peers wipe their browsers, the conversation is gone. This is a feature.
- **Multi-device sync.** A user can import the same secret key on multiple devices, but devices won't sync history with each other. Solving this properly needs an encrypted backup / sync mechanism (e.g. encrypted blobs keyed by a passphrase-derived KEK).

---

## Reporting a vulnerability

If you find a bug that has security implications, please **do not** open a public GitHub issue. Email the maintainer instead. Fixes will be coordinated before public disclosure.
