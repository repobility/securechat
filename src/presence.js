/**
 * Presence registry. Maps each public key to the set of socket IDs that have
 * registered as that identity. A pubkey is "online" iff at least one socket is
 * currently bound to it.
 *
 * Single-process by design — multi-replica deployments need an external
 * pub/sub adapter (Redis, NATS) wired through the same shape.
 */

class PresenceRegistry {
  constructor() {
    /** @type {Map<string, Set<string>>} */
    this._byPubKey = new Map();
  }

  /**
   * @param {string} pubKey
   * @param {string} socketId
   */
  add(pubKey, socketId) {
    let set = this._byPubKey.get(pubKey);
    if (!set) {
      set = new Set();
      this._byPubKey.set(pubKey, set);
    }
    set.add(socketId);
  }

  /**
   * @param {string} pubKey
   * @param {string} socketId
   */
  remove(pubKey, socketId) {
    const set = this._byPubKey.get(pubKey);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this._byPubKey.delete(pubKey);
  }

  /**
   * @param {string} pubKey
   * @returns {boolean}
   */
  isOnline(pubKey) {
    return this._byPubKey.has(pubKey);
  }

  /**
   * @param {string} pubKey
   * @returns {Set<string> | undefined}
   */
  socketsFor(pubKey) {
    return this._byPubKey.get(pubKey);
  }

  /** @returns {number} Total number of distinct pubkeys with at least one live socket. */
  size() {
    return this._byPubKey.size;
  }
}

module.exports = { PresenceRegistry };
