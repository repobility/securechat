/**
 * SecureChat relay server.
 *
 * Trust model: the server is a dumb relay. It sees only ciphertext + routing
 * metadata (sender pubkey, recipient pubkey, nonce). It cannot read messages,
 * because it never holds any private keys. All encryption/decryption happens
 * in the browser using the user's wallet keypair.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_CIPHERTEXT_BYTES = 64 * 1024; // 64 KiB per message
const OFFLINE_QUEUE_LIMIT = 200; // per-recipient cap

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 128 * 1024,
  pingInterval: 20000,
  pingTimeout: 25000,
});

const PUBKEY_RE = /^[A-Za-z0-9+/]{43}=$/; // 32-byte key, base64
const NONCE_RE = /^[A-Za-z0-9+/]{32}={0,2}$/; // 24-byte nonce, base64
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const isValidPubKey = (s) => typeof s === 'string' && PUBKEY_RE.test(s);
const isValidNonce = (s) => typeof s === 'string' && NONCE_RE.test(s);
const isValidCiphertext = (s) =>
  typeof s === 'string' &&
  s.length > 0 &&
  s.length <= MAX_CIPHERTEXT_BYTES &&
  B64_RE.test(s);

// pubkey -> Set<socketId>
const onlineByPubKey = new Map();
// pubkey -> [{ from, nonce, ciphertext, ts }]
const offlineQueue = new Map();

function addOnline(pubKey, socketId) {
  let set = onlineByPubKey.get(pubKey);
  if (!set) {
    set = new Set();
    onlineByPubKey.set(pubKey, set);
  }
  set.add(socketId);
}

function removeOnline(pubKey, socketId) {
  const set = onlineByPubKey.get(pubKey);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) onlineByPubKey.delete(pubKey);
}

function isOnline(pubKey) {
  return onlineByPubKey.has(pubKey);
}

function emitToPubKey(pubKey, event, payload) {
  const set = onlineByPubKey.get(pubKey);
  if (!set) return false;
  for (const sid of set) io.to(sid).emit(event, payload);
  return true;
}

function broadcastPresence(pubKey, online) {
  io.emit('presence', { pubKey, online });
}

// Static frontend.
// dotfiles: 'allow' so /.well-known/security.txt (RFC 9116) is served.
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  dotfiles: 'allow',
}));

// Serve the NaCl libs straight from node_modules so the browser never depends on a CDN
app.get('/vendor/nacl/nacl.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/tweetnacl/nacl.min.js'));
});
app.get('/vendor/nacl/nacl-util.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/tweetnacl-util/nacl-util.min.js'));
});

app.get('/healthz', (_req, res) => res.json({ ok: true, online: onlineByPubKey.size }));

io.on('connection', (socket) => {
  let identity = null; // pubkey this socket is authenticated as

  socket.on('register', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!payload || !isValidPubKey(payload.pubKey)) {
      return reply({ ok: false, error: 'invalid_pubkey' });
    }
    if (identity && identity !== payload.pubKey) {
      removeOnline(identity, socket.id);
      broadcastPresence(identity, isOnline(identity));
    }
    identity = payload.pubKey;
    addOnline(identity, socket.id);
    broadcastPresence(identity, true);

    // Drain any messages queued while offline
    const queued = offlineQueue.get(identity) || [];
    offlineQueue.delete(identity);
    for (const msg of queued) socket.emit('message', msg);

    reply({ ok: true, delivered: queued.length });
  });

  socket.on('presence:check', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!payload || !isValidPubKey(payload.pubKey)) {
      return reply({ ok: false, error: 'invalid_pubkey' });
    }
    reply({ ok: true, online: isOnline(payload.pubKey) });
  });

  socket.on('message', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!identity) return reply({ ok: false, error: 'not_registered' });
    if (!payload) return reply({ ok: false, error: 'invalid_payload' });

    const { to, nonce, ciphertext } = payload;
    if (!isValidPubKey(to)) return reply({ ok: false, error: 'invalid_recipient' });
    if (!isValidNonce(nonce)) return reply({ ok: false, error: 'invalid_nonce' });
    if (!isValidCiphertext(ciphertext)) return reply({ ok: false, error: 'invalid_ciphertext' });

    const envelope = {
      from: identity,
      to,
      nonce,
      ciphertext,
      ts: Date.now(),
    };

    if (emitToPubKey(to, 'message', envelope)) {
      return reply({ ok: true, delivered: true, ts: envelope.ts });
    }

    // Queue for later delivery
    let q = offlineQueue.get(to);
    if (!q) {
      q = [];
      offlineQueue.set(to, q);
    }
    q.push(envelope);
    if (q.length > OFFLINE_QUEUE_LIMIT) q.shift();
    reply({ ok: true, delivered: false, queued: true, ts: envelope.ts });
  });

  socket.on('typing', (payload) => {
    if (!identity || !payload || !isValidPubKey(payload.to)) return;
    emitToPubKey(payload.to, 'typing', { from: identity, typing: !!payload.typing });
  });

  socket.on('disconnect', () => {
    if (identity) {
      removeOnline(identity, socket.id);
      if (!isOnline(identity)) broadcastPresence(identity, false);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SecureChat relay listening on http://${HOST}:${PORT}`);
});
