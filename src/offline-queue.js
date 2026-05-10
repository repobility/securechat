/**
 * Bounded per-recipient FIFO of envelopes for pubkeys that are not currently
 * online. Drained synchronously when the recipient registers.
 *
 * Memory is bounded by `limitPerRecipient` × number of distinct offline
 * pubkeys; the oldest envelope is evicted when the per-recipient cap is hit.
 *
 * @typedef {{ from: string, to: string, nonce: string, ciphertext: string, ts: number }} Envelope
 */

class OfflineQueue {
  /**
   * @param {{ limitPerRecipient?: number }} [options]
   */
  constructor({ limitPerRecipient = 200 } = {}) {
    /** @type {Map<string, Envelope[]>} */
    this._byPubKey = new Map();
    this._limit = limitPerRecipient;
  }

  /**
   * @param {string} pubKey
   * @param {Envelope} envelope
   */
  push(pubKey, envelope) {
    let q = this._byPubKey.get(pubKey);
    if (!q) {
      q = [];
      this._byPubKey.set(pubKey, q);
    }
    q.push(envelope);
    if (q.length > this._limit) q.shift();
  }

  /**
   * Returns and removes all envelopes queued for `pubKey`.
   * @param {string} pubKey
   * @returns {Envelope[]}
   */
  drain(pubKey) {
    const q = this._byPubKey.get(pubKey) || [];
    this._byPubKey.delete(pubKey);
    return q;
  }
}

module.exports = { OfflineQueue };
