/**
 * Wire-payload validation. The relay never trusts client input — these
 * predicates run before any state is mutated.
 *
 * `pubKey`     32-byte X25519 key, base64 (44 chars).
 * `nonce`      24-byte NaCl box nonce, base64.
 * `ciphertext` non-empty base64, capped to keep memory bounded.
 */

const MAX_CIPHERTEXT_BYTES = 64 * 1024;

const PUBKEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const NONCE_RE = /^[A-Za-z0-9+/]{32}={0,2}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * @param {unknown} s
 * @returns {boolean}
 */
const isValidPubKey = (s) => typeof s === 'string' && PUBKEY_RE.test(s);

/**
 * @param {unknown} s
 * @returns {boolean}
 */
const isValidNonce = (s) => typeof s === 'string' && NONCE_RE.test(s);

/**
 * @param {unknown} s
 * @returns {boolean}
 */
const isValidCiphertext = (s) =>
  typeof s === 'string' && s.length > 0 && s.length <= MAX_CIPHERTEXT_BYTES && B64_RE.test(s);

module.exports = {
  MAX_CIPHERTEXT_BYTES,
  PUBKEY_RE,
  NONCE_RE,
  B64_RE,
  isValidPubKey,
  isValidNonce,
  isValidCiphertext,
};
