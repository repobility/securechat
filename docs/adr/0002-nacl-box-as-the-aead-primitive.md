# ADR 0002 — NaCl `box` as the authenticated-encryption primitive

- **Status**: Accepted
- **Date**: 2026-05-10

## Context

SecureChat needs an authenticated-encryption-with-associated-data
(AEAD) construction that:

1. Has a key-agreement story: two peers each hold a long-term keypair,
   and a message can be encrypted to the recipient's public key.
2. Is well-audited and small enough to vendor without a build step.
3. Works identically in the browser and in Node, so the test suite can
   exercise the same code path end users do.

## Decision

We use NaCl `box` via [TweetNaCl 1.0.3](https://github.com/dchest/tweetnacl-js).
The construction is:

- **X25519** for ECDH key agreement.
- **HSalsa20** to derive a 256-bit symmetric key.
- **XSalsa20** for the stream cipher.
- **Poly1305** for the 128-bit MAC.

The library is ~3 KB minified, has been independently audited
(Cure53 in 2017), and ships an identical API in Node and the browser.

We considered:

- **Web Crypto's X25519 + AES-GCM**: standards-blessed but its X25519
  surface is uneven across browsers as of 2026, and the dual-environment
  (Node test runner + browser) story would require a polyfill anyway.
- **libsignal**: gives us forward secrecy (ratcheting) for free, but at
  ~10× the LOC and complexity. See ADR-0003 for the FS trade-off.
- **AES-GCM with a custom KDF**: nothing wrong with it, but rolling the
  key derivation ourselves removes one of the main reasons for picking
  a tested AEAD in the first place.

## Consequences

- Confidentiality and integrity hold against any adversary who does not
  hold the recipient's private key.
- The browser bundle has zero crypto-related third-party origins.
- We do **not** get forward secrecy from this choice; see ADR-0003.
- If a serious vulnerability is found in NaCl `box`, the cryptographic
  surface is small enough (one module, three call sites) to swap out
  in a single PR.
