# SecureChat wire protocol — v1

This is the authoritative description of the SecureChat wire format. The
[README](../README.md#wire-protocol) shows a quick-reference table; this
document gives the full normative spec.

> Versioning. The `v` field on the inner plaintext envelope is the
> protocol version. This document describes **v1**. A future v2 must
> ship a new revision of this file under a new version heading and an
> ADR explaining the change.

---

## 1. Notation

- All keys, nonces, and ciphertexts are encoded as standard base64 (RFC
  4648 §4) on the wire. They are decoded to bytes before any
  cryptographic operation.
- All timestamps are integer milliseconds since the Unix epoch (UTC).
- "Pubkey" means a 32-byte X25519 public key; the matching "secret key"
  is the 32-byte X25519 private key. Both are produced by
  `nacl.box.keyPair()`.
- "MUST", "MUST NOT", "SHOULD", "MAY" follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## 2. Identity

Each user holds a long-term X25519 keypair generated client-side. The
public key is the user's identity. The secret key MUST NOT leave the
client device.

A user MAY import an existing wallet by pasting the secret key into the
setup screen; this rebinds the same identity on a new device.

A pubkey on the wire is exactly 44 base64 characters (32 bytes →
ceil(32/3)\*4, with one `=` padding byte). The relay validates this with
`/^[A-Za-z0-9+/]{43}=$/`.

---

## 3. Cryptographic envelope

Every message that crosses the wire is the output of a single
`nacl.box` call:

```
ciphertext = nacl.box(plaintext, nonce, recipient_pubkey, sender_secret_key)
```

- `nonce` is 24 random bytes generated with a CSPRNG. A nonce MUST NOT
  be reused with the same recipient under the same sender keypair.
  `nacl.randomBytes` provides cryptographically negligible collision
  probability over the lifetime of a wallet.
- `plaintext` is the UTF-8 encoding of a JSON object (the _inner
  envelope_).
- The output `ciphertext` includes the 16-byte Poly1305 authenticator;
  recipients MUST treat `nacl.box.open(...) === null` as _all of_:
  forged sender, tampered ciphertext, modified nonce, or wrong
  recipient. Implementations MUST NOT branch on the failure cause.

---

## 4. Inner envelope

Inside the box, the plaintext is a JSON object:

```json
{ "v": 1, "t": "<message text>", "ts": 1715301234567 }
```

| Field | Type   | Required | Notes                                           |
| ----- | ------ | -------- | ----------------------------------------------- |
| `v`   | int    | yes      | Protocol version. Currently `1`.                |
| `t`   | string | yes      | Up to 16 KiB of UTF-8 text.                     |
| `ts`  | int    | yes      | Sender's local clock at encryption time, in ms. |

A receiver SHOULD treat any of the following as "could not decrypt":

- `box.open` returns null;
- the JSON parse fails;
- `v` is not a known version;
- `t` is missing or not a string.

---

## 5. Transport (Socket.IO)

### 5.1 Client → server events

#### `register`

Bind an X25519 identity to this socket.

| Field    | Type   | Required |
| -------- | ------ | -------- |
| `pubKey` | string | yes      |

Acks with `{ ok: true, delivered: <int> }` (count of envelopes drained
from the offline queue), or `{ ok: false, error: "invalid_pubkey" }`.

If the socket was already registered under a different pubkey, the
relay releases the previous identity and broadcasts a `presence` event
for it before binding the new one.

#### `presence:check`

Query whether a pubkey has any live socket. Caller must already be
registered.

| Field    | Type   | Required |
| -------- | ------ | -------- |
| `pubKey` | string | yes      |

Acks with `{ ok: true, online: <bool> }` or `{ ok: false, error: "invalid_pubkey" }`.

#### `message`

Submit an encrypted envelope for relay.

| Field        | Type   | Required |
| ------------ | ------ | -------- |
| `to`         | string | yes      |
| `nonce`      | string | yes      |
| `ciphertext` | string | yes      |

The relay MUST ignore any client-supplied `from` field; the outgoing
envelope's `from` is always the socket's registered identity.

Validation rules:

| Field        | Rule                                  |
| ------------ | ------------------------------------- |
| `to`         | matches `/^[A-Za-z0-9+/]{43}=$/`      |
| `nonce`      | matches `/^[A-Za-z0-9+/]{32}={0,2}$/` |
| `ciphertext` | non-empty base64, ≤ 64 KiB            |

Acks:

| Outcome                                  | Ack shape                                                 |
| ---------------------------------------- | --------------------------------------------------------- |
| Recipient is online                      | `{ ok: true, delivered: true,  ts: <int> }`               |
| Recipient is offline                     | `{ ok: true, delivered: false, queued: true, ts: <int> }` |
| Sender not registered                    | `{ ok: false, error: "not_registered" }`                  |
| Bad recipient / nonce / ciphertext shape | `{ ok: false, error: "<which one>" }`                     |

Per-recipient offline queue is bounded at 200 envelopes; oldest are
evicted first.

#### `typing`

Forward a typing indicator. No ack, no persistence.

| Field    | Type   | Required |
| -------- | ------ | -------- |
| `to`     | string | yes      |
| `typing` | bool   | yes      |

### 5.2 Server → client events

#### `message` (delivery)

The relay forwards an envelope to every live socket bound to `to`,
plus drains any envelopes queued while `to` was offline at register
time.

```json
{
  "from": "<sender pubkey>",
  "to": "<recipient pubkey>",
  "nonce": "<base64>",
  "ciphertext": "<base64>",
  "ts": 1715301234567
}
```

`from` is server-stamped from the sender socket's registered identity.
Clients MUST NOT trust a `from` field that arrives via any other
channel.

#### `presence`

```json
{ "pubKey": "<pubkey>", "online": true | false }
```

Broadcast to all connected sockets when a pubkey transitions
online↔offline. A re-registration under a new pubkey emits an
"offline" event for the old pubkey before the "online" event for the
new one.

#### `typing`

```json
{ "from": "<sender pubkey>", "typing": true | false }
```

Forwarded only to the live sockets of the targeted recipient.

---

## 6. Constants

| Constant                      | Value        | Where                    |
| ----------------------------- | ------------ | ------------------------ |
| `MAX_PLAINTEXT_BYTES`         | 16,384       | `public/crypto-utils.js` |
| `MAX_CIPHERTEXT_BYTES`        | 65,536       | `src/validation.js`      |
| Socket.IO `maxHttpBufferSize` | 131,072      | `server.js`              |
| `OFFLINE_QUEUE_LIMIT`         | 200 / pubkey | `src/offline-queue.js`   |
| Socket.IO `pingInterval`      | 20,000 ms    | `server.js`              |
| Socket.IO `pingTimeout`       | 25,000 ms    | `server.js`              |

---

## 7. Conformance test vectors

The cryptographic invariants are exercised by [tests/crypto.test.js](../tests/crypto.test.js)
and the wire-format invariants by [tests/server.test.js](../tests/server.test.js)
and [tests/auth.test.js](../tests/auth.test.js). A new transport
(libp2p, WebRTC, Tor) MUST produce the same observable behavior on
those test cases when wired against the same `nacl.box` ciphertext.
