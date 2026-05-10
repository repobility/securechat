/**
 * SecureChat relay — entry point.
 *
 * The relay is a dumb router. It sees only ciphertext + routing metadata
 * (sender pubkey, recipient pubkey, nonce). It cannot read messages because
 * it never holds any private keys; all encryption / decryption happens in
 * the browser using the user's wallet keypair.
 *
 * This file wires the pieces together. The interesting logic lives in
 *
 *   src/validation.js   wire-payload predicates
 *   src/presence.js     pubkey → live-socket registry
 *   src/offline-queue.js bounded per-recipient envelope buffer
 *   src/handlers.js     Socket.IO event handlers
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { PresenceRegistry } = require('./src/presence');
const { OfflineQueue } = require('./src/offline-queue');
const { attachHandlers } = require('./src/handlers');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const presence = new PresenceRegistry();
const queue = new OfflineQueue({ limitPerRecipient: 200 });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 128 * 1024,
  pingInterval: 20000,
  pingTimeout: 25000,
});

// Static frontend. dotfiles: 'allow' so /.well-known/security.txt (RFC 9116)
// is served alongside the rest.
app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    dotfiles: 'allow',
  }),
);

// NaCl libraries served straight from node_modules so the browser doesn't
// need a CDN.
app.get('/vendor/nacl/nacl.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/tweetnacl/nacl.min.js'));
});
app.get('/vendor/nacl/nacl-util.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/tweetnacl-util/nacl-util.min.js'));
});

app.get('/healthz', (_req, res) => res.json({ ok: true, online: presence.size() }));

io.on('connection', (socket) => {
  attachHandlers({ io, socket, presence, queue });
});

server.listen(PORT, HOST, () => {
  console.log(`SecureChat relay listening on http://${HOST}:${PORT}`);
});
