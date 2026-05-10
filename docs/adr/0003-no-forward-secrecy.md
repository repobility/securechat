# ADR 0003 — No forward secrecy in v1

- **Status**: Accepted
- **Date**: 2026-05-10

## Context

[NaCl `box`](0002-nacl-box-as-the-aead-primitive.md) uses the user's
long-term identity keypair directly to derive the symmetric key for
each message. If a private key is later compromised, every ciphertext
ever sent to that user becomes readable to whoever captured the wire
traffic.

The standard mitigation — the
[Signal Protocol](https://signal.org/docs/specifications/x3dh/) (X3DH +
Double Ratchet) — combines pre-keys, ephemeral DH, and a per-message
ratchet so that compromise of one message key does not reveal earlier
or later traffic. It is widely deployed and well understood.

## Decision

v1 of SecureChat **intentionally** does not implement forward secrecy.

## Rationale

- The project's stated goal is to remain readable end-to-end in a
  single sitting. Adding the Double Ratchet roughly triples the
  cryptographic surface and obscures the simple invariant
  ("ciphertext = `box(msg, recipient_pub, sender_priv)`") that makes
  the wire protocol auditable.
- The threat model documented in [SECURITY.md](../../SECURITY.md)
  explicitly lists "retroactive key compromise" as out of scope. This
  is appropriate for a small demo / educational project, and is not
  appropriate for a production messenger.
- Adding FS later is feasible: the `v` field in the plaintext envelope
  (`{v: 1, t: …, ts: …}`) reserves room for a protocol bump, and the
  client/server validation is already version-aware.

## Consequences

- An adversary who captures encrypted traffic and later steals a
  private key can read those captured messages. We accept this for the
  threat model documented in SECURITY.md.
- A future ADR that reverses this decision will introduce a `v: 2`
  envelope. Old clients can fall back to v1 only when explicitly
  permitted; the relay validates the wire shape but does not
  participate in the protocol bump.
- We document this prominently in [README.md](../../README.md#security-model)
  and [SECURITY.md](../../SECURITY.md#threat-model) so that users do
  not deploy v1 in scenarios where retroactive compromise matters.
