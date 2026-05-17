/**
 * crypto.ts — Recode IT zero-knowledge client-side crypto (Phase 3).
 *
 * R-04 (OPEN_RISKS.md §"AES-GCM correctness", "highest priority before
 * writing the first commit") mitigations are MANDATORY and audited by the
 * crypto.test.ts suite. The four guarantees this module enforces:
 *
 *   1. Nonce is generated FRESH on every encryptMapping() call via
 *      crypto.getRandomValues(new Uint8Array(12)). Never hard-coded,
 *      never derived from a counter, never reused. (Reusing a nonce with
 *      the same key on different plaintexts breaks AES-GCM
 *      confidentiality catastrophically.)
 *   2. decryptMapping() with a key derived from a DIFFERENT password (or
 *      different salt) throws — never returns a "decoded" garbage Map.
 *   3. Tampering one byte of the ciphertext throws (GCM auth tag).
 *   4. Tampering one byte of the nonce throws (the AAD-bound 12-byte
 *      prefix is integrity-protected by being fed to AES-GCM as IV).
 *
 * KDF: Argon2id (RFC 9106) via @noble/hashes — 64 MiB memory, 3
 * iterations, parallelism 1, 32-byte output. Matches the server-stored
 * `kdf_salt` returned at signup/login. The Argon2 output is used as the
 * AES-256-GCM key directly (no additional HKDF — the design memo allows
 * either; we keep the simpler one-step path).
 *
 * Blob wire format:
 *
 *   bytes  0..12   nonce (12 bytes, random per encryption)
 *   bytes 12..N    ciphertext || 16-byte GCM auth tag (concatenated by
 *                  WebCrypto's AES-GCM output)
 *
 * Both halves travel server-side as base64; the server treats the whole
 * thing as opaque bytes.
 */

import { argon2id } from '@noble/hashes/argon2'

const NONCE_LENGTH = 12
const KEY_LENGTH = 32

// Tuned per DESIGN.md §5.1. Browser-acceptable: ~0.5-1s on a 2022 laptop.
// We keep these in a single export so future tuning is centralized.
export const ARGON2_PARAMS = Object.freeze({
  m: 64 * 1024, // 64 MiB
  t: 3,
  p: 1,
  dkLen: KEY_LENGTH,
})

/** Derive an AES-GCM key from the user's password + server-supplied salt. */
export async function deriveKey(password: string, saltHex: string): Promise<CryptoKey> {
  if (!password) {
    throw new Error('deriveKey: password is empty')
  }
  const salt = hexToBytes(saltHex)
  if (salt.length !== 16) {
    throw new Error(`deriveKey: expected 16-byte salt, got ${salt.length}`)
  }
  const passwordBytes = new TextEncoder().encode(password)
  const raw = argon2id(passwordBytes, salt, ARGON2_PARAMS)
  // Copy into a fresh ArrayBuffer so TS lib.dom (BufferSource) accepts it.
  // @noble/hashes can return Uint8Array<SharedArrayBuffer> in some builds.
  const rawCopy = new Uint8Array(raw.length)
  rawCopy.set(raw)
  // SubtleCrypto.importKey requires a non-extractable, AES-GCM-tagged key.
  return crypto.subtle.importKey('raw', rawCopy, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Encrypt a mapping (`Map<string, string>` of pseudonym → original) with the
 * given AES-GCM key. Returns `nonce || ciphertext || tag`. Nonce is random
 * per call (R-04 mitigation #1).
 */
export async function encryptMapping(
  mapping: Map<string, string>,
  key: CryptoKey,
): Promise<Uint8Array> {
  const json = JSON.stringify(Array.from(mapping.entries()))
  const plaintext = new TextEncoder().encode(json)
  // Generate a fresh nonce on every call. THE single most important AES-GCM
  // invariant; tested explicitly in crypto.test.ts.
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH))
  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext),
  )
  const out = new Uint8Array(NONCE_LENGTH + ciphertextWithTag.length)
  out.set(nonce, 0)
  out.set(ciphertextWithTag, NONCE_LENGTH)
  return out
}

/**
 * Decrypt a blob produced by `encryptMapping`. Throws on any failure
 * (wrong key, tampered nonce, tampered ciphertext, truncated blob).
 *
 * R-04 mitigation: this function does NOT swallow errors. A failed decrypt
 * must always propagate so the UI can show the correct "wrong password"
 * message rather than silently rendering a malformed mapping.
 */
export async function decryptMapping(
  blob: Uint8Array,
  key: CryptoKey,
): Promise<Map<string, string>> {
  if (blob.length < NONCE_LENGTH + 16) {
    throw new Error('decryptMapping: blob too short')
  }
  const nonce = blob.slice(0, NONCE_LENGTH)
  const ciphertextWithTag = blob.slice(NONCE_LENGTH)
  // Any tampering with nonce/ciphertext/tag fails here (GCM auth check).
  // Wrong key also fails here. We propagate the WebCrypto error.
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertextWithTag,
  )
  const json = new TextDecoder().decode(plaintext)
  const entries = JSON.parse(json) as Array<[string, string]>
  if (!Array.isArray(entries)) {
    throw new Error('decryptMapping: payload is not a mapping array')
  }
  return new Map(entries)
}

// --- helpers ---------------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]!)
  }
  if (typeof btoa !== 'undefined') return btoa(s)
  // Node fallback for tests.
  return Buffer.from(bytes).toString('base64')
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hexToBytes: odd-length hex string')
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, '0')
  }
  return s
}

export const __INTERNAL__ = { NONCE_LENGTH, KEY_LENGTH }
