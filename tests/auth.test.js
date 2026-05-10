/**
 * Authorization-focused tests (Repobility AUC005).
 *
 * SecureChat doesn't have user roles or admin endpoints — every relayed
 * message is end-to-end encrypted with a recipient pubkey. The "authorization"
 * surface is the mapping from sender identity → which messages they're
 * allowed to claim authorship of, and from recipient identity → which
 * ciphertexts they're allowed to decrypt. These tests assert that surface.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const nacl = require('tweetnacl');
const u = require('tweetnacl-util');
const { io } = require('socket.io-client');

const PORT = 3500 + Math.floor(Math.random() * 200);
const URL = `http://127.0.0.1:${PORT}`;

let server;

test.before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start timeout')), 8000);
    server.stdout.on('data', (b) => {
      if (b.toString().includes('listening')) { clearTimeout(t); resolve(); }
    });
    server.stderr.on('data', (b) => process.stderr.write(b));
  });
});

test.after(async () => {
  server?.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
});

function genWallet() {
  const kp = nacl.box.keyPair();
  return { publicKey: u.encodeBase64(kp.publicKey), secretKey: u.encodeBase64(kp.secretKey) };
}
function encrypt(text, recipientPub, senderSec) {
  const msg = u.decodeUTF8(JSON.stringify({ v: 1, t: text, ts: Date.now() }));
  const nonce = nacl.randomBytes(24);
  const ct = nacl.box(msg, nonce, u.decodeBase64(recipientPub), u.decodeBase64(senderSec));
  return { nonce: u.encodeBase64(nonce), ciphertext: u.encodeBase64(ct) };
}
function connect(wallet) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    const t = setTimeout(() => reject(new Error('connect timeout')), 4000);
    s.on('connect', () => {
      clearTimeout(t);
      s.emit('register', { pubKey: wallet.publicKey }, (ack) => {
        ack && ack.ok ? resolve(s) : reject(new Error('register failed'));
      });
    });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

test('AUTH-01: unregistered socket cannot send messages (no anonymous publish)', async () => {
  const bob = genWallet();
  const env = encrypt('hi', bob.publicKey, genWallet().secretKey);
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  await once(s, 'connect');
  const ack = await new Promise((r) =>
    s.emit('message', { to: bob.publicKey, nonce: env.nonce, ciphertext: env.ciphertext }, r),
  );
  assert.equal(ack.ok, false);
  assert.equal(ack.error, 'not_registered');
  s.close();
});

test('AUTH-02: server stamps `from` with the registered identity (sender cannot impersonate)', async () => {
  const alice = genWallet();
  const mallory = genWallet();
  const bob = genWallet();
  const m = await connect(mallory);
  const b = await connect(bob);

  // Mallory tries to send a message claiming to be Alice. The server should
  // ignore client-supplied `from` and stamp the registered identity.
  const got = new Promise((resolve) => b.once('message', resolve));
  const env = encrypt('imposter', bob.publicKey, mallory.secretKey);
  await new Promise((r) =>
    m.emit('message', {
      to: bob.publicKey,
      nonce: env.nonce,
      ciphertext: env.ciphertext,
      from: alice.publicKey, // attempted forgery
    }, r),
  );
  const wire = await got;
  assert.equal(wire.from, mallory.publicKey, 'server must use the registered identity, not the forged from');

  m.close();
  b.close();
});

test('AUTH-03: only the intended recipient can decrypt — third parties get null', async () => {
  const alice = genWallet();
  const bob = genWallet();
  const eve = genWallet();
  const env = encrypt('confidential', bob.publicKey, alice.secretKey);

  function open(receiverSec) {
    const opened = nacl.box.open(
      u.decodeBase64(env.ciphertext),
      u.decodeBase64(env.nonce),
      u.decodeBase64(alice.publicKey),
      u.decodeBase64(receiverSec),
    );
    return opened;
  }
  assert.ok(open(bob.secretKey), 'bob can decrypt');
  assert.equal(open(eve.secretKey), null, 'eve cannot decrypt');
});

test('AUTH-04: recipient routing is locked to the destination pubkey (no cross-delivery)', async () => {
  const alice = genWallet();
  const bob = genWallet();
  const carol = genWallet();
  const a = await connect(alice);
  const b = await connect(bob);
  const c = await connect(carol);

  // Alice → Bob. Carol must not receive it.
  const carolGot = [];
  c.on('message', (env) => carolGot.push(env));

  const env = encrypt('only for bob', bob.publicKey, alice.secretKey);
  const bobGot = new Promise((r) => b.once('message', r));
  await new Promise((r) =>
    a.emit('message', { to: bob.publicKey, nonce: env.nonce, ciphertext: env.ciphertext }, r),
  );
  await bobGot;
  // Give the relay a moment to (incorrectly) cross-deliver if buggy.
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(carolGot.length, 0, 'unrelated recipient must not receive the envelope');

  a.close(); b.close(); c.close();
});

test('AUTH-05: register changes presence ownership (re-registering replaces identity)', async () => {
  const w1 = genWallet();
  const w2 = genWallet();
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  await once(s, 'connect');
  await new Promise((r) => s.emit('register', { pubKey: w1.publicKey }, r));

  // Re-register with a different pubkey — server should release w1 and bind w2.
  await new Promise((r) => s.emit('register', { pubKey: w2.publicKey }, r));

  // Independent observer checks both presences.
  const observer = io(URL, { transports: ['websocket'], reconnection: false });
  await once(observer, 'connect');
  const w1online = await new Promise((r) => observer.emit('presence:check', { pubKey: w1.publicKey }, r));
  const w2online = await new Promise((r) => observer.emit('presence:check', { pubKey: w2.publicKey }, r));
  assert.equal(w1online.online, false, 'w1 must be released after re-register');
  assert.equal(w2online.online, true, 'w2 must be bound after re-register');

  s.close();
  observer.close();
});

test('AUTH-06: invalid registration is rejected (no identity = no privileges)', async () => {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  await once(s, 'connect');
  const ack = await new Promise((r) => s.emit('register', { pubKey: 'bogus' }, r));
  assert.equal(ack.ok, false);
  assert.equal(ack.error, 'invalid_pubkey');
  s.close();
});
