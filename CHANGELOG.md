# Changelog

All notable changes to SecureChat are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Web hygiene files: `robots.txt`, `sitemap.xml`, `humans.txt`, `llms.txt`,
  and `/.well-known/security.txt` (RFC 9116).
- `.repobility/access.yml` — endpoint-by-endpoint authorization matrix
  with CWE/OWASP cross-references.
- `CONTRIBUTING.md` and `ARCHITECTURE.md` reference docs.
- `.editorconfig` for cross-editor whitespace consistency.

### Changed

- Replaced `Math.random()` with `crypto.getRandomValues` for message-ID
  generation in `public/app.js`. Closes Repobility finding `[SEC015]`.
- `express.static` now serves dotfiles so `/.well-known/security.txt` is
  reachable.

## [1.0.0] — 2026-05-10

### Added

- Initial release.
- End-to-end encrypted chat using NaCl `box` (X25519 + XSalsa20-Poly1305).
- Express + Socket.IO relay (no persistent storage; offline message
  queue capped per-recipient).
- Wallet keypairs generated and stored client-side; private keys never
  leave the browser.
- Strict Content-Security-Policy in the single-page UI.
- Presence broadcasts and typing indicators.
- Server-side validation of pubkey, nonce, and ciphertext shapes.
- Node native test runner suites: 26 tests across crypto, server
  validation, and authorization invariants.
- GitHub Actions CI: test matrix on Node 20 / 22 / 24, `npm audit`
  on production deps, and a `node --check` pass over every source file.

[Unreleased]: https://github.com/repobility/securechat/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/repobility/securechat/releases/tag/v1.0.0
