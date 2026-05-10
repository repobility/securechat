/**
 * Crypto-layer tests.
 *
 * Recreates the browser's crypto-utils.js logic in Node so we can assert the
 * same protocol invariants from a test runner. The browser bundle is loaded
 * verbatim and exercised through a tiny shim that supplies window globals.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');

// Load public/crypto-utils.js into a sandbox that mirrors the browser globals
// it depends on, then capture the SC_Crypto namespace it attaches to `window`.
function loadBrowserCrypto() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'crypto-utils.js'), 'utf8');
  const sandbox = { nacl, nacl_util: naclUtil, naclUtil };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.SC_Crypto;
}

const SC = loadBrowserCrypto();

test('generateWallet produces a valid X25519 keypair', () => {
  const w = SC.generateWallet();
  assert.equal(typeof w.publicKey, 'string');
  assert.equal(typeof w.secretKey, 'string');
  assert.equal(naclUtil.decodeBase64(w.publicKey).length, 32);
  assert.equal(naclUtil.decodeBase64(w.secretKey).length, 32);
  assert.notEqual(w.publicKey, w.secretKey);
});

test('walletFromSecretKey reconstructs the same public key', () => {
  const w = SC.generateWallet();
  const restored = SC.walletFromSecretKey(w.secretKey);
  assert.equal(restored.publicKey, w.publicKey);
  assert.equal(restored.secretKey, w.secretKey);
});

test('walletFromSecretKey rejects malformed input', () => {
  // Junk that isn't even valid base64.
  assert.throws(() => SC.walletFromSecretKey('not-base64-at-all-!!'));
  // Valid base64 but the wrong length must fail with our explicit error.
  assert.throws(
    () => SC.walletFromSecretKey(naclUtil.encodeBase64(new Uint8Array(31))),
    /32 bytes/,
  );
});

test('isValidPublicKey accepts valid keys and rejects junk', () => {
  const w = SC.generateWallet();
  assert.equal(SC.isValidPublicKey(w.publicKey), true);
  assert.equal(SC.isValidPublicKey(''), false);
  assert.equal(SC.isValidPublicKey('hello'), false);
  assert.equal(SC.isValidPublicKey(null), false);
  assert.equal(SC.isValidPublicKey(undefined), false);
  assert.equal(SC.isValidPublicKey(123), false);
});

test('encrypt + decrypt roundtrip recovers the plaintext', () => {
  const a = SC.generateWallet();
  const b = SC.generateWallet();
  const env = SC.encryptMessage('hello bob', b.publicKey, a.secretKey);
  const opened = SC.decryptMessage(env.ciphertext, env.nonce, a.publicKey, b.secretKey);
  assert.ok(opened);
  assert.equal(opened.text, 'hello bob');
  assert.equal(typeof opened.ts, 'number');
});

test('two encryptions of the same plaintext produce different ciphertexts (fresh nonces)', () => {
  const a = SC.generateWallet();
  const b = SC.generateWallet();
  const e1 = SC.encryptMessage('same', b.publicKey, a.secretKey);
  const e2 = SC.encryptMessage('same', b.publicKey, a.secretKey);
  assert.notEqual(e1.nonce, e2.nonce, 'nonces must differ');
  assert.notEqual(e1.ciphertext, e2.ciphertext, 'ciphertexts must differ');
});

test('decrypt with a wrong recipient key returns null (no plaintext leak)', () => {
  const a = SC.generateWallet();
  const b = SC.generateWallet();
  const eve = SC.generateWallet();
  const env = SC.encryptMessage('secret', b.publicKey, a.secretKey);
  const opened = SC.decryptMessage(env.ciphertext, env.nonce, a.publicKey, eve.secretKey);
  assert.equal(opened, null);
});

test('decrypt with a forged sender public key returns null', () => {
  const a = SC.generateWallet();
  const b = SC.generateWallet();
  const mallory = SC.generateWallet();
  const env = SC.encryptMessage('legit', b.publicKey, a.secretKey);
  // Bob tries to decrypt the message claiming it came from Mallory.
  const opened = SC.decryptMessage(env.ciphertext, env.nonce, mallory.publicKey, b.secretKey);
  assert.equal(opened, null);
});

test('Poly1305 rejects a single-bit ciphertext modification', () => {
  const a = SC.generateWallet();
  const b = SC.generateWallet();
  const env = SC.encryptMessage('integrity', b.publicKey, a.secretKey);
  const ct = Buffer.from(naclUtil.decodeBase64(env.ciphertext));
  ct[ct.length - 1] ^= 0x01;
  const tampered = naclUtil.encodeBase64(ct);
  const opened = SC.decryptMessage(tampered, env.nonce, a.publicKey, b.secretKey);
  assert.equal(opened, null);
});

test('Poly1305 rejects a modified nonce', () => {
  const a = SC.generateWallet();
  const b = SC.generateWallet();
  const env = SC.encryptMessage('nonce-bound', b.publicKey, a.secretKey);
  const n = Buffer.from(naclUtil.decodeBase64(env.nonce));
  n[0] ^= 0x80;
  const tamperedNonce = naclUtil.encodeBase64(n);
  const opened = SC.decryptMessage(env.ciphertext, tamperedNonce, a.publicKey, b.secretKey);
  assert.equal(opened, null);
});

test('encrypt rejects oversized plaintext', () => {
  const a = SC.generateWallet();
  const b = SC.generateWallet();
  const tooBig = 'x'.repeat(SC.MAX_PLAINTEXT_BYTES + 1);
  assert.throws(() => SC.encryptMessage(tooBig, b.publicKey, a.secretKey), /too long/);
});

test('fingerprint shortens long keys deterministically', () => {
  const w = SC.generateWallet();
  const fp = SC.fingerprint(w.publicKey);
  assert.match(fp, /^[A-Za-z0-9+/]{6}…[A-Za-z0-9+/]{6}$/);
  assert.equal(SC.fingerprint(w.publicKey), fp, 'must be deterministic');
});

test('avatarFor produces deterministic, distinct results for distinct keys', () => {
  const a = SC.generateWallet();
  const b = SC.generateWallet();
  const av1 = SC.avatarFor(a.publicKey);
  const av2 = SC.avatarFor(b.publicKey);
  assert.equal(SC.avatarFor(a.publicKey).bg, av1.bg, 'deterministic');
  assert.match(av1.bg, /^hsl\(/);
  assert.equal(av1.initials.length, 2);
  // Different keys should usually produce different avatars (probabilistic
  // but extremely likely with a 32-byte input).
  assert.notEqual(av1.bg, av2.bg);
});
