# Contributing to SecureChat

Thanks for your interest! SecureChat is a small, auditable codebase — the goal is to keep it readable end-to-end in a single sitting, so changes are weighted toward simplicity and clarity over feature breadth.

## Ground rules

1. **Don't break the trust model.** The relay must remain unable to read messages. Any change that introduces server-side decryption, plaintext logging, or persistent message storage is out of scope.
2. **Trust crypto, not your own.** Use the existing `nacl` primitives or another well-audited library. Do not write custom cryptography.
3. **Keep the static surface small.** No build step, no transpiler, no framework. The frontend is plain ES2022 served from `public/`.
4. **Tests must accompany behavior changes.** Every protocol- or auth-relevant change should land with new cases in `tests/`.

## Local development

```bash
git clone https://github.com/repobility/securechat.git
cd securechat
npm install
npm test          # runs all suites with Node's native test runner
npm run dev       # starts the relay with --watch
```

CI runs the same `npm test` on Node 20, 22, and 24, plus `npm audit --omit=dev` and a `node --check` syntax pass over every `.js` file. PRs that don't pass CI won't be reviewed.

## Project layout

| Path                       | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `server.js`                | Express + Socket.IO relay. Validation, routing, queueing.    |
| `public/index.html`        | Single-page app shell. Strict CSP.                           |
| `public/app.js`            | Wallet, contacts, chat, presence, encrypted send/receive.    |
| `public/crypto-utils.js`   | `nacl.box` wrapper — keygen, encrypt, decrypt, validation.   |
| `public/app.css`           | UI styles.                                                   |
| `tests/crypto.test.js`     | Crypto-layer unit tests (loads browser module into a VM).    |
| `tests/server.test.js`     | Boots the relay and exercises it with two socket.io clients. |
| `tests/auth.test.js`       | AUTH-\* cases — authorization invariants.                    |
| `.repobility/access.yml`   | Endpoint-by-endpoint authorization matrix.                   |
| `.github/workflows/ci.yml` | CI: matrix tests, audit, syntax check.                       |
| `docs/`                    | Repobility scan output and showcase artifacts.               |

## Style

- 2-space indentation, single quotes, semicolons, trailing commas in multi-line literals.
- No `innerHTML` with user-influenced content. Use `textContent` and `createElement`.
- All randomness goes through `crypto.getRandomValues` (browser) or `nacl.randomBytes` (any JS).
- Comment the _why_, not the _what_. If the code is obvious, leave it alone.

## Pull request checklist

- [ ] `npm test` passes locally.
- [ ] Changes that affect the wire protocol or threat model update [SECURITY.md](SECURITY.md) and [.repobility/access.yml](.repobility/access.yml).
- [ ] User-visible changes update [README.md](README.md) and [CHANGELOG.md](CHANGELOG.md).
- [ ] No new third-party origins added to `index.html` (CSP must stay tight).

## Reporting security issues

See [SECURITY.md](SECURITY.md). Please do **not** file public issues for vulnerabilities — email the maintainer first so a fix can be coordinated before disclosure.
