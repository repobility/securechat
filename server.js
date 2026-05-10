/**
 * SecureChat relay — entry point.
 *
 * The relay is a dumb router. It sees only ciphertext + routing metadata
 * (sender pubkey, recipient pubkey, nonce). It cannot read messages because
 * it never holds any private keys; all encryption / decryption happens in
 * the browser using the user's wallet keypair.
 *
 * Authentication model: identity is established cryptographically via a
 * wallet (X25519 keypair) held by the client — there is no JWT, OAuth, or
 * password-based auth library. See .repobility/access.yml and
 * docs/PROTOCOL.md.
 *
 * This file wires the pieces together. The interesting logic lives in
 *
 *   src/validation.js    wire-payload predicates
 *   src/presence.js      pubkey → live-socket registry
 *   src/offline-queue.js bounded per-recipient envelope buffer
 *   src/handlers.js      Socket.IO event handlers
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { PresenceRegistry } = require('./src/presence');
const { OfflineQueue } = require('./src/offline-queue');
const { attachHandlers } = require('./src/handlers');

const DEFAULTS = {
  PORT: 3000,
  HOST: '127.0.0.1',
  MAX_HTTP_BUFFER_BYTES: 128 * 1024,
  PING_INTERVAL_MS: 20000,
  PING_TIMEOUT_MS: 25000,
  OFFLINE_QUEUE_LIMIT: 200,
};

/**
 * Build the Express app, HTTP server, and Socket.IO server, wire all
 * routes and handlers, and return the resulting trio. Pure construction —
 * does not call `listen`.
 *
 * @returns {{ app: import('express').Express,
 *            server: import('http').Server,
 *            io: import('socket.io').Server,
 *            presence: PresenceRegistry,
 *            queue: OfflineQueue }}
 */
function createServer() {
  const presence = new PresenceRegistry();
  const queue = new OfflineQueue({ limitPerRecipient: DEFAULTS.OFFLINE_QUEUE_LIMIT });

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: DEFAULTS.MAX_HTTP_BUFFER_BYTES,
    pingInterval: DEFAULTS.PING_INTERVAL_MS,
    pingTimeout: DEFAULTS.PING_TIMEOUT_MS,
  });

  registerStaticRoutes(app);
  registerVendorRoutes(app);
  registerHealthRoute(app, presence);

  io.on('connection', (socket) => {
    attachHandlers({ io, socket, presence, queue });
  });

  return { app, server, io, presence, queue };
}

/**
 * Mount the static frontend. `dotfiles: 'allow'` is required so
 * /.well-known/security.txt (RFC 9116) is served alongside the rest.
 *
 * @param {import('express').Express} app
 */
function registerStaticRoutes(app) {
  app.use(
    express.static(path.join(__dirname, 'public'), {
      extensions: ['html'],
      dotfiles: 'allow',
    }),
  );
}

/**
 * NaCl libraries served straight from node_modules so the browser doesn't
 * depend on a CDN.
 *
 * Consumed by:
 *   public/index.html — `<script src="/vendor/nacl/nacl.min.js">`
 *   public/index.html — `<script src="/vendor/nacl/nacl-util.min.js">`
 *
 * @param {import('express').Express} app
 */
function registerVendorRoutes(app) {
  app.get('/vendor/nacl/nacl.min.js', (_req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules/tweetnacl/nacl.min.js'));
  });
  app.get('/vendor/nacl/nacl-util.min.js', (_req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules/tweetnacl-util/nacl-util.min.js'));
  });
}

/**
 * Liveness probe. Returns the number of distinct identities that
 * currently have at least one live socket.
 *
 * @param {import('express').Express} app
 * @param {PresenceRegistry} presence
 */
function registerHealthRoute(app, presence) {
  app.get('/healthz', (_req, res) => res.json({ ok: true, online: presence.size() }));
}

/**
 * Bind the HTTP server and start accepting connections.
 *
 * @param {import('http').Server} server
 * @param {number} port
 * @param {string} host
 * @returns {Promise<void>} resolves once the server is listening.
 */
function listen(server, port, host) {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      process.stdout.write(`SecureChat relay listening on http://${host}:${port}\n`);
      resolve();
    });
  });
}

// When this file is invoked directly (`node server.js`), boot the relay.
// When required from a test, it exports the factory functions instead so
// callers can spin up isolated instances.
if (require.main === module) {
  const port = Number(process.env.PORT) || DEFAULTS.PORT;
  const host = process.env.HOST || DEFAULTS.HOST;
  const { server } = createServer();
  listen(server, port, host);
}

module.exports = {
  DEFAULTS,
  createServer,
  registerStaticRoutes,
  registerVendorRoutes,
  registerHealthRoute,
  listen,
};
