/**
 * Server (relay) tests.
 *
 * Boots the real server on an ephemeral port and exercises it with two
 * socket.io-client connections, asserting the cryptographic invariants from
 * the relay's perspective:
 *   - the server cannot read messages
 *   - it rejects malformed payloads
 *   - it queues messages for offline recipients and drains on register
 *   - it broadcasts presence transitions
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const nacl = require('tweetnacl');
const u = require('tweetnacl-util');
const { io } = require('socket.io-client');

const PORT = 3300 + Math.floor(Math.random() * 200);
const URL = `http://127.0.0.1:${PORT}`;

let server;

test.before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Wait until the server prints its "listening" line.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 8000);
    server.stdout.on('data', (buf) => {
      if (buf.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (buf) => process.stderr.write(buf));
  });
});

test.after(async () => {
  if (!server) return;
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
});

function genWallet() {
  const kp = nacl.box.keyPair();
  return { publicKey: u.encodeBase64(kp.publicKey), secretKey: u.encodeBase64(kp.secretKey), kp };
}

function encrypt(text, recipientPub, senderSec) {
  const msg = u.decodeUTF8(JSON.stringify({ v: 1, t: text, ts: Date.now() }));
  const nonce = nacl.randomBytes(24);
  const ct = nacl.box(msg, nonce, u.decodeBase64(recipientPub), u.decodeBase64(senderSec));
  return { nonce: u.encodeBase64(nonce), ciphertext: u.encodeBase64(ct) };
}

function decrypt(ctB64, nonceB64, senderPub, recipientSec) {
  const opened = nacl.box.open(
    u.decodeBase64(ctB64),
    u.decodeBase64(nonceB64),
    u.decodeBase64(senderPub),
    u.decodeBase64(recipientSec),
  );
  return opened ? JSON.parse(u.encodeUTF8(opened)) : null;
}

function connect(wallet) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    const t = setTimeout(() => reject(new Error('connect timeout')), 4000);
    s.on('connect', () => {
      clearTimeout(t);
      s.emit('register', { pubKey: wallet.publicKey }, (ack) => {
        if (!ack || !ack.ok) return reject(new Error('register failed'));
        resolve(s);
      });
    });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

test('healthz returns ok', async () => {
  const res = await fetch(`${URL}/healthz`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.online, 'number');
});

test('encrypted message is delivered and the wire payload contains no plaintext', async () => {
  const alice = genWallet();
  const bob = genWallet();
  const a = await connect(alice);
  const b = await connect(bob);

  const got = new Promise((resolve) => b.once('message', resolve));
  const plaintext = 'this string MUST NOT appear on the wire ' + Math.random();
  const env = encrypt(plaintext, bob.publicKey, alice.secretKey);

  const ack = await new Promise((resolve) =>
    a.emit('message', { to: bob.publicKey, nonce: env.nonce, ciphertext: env.ciphertext }, resolve),
  );
  assert.equal(ack.ok, true);
  assert.equal(ack.delivered, true);

  const wire = await got;
  // The relay sees ciphertext + routing metadata only.
  const wireString = JSON.stringify(wire);
  assert.equal(wireString.includes(plaintext), false, 'plaintext leaked on the wire');
  assert.equal(wire.from, alice.publicKey);
  assert.equal(wire.to, bob.publicKey);

  const dec = decrypt(wire.ciphertext, wire.nonce, wire.from, bob.secretKey);
  assert.ok(dec);
  assert.equal(dec.t, plaintext);

  a.close();
  b.close();
});

test('server rejects malformed pubkey, nonce, and ciphertext', async () => {
  const alice = genWallet();
  const bob = genWallet();
  const a = await connect(alice);
  const env = encrypt('x', bob.publicKey, alice.secretKey);

  const badRecipient = await new Promise((r) =>
    a.emit('message', { to: 'not-a-pubkey', nonce: env.nonce, ciphertext: env.ciphertext }, r),
  );
  assert.equal(badRecipient.ok, false);
  assert.equal(badRecipient.error, 'invalid_recipient');

  const badNonce = await new Promise((r) =>
    a.emit('message', { to: bob.publicKey, nonce: 'short', ciphertext: env.ciphertext }, r),
  );
  assert.equal(badNonce.ok, false);
  assert.equal(badNonce.error, 'invalid_nonce');

  const badCt = await new Promise((r) =>
    a.emit('message', { to: bob.publicKey, nonce: env.nonce, ciphertext: '' }, r),
  );
  assert.equal(badCt.ok, false);
  assert.equal(badCt.error, 'invalid_ciphertext');

  a.close();
});

test('server rejects message events from un-registered sockets', async () => {
  const alice = genWallet();
  const bob = genWallet();
  const env = encrypt('x', bob.publicKey, alice.secretKey);
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  await once(s, 'connect');
  const ack = await new Promise((r) =>
    s.emit('message', { to: bob.publicKey, nonce: env.nonce, ciphertext: env.ciphertext }, r),
  );
  assert.equal(ack.ok, false);
  assert.equal(ack.error, 'not_registered');
  s.close();
});

test('messages to an offline recipient are queued and delivered on register', async () => {
  const alice = genWallet();
  const carol = genWallet();
  const a = await connect(alice);
  const env = encrypt('queued hi', carol.publicKey, alice.secretKey);
  const ack = await new Promise((r) =>
    a.emit('message', { to: carol.publicKey, nonce: env.nonce, ciphertext: env.ciphertext }, r),
  );
  assert.equal(ack.ok, true);
  assert.equal(ack.queued, true);
  assert.equal(ack.delivered, false);

  // Carol comes online — should immediately receive the queued envelope.
  // We attach the listener BEFORE register so we don't race the queue drain.
  const c = io(URL, { transports: ['websocket'], reconnection: false });
  await once(c, 'connect');
  const wirePromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('queued message never arrived')), 3000);
    c.on('message', (env) => { clearTimeout(t); resolve(env); });
  });
  await new Promise((r) => c.emit('register', { pubKey: carol.publicKey }, r));
  const wire = await wirePromise;
  const dec = decrypt(wire.ciphertext, wire.nonce, wire.from, carol.secretKey);
  assert.equal(dec.t, 'queued hi');
  a.close();
  c.close();
});

test('presence broadcasts on connect and disconnect', async () => {
  const dave = genWallet();
  const erin = genWallet();
  const d = await connect(dave);

  const onlineEvent = new Promise((resolve) => {
    d.on('presence', (p) => { if (p.pubKey === erin.publicKey && p.online) resolve(p); });
  });
  const e = await connect(erin);
  await onlineEvent;

  const offlineEvent = new Promise((resolve) => {
    d.on('presence', (p) => { if (p.pubKey === erin.publicKey && !p.online) resolve(p); });
  });
  e.close();
  await offlineEvent;
  d.close();
});

test('presence:check returns the live state of a pubkey', async () => {
  const f = genWallet();
  const g = genWallet();
  const fs = await connect(f);

  const offline = await new Promise((r) => fs.emit('presence:check', { pubKey: g.publicKey }, r));
  assert.equal(offline.ok, true);
  assert.equal(offline.online, false);

  const gs = await connect(g);
  const online = await new Promise((r) => fs.emit('presence:check', { pubKey: g.publicKey }, r));
  assert.equal(online.online, true);

  fs.close();
  gs.close();
});
