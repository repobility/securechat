# ADR 0004 — Relay is honest-but-curious, never a trust root

- **Status**: Accepted
- **Date**: 2026-05-10

## Context

A messenger needs _some_ server-side component to deliver messages
between peers who are rarely online at the same time. The question is
how much trust that component requires.

In a typical web messenger, the server owns identities, holds session
tokens, terminates encryption, and can read every message. Compromising
the server compromises every conversation.

## Decision

The SecureChat relay is **honest-but-curious**: it routes ciphertext
and presence events between identities, but it holds no private keys
and cannot decrypt anything. The relay's only security responsibilities
are availability and metadata hygiene.

Concretely, the relay:

- generates no keys;
- accepts no plaintext;
- keeps no persistent storage (presence and offline queues are
  in-memory);
- writes nothing to disk by default — including, importantly, no
  request logs of `from`/`to` pairs.

The relay validates wire shapes (regex on pubkey/nonce/ciphertext,
size caps), and it stamps the `from` field on every outgoing envelope
with the socket's registered identity so a client cannot forge sender
identity. Beyond that, it is dumb.

## Consequences

- Compromising the relay leaks **metadata** (who talks to whom and
  when) but not message contents. We accept this and document it in
  [SECURITY.md](../../SECURITY.md#threat-model).
- The wire protocol can be re-pointed at any other transport (a
  different relay, libp2p, WebRTC) without touching the cryptographic
  core. The relay is not a trust root.
- We do not need user accounts, password resets, session tokens,
  rate-limit-per-account, or any of the usual server-side identity
  machinery. The trade-off: spam / abuse mitigation has to be
  pubkey-based or transport-level (TLS client certs, IP-based limits).
- If we ever need richer features (group chats, read receipts that
  survive offline) we add them to the wire protocol, never to the
  relay's mental model.
