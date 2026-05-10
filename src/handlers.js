/**
 * Socket.IO event handlers. The relay never holds private keys and therefore
 * cannot decrypt messages — these handlers route ciphertext, nothing more.
 *
 * `register`        Bind an X25519 identity to this socket. Drains the
 *                   recipient's offline queue if any envelopes are pending.
 * `presence:check`  Ack with the current online status of a pubkey.
 * `message`         Validate an envelope, deliver to all live sockets for
 *                   the recipient, or queue if nobody is online.
 * `typing`          Forward a "typing" indicator (no ack, no persistence).
 * `disconnect`      Release this socket's identity binding.
 */

const { isValidPubKey, isValidNonce, isValidCiphertext } = require('./validation');

/**
 * @param {{
 *   io: import('socket.io').Server,
 *   socket: import('socket.io').Socket,
 *   presence: import('./presence').PresenceRegistry,
 *   queue: import('./offline-queue').OfflineQueue,
 * }} ctx
 */
function attachHandlers({ io, socket, presence, queue }) {
  /** @type {string | null} */
  let identity = null;

  function emitToPubKey(pubKey, event, payload) {
    const set = presence.socketsFor(pubKey);
    if (!set) return false;
    for (const sid of set) io.to(sid).emit(event, payload);
    return true;
  }

  function broadcastPresence(pubKey, online) {
    io.emit('presence', { pubKey, online });
  }

  socket.on('register', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!payload || !isValidPubKey(payload.pubKey)) {
      return reply({ ok: false, error: 'invalid_pubkey' });
    }
    if (identity && identity !== payload.pubKey) {
      presence.remove(identity, socket.id);
      broadcastPresence(identity, presence.isOnline(identity));
    }
    identity = payload.pubKey;
    presence.add(identity, socket.id);
    broadcastPresence(identity, true);

    const queued = queue.drain(identity);
    for (const msg of queued) socket.emit('message', msg);

    reply({ ok: true, delivered: queued.length });
  });

  socket.on('presence:check', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!payload || !isValidPubKey(payload.pubKey)) {
      return reply({ ok: false, error: 'invalid_pubkey' });
    }
    reply({ ok: true, online: presence.isOnline(payload.pubKey) });
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
      from: identity, // server-stamped — clients cannot forge
      to,
      nonce,
      ciphertext,
      ts: Date.now(),
    };

    if (emitToPubKey(to, 'message', envelope)) {
      return reply({ ok: true, delivered: true, ts: envelope.ts });
    }
    queue.push(to, envelope);
    reply({ ok: true, delivered: false, queued: true, ts: envelope.ts });
  });

  socket.on('typing', (payload) => {
    if (!identity || !payload || !isValidPubKey(payload.to)) return;
    emitToPubKey(payload.to, 'typing', { from: identity, typing: !!payload.typing });
  });

  socket.on('disconnect', () => {
    if (identity) {
      presence.remove(identity, socket.id);
      if (!presence.isOnline(identity)) broadcastPresence(identity, false);
    }
  });
}

module.exports = { attachHandlers };
