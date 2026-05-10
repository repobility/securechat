/**
 * Unit tests for the refactored modules: validation, presence registry,
 * and offline queue. Each module is small enough to test in isolation
 * without spinning the relay up.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const nacl = require('tweetnacl');
const u = require('tweetnacl-util');

const {
  isValidPubKey,
  isValidNonce,
  isValidCiphertext,
  MAX_CIPHERTEXT_BYTES,
} = require('../src/validation');
const { PresenceRegistry } = require('../src/presence');
const { OfflineQueue } = require('../src/offline-queue');

// ---------- validation ----------

test('validation: isValidPubKey accepts a 32-byte X25519 key', () => {
  const kp = nacl.box.keyPair();
  assert.equal(isValidPubKey(u.encodeBase64(kp.publicKey)), true);
});

test('validation: isValidPubKey rejects junk and wrong-length keys', () => {
  assert.equal(isValidPubKey(''), false);
  assert.equal(isValidPubKey('hello'), false);
  assert.equal(isValidPubKey(u.encodeBase64(new Uint8Array(31))), false);
  assert.equal(isValidPubKey(u.encodeBase64(new Uint8Array(33))), false);
  assert.equal(isValidPubKey(null), false);
  assert.equal(isValidPubKey(123), false);
});

test('validation: isValidNonce accepts 24-byte nonces only', () => {
  assert.equal(isValidNonce(u.encodeBase64(nacl.randomBytes(24))), true);
  assert.equal(isValidNonce(u.encodeBase64(new Uint8Array(23))), false);
  assert.equal(isValidNonce(u.encodeBase64(new Uint8Array(25))), false);
  assert.equal(isValidNonce(''), false);
  assert.equal(isValidNonce(null), false);
});

test('validation: isValidCiphertext rejects empty, oversized, and non-base64', () => {
  assert.equal(isValidCiphertext(u.encodeBase64(new Uint8Array(64))), true);
  assert.equal(isValidCiphertext(''), false);
  assert.equal(isValidCiphertext('!!!'), false);
  // Above the cap by one base64 character.
  assert.equal(isValidCiphertext('A'.repeat(MAX_CIPHERTEXT_BYTES + 1)), false);
});

// ---------- presence registry ----------

test('presence: add / isOnline / remove cycle', () => {
  const p = new PresenceRegistry();
  assert.equal(p.isOnline('alice'), false);
  p.add('alice', 'sock-1');
  assert.equal(p.isOnline('alice'), true);
  assert.deepEqual([...p.socketsFor('alice')], ['sock-1']);
  p.remove('alice', 'sock-1');
  assert.equal(p.isOnline('alice'), false);
  assert.equal(p.socketsFor('alice'), undefined);
});

test('presence: multiple sockets for one identity', () => {
  const p = new PresenceRegistry();
  p.add('alice', 's1');
  p.add('alice', 's2');
  assert.equal(p.socketsFor('alice').size, 2);
  p.remove('alice', 's1');
  assert.equal(p.isOnline('alice'), true);
  p.remove('alice', 's2');
  assert.equal(p.isOnline('alice'), false);
});

test('presence: size counts distinct identities, not sockets', () => {
  const p = new PresenceRegistry();
  p.add('a', 's1');
  p.add('a', 's2');
  p.add('b', 's3');
  assert.equal(p.size(), 2);
});

// ---------- offline queue ----------

test('offline-queue: drain returns then clears the buffer', () => {
  const q = new OfflineQueue({ limitPerRecipient: 100 });
  const env = (i) => ({ from: 'a', to: 'b', nonce: 'n', ciphertext: `ct${i}`, ts: i });
  q.push('b', env(1));
  q.push('b', env(2));
  q.push('b', env(3));
  assert.equal(q.drain('b').length, 3);
  assert.equal(q.drain('b').length, 0, 'buffer is cleared after drain');
});

test('offline-queue: per-recipient cap evicts oldest', () => {
  const q = new OfflineQueue({ limitPerRecipient: 3 });
  for (let i = 0; i < 5; i++) {
    q.push('b', { from: 'a', to: 'b', nonce: 'n', ciphertext: `ct${i}`, ts: i });
  }
  const drained = q.drain('b');
  assert.equal(drained.length, 3, 'cap is honored');
  assert.deepEqual(
    drained.map((e) => e.ciphertext),
    ['ct2', 'ct3', 'ct4'],
    'oldest envelopes are evicted first',
  );
});

test('offline-queue: independent buffers per recipient', () => {
  const q = new OfflineQueue();
  q.push('a', { from: 'x', to: 'a', nonce: 'n', ciphertext: 'A', ts: 1 });
  q.push('b', { from: 'x', to: 'b', nonce: 'n', ciphertext: 'B', ts: 2 });
  assert.equal(q.drain('a').length, 1);
  assert.equal(q.drain('b').length, 1);
});
