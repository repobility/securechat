<!-- Thanks for contributing! Keep the trust model intact. -->

## Summary

<!-- One paragraph: what changed and why. Link the issue if there is one. -->

## Trust-model impact

- [ ] No change. (Pure refactor, docs, or UI tweak.)
- [ ] Touches the wire protocol — `SECURITY.md`, `ARCHITECTURE.md`, and `.repobility/access.yml` are updated.
- [ ] Touches the relay validation rules — added/updated tests in `tests/server.test.js` and `tests/auth.test.js`.
- [ ] Touches the cryptographic core — added/updated tests in `tests/crypto.test.js`.

## Checklist

- [ ] `npm test` passes locally on Node 20+.
- [ ] No new third-party origins added to `index.html` (CSP must stay tight).
- [ ] Browser code uses `crypto.getRandomValues` / `nacl.randomBytes` — no `Math.random` for any security-adjacent purpose.
- [ ] Display strings use `textContent`, not `innerHTML`.
- [ ] User-visible changes are noted in `CHANGELOG.md` under `[Unreleased]`.

## Test plan

<!-- How did you verify this? Two-browser manual check, automated tests,
     curl against the relay, etc. -->
