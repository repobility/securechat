/**
 * Crypto helpers built on TweetNaCl.
 *
 *   Identity / wallet  : nacl.box.keyPair()  ->  X25519 keypair (32-byte pub, 32-byte priv)
 *   Encryption         : nacl.box  (X25519 ECDH + XSalsa20-Poly1305 authenticated encryption)
 *
 * All keys, nonces, and ciphertexts are exchanged on the wire as base64 strings.
 * Plaintext is UTF-8 JSON: { v: 1, t: "<text>", ts: <number> }.
 *
 * The server only ever sees ciphertext + sender/recipient pubkeys + nonce.
 */
(function () {
  'use strict';

  const util = window.nacl_util || window.naclUtil;
  if (!window.nacl || !util) {
    throw new Error('TweetNaCl libraries failed to load');
  }

  const PROTO_VERSION = 1;
  const MAX_PLAINTEXT_BYTES = 16 * 1024;

  /**
   * @typedef {{ publicKey: string, secretKey: string }} Wallet
   *   Both fields are base64-encoded 32-byte X25519 keys.
   */

  /**
   * @typedef {{ nonce: string, ciphertext: string }} EncryptedEnvelope
   *   Both fields are base64-encoded; ciphertext includes the Poly1305 MAC.
   */

  /**
   * Generate a fresh X25519 keypair.
   * @returns {Wallet}
   */
  function generateWallet() {
    const kp = nacl.box.keyPair();
    return {
      publicKey: util.encodeBase64(kp.publicKey),
      secretKey: util.encodeBase64(kp.secretKey),
    };
  }

  /**
   * Restore a wallet from a previously-saved secret key.
   * @param {string} secretKeyB64 — base64-encoded 32-byte X25519 secret key.
   * @returns {Wallet}
   * @throws if the input is not exactly 32 bytes after base64 decoding.
   */
  function walletFromSecretKey(secretKeyB64) {
    const sk = util.decodeBase64(secretKeyB64.trim());
    if (sk.length !== nacl.box.secretKeyLength) {
      throw new Error('Secret key must be 32 bytes (44 base64 chars).');
    }
    const kp = nacl.box.keyPair.fromSecretKey(sk);
    return {
      publicKey: util.encodeBase64(kp.publicKey),
      secretKey: util.encodeBase64(kp.secretKey),
    };
  }

  /**
   * Length-checking validator for X25519 public keys on the wire.
   * @param {unknown} b64
   * @returns {boolean}
   */
  function isValidPublicKey(b64) {
    if (typeof b64 !== 'string') return false;
    try {
      const bytes = util.decodeBase64(b64.trim());
      return bytes.length === nacl.box.publicKeyLength;
    } catch (_) {
      return false;
    }
  }

  /**
   * Short identifier suitable for displaying a pubkey in a contact card.
   * Deterministic given the input, lossy by design — never use for
   * cryptographic comparisons.
   * @param {string} pubKeyB64
   * @returns {string}
   */
  function fingerprint(pubKeyB64) {
    if (!pubKeyB64) return '';
    const s = pubKeyB64.replace(/=+$/, '');
    return `${s.slice(0, 6)}…${s.slice(-6)}`;
  }

  /**
   * Encrypt a plaintext string for `recipientPubKey` using the sender's
   * wallet. The plaintext is wrapped in a versioned inner envelope
   * `{ v: 1, t, ts }` so the protocol can evolve.
   *
   * @param {string} plaintext        Up to 16 KiB of UTF-8 text.
   * @param {string} recipientPubKey  Base64 X25519 public key.
   * @param {string} senderSecretKey  Base64 X25519 secret key.
   * @returns {EncryptedEnvelope}
   * @throws if plaintext is too long, not a string, or encryption fails.
   */
  function encryptMessage(plaintext, recipientPubKey, senderSecretKey) {
    if (typeof plaintext !== 'string') throw new Error('plaintext must be a string');
    if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('message too long');

    const payload = JSON.stringify({ v: PROTO_VERSION, t: plaintext, ts: Date.now() });
    const msgBytes = util.decodeUTF8(payload);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const recipient = util.decodeBase64(recipientPubKey);
    const sk = util.decodeBase64(senderSecretKey);

    const ciphertext = nacl.box(msgBytes, nonce, recipient, sk);
    if (!ciphertext) throw new Error('encryption failed');

    return {
      nonce: util.encodeBase64(nonce),
      ciphertext: util.encodeBase64(ciphertext),
    };
  }

  /**
   * Decrypt a ciphertext from `senderPubKey` using the receiver's wallet.
   *
   * Returns null on every failure mode (forged sender, wrong recipient,
   * tampered nonce or ciphertext, bad inner envelope). Callers cannot
   * distinguish — by design, so error oracles cannot help an attacker.
   *
   * @param {string} ciphertextB64
   * @param {string} nonceB64
   * @param {string} senderPubKey
   * @param {string} receiverSecretKey
   * @returns {{ text: string, ts: number } | null}
   */
  function decryptMessage(ciphertextB64, nonceB64, senderPubKey, receiverSecretKey) {
    try {
      const ct = util.decodeBase64(ciphertextB64);
      const nonce = util.decodeBase64(nonceB64);
      const sender = util.decodeBase64(senderPubKey);
      const sk = util.decodeBase64(receiverSecretKey);
      const opened = nacl.box.open(ct, nonce, sender, sk);
      if (!opened) return null;
      const json = util.encodeUTF8(opened);
      const obj = JSON.parse(json);
      if (!obj || obj.v !== PROTO_VERSION || typeof obj.t !== 'string') return null;
      return { text: obj.t, ts: typeof obj.ts === 'number' ? obj.ts : Date.now() };
    } catch (_) {
      return null;
    }
  }

  /**
   * Deterministic 2-letter avatar initials and an HSL background color
   * derived from a public key. Pure function of the pubkey so a contact
   * is recognizable even before a display name is set.
   *
   * Not security-relevant — the hash is a tiny FNV-style accumulator and
   * MUST NOT be used for any cryptographic purpose.
   *
   * @param {string} pubKeyB64
   * @returns {{ initials: string, bg: string }}
   */
  function avatarFor(pubKeyB64) {
    let hash = 0;
    for (let i = 0; i < pubKeyB64.length; i++) {
      hash = (hash * 31 + pubKeyB64.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    const initials = pubKeyB64
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 2)
      .toUpperCase();
    return {
      initials,
      bg: `hsl(${hue}, 55%, 38%)`,
    };
  }

  window.SC_Crypto = {
    generateWallet,
    walletFromSecretKey,
    isValidPublicKey,
    fingerprint,
    encryptMessage,
    decryptMessage,
    avatarFor,
    MAX_PLAINTEXT_BYTES,
  };
})();
