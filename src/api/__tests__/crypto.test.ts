/**
 * crypto.test.ts — R-04 mitigation audit suite.
 *
 * Per OPEN_RISKS.md §R-04, the zero-knowledge claim of Recode IT rests
 * entirely on the correctness of the four invariants encoded by
 * src/api/crypto.ts. These four tests are NON-NEGOTIABLE and gate every
 * commit that touches the crypto module:
 *
 *   1. Nonce uniqueness — 100 successive encryptions of the SAME plaintext
 *      with the SAME key produce 100 DISTINCT ciphertexts. (Nonce reuse in
 *      AES-GCM catastrophically breaks confidentiality, allowing key
 *      recovery from two messages sharing an IV.)
 *
 *   2. Wrong-key rejection — decrypting with a key derived from a DIFFERENT
 *      password throws an exception. The function must NEVER silently
 *      return a "decoded" but meaningless Map; the UI relies on the throw
 *      to display "password sbagliata" rather than corrupt data.
 *
 *   3. Tampering detection (ciphertext) — flipping a single byte of the
 *      ciphertext causes decrypt() to throw (GCM auth tag verification).
 *
 *   4. Round-trip — encrypting then decrypting the same Map with the same
 *      key returns a Map with identical entries.
 *
 * In addition we cover the nonce-tamper case (which is technically R-04
 * mitigation #4 from the module header) as a bonus — same family of
 * guarantee, costs ~one line.
 *
 * These tests use the real WebCrypto + @noble/hashes Argon2id stack. They
 * are slow (Argon2id 64 MiB × 3 iter on a laptop is ~0.5-1s per derive) so
 * we cache one derived key per password across the file.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bytesToBase64,
  bytesToHex,
  base64ToBytes,
  decryptMapping,
  deriveKey,
  encryptMapping,
  hexToBytes,
} from '../crypto'

const SALT_HEX_A = '0123456789abcdef0123456789abcdef'
const SALT_HEX_B = 'fedcba9876543210fedcba9876543210'

let keyA: CryptoKey
let keyAWithDifferentPassword: CryptoKey
let keyAWithDifferentSalt: CryptoKey

function sampleMapping(): Map<string, string> {
  return new Map<string, string>([
    ['Tizio', 'Mario Rossi'],
    ['Caio', 'Erminia Vanzetti'],
    ['Alfa S.r.l.', 'Acme S.r.l.'],
  ])
}

beforeAll(async () => {
  // One slow Argon2id derive per distinct (password, salt) pair, shared
  // across the tests to keep the suite under 10s.
  keyA = await deriveKey('corretta password segreta', SALT_HEX_A)
  keyAWithDifferentPassword = await deriveKey(
    'completely different password',
    SALT_HEX_A,
  )
  keyAWithDifferentSalt = await deriveKey('corretta password segreta', SALT_HEX_B)
}, 30_000)

afterAll(() => {
  // Nothing to tear down — keys live in memory only and are garbage-collected.
})

describe('crypto: round-trip (R-04 #4)', () => {
  it('encrypts then decrypts to the same Map', async () => {
    const original = sampleMapping()
    const blob = await encryptMapping(original, keyA)
    const round = await decryptMapping(blob, keyA)
    expect(round.size).toBe(original.size)
    for (const [k, v] of original) {
      expect(round.get(k)).toBe(v)
    }
  })

  it('supports empty mappings', async () => {
    const empty = new Map<string, string>()
    const blob = await encryptMapping(empty, keyA)
    const round = await decryptMapping(blob, keyA)
    expect(round.size).toBe(0)
  })
})

describe('crypto: nonce uniqueness (R-04 #1 — MOST CRITICAL)', () => {
  it('produces 100 distinct ciphertexts for the same plaintext+key', async () => {
    // We assert two related things:
    //   - the 12-byte nonce prefix is distinct across all 100 outputs
    //   - the full blob is distinct across all 100 outputs (sanity check
    //     against a hypothetical bug where the nonce changes but the
    //     ciphertext is deterministic, which shouldn't be possible with
    //     AES-GCM but the assertion is cheap)
    const mapping = sampleMapping()
    const nonces = new Set<string>()
    const blobs = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const blob = await encryptMapping(mapping, keyA)
      const nonceHex = bytesToHex(blob.slice(0, 12))
      const blobHex = bytesToHex(blob)
      nonces.add(nonceHex)
      blobs.add(blobHex)
    }
    expect(nonces.size).toBe(100)
    expect(blobs.size).toBe(100)
  }, 30_000)
})

describe('crypto: wrong-key rejection (R-04 #2)', () => {
  it('throws when decrypted with a key from a different password', async () => {
    const blob = await encryptMapping(sampleMapping(), keyA)
    await expect(decryptMapping(blob, keyAWithDifferentPassword)).rejects.toThrow()
  })

  it('throws when decrypted with a key from a different salt', async () => {
    const blob = await encryptMapping(sampleMapping(), keyA)
    await expect(decryptMapping(blob, keyAWithDifferentSalt)).rejects.toThrow()
  })
})

describe('crypto: tampering detection (R-04 #3)', () => {
  it('throws when one byte of the ciphertext is flipped', async () => {
    const blob = await encryptMapping(sampleMapping(), keyA)
    // Mutate a byte inside the ciphertext region (after the 12-byte nonce
    // and before the last 16 bytes of GCM tag — but actually flipping any
    // byte AT OR AFTER position 12 must fail. Pick the middle.)
    const tampered = new Uint8Array(blob)
    const idx = 12 + Math.floor((tampered.length - 12) / 2)
    tampered[idx] = tampered[idx]! ^ 0x01
    await expect(decryptMapping(tampered, keyA)).rejects.toThrow()
  })

  it('throws when one byte of the GCM auth tag is flipped', async () => {
    const blob = await encryptMapping(sampleMapping(), keyA)
    const tampered = new Uint8Array(blob)
    // Last byte = part of the 16-byte tag.
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0x80
    await expect(decryptMapping(tampered, keyA)).rejects.toThrow()
  })

  it('throws when one byte of the nonce is flipped', async () => {
    const blob = await encryptMapping(sampleMapping(), keyA)
    const tampered = new Uint8Array(blob)
    tampered[3] = tampered[3]! ^ 0x10
    await expect(decryptMapping(tampered, keyA)).rejects.toThrow()
  })

  it('throws when the blob is truncated below the minimum length', async () => {
    // 12 (nonce) + 16 (tag) = 28 byte floor.
    const truncated = new Uint8Array(20)
    await expect(decryptMapping(truncated, keyA)).rejects.toThrow()
  })
})

describe('crypto: helpers', () => {
  it('hexToBytes / bytesToHex round-trip', () => {
    const h = '00ff10aabb'
    const b = hexToBytes(h)
    expect(bytesToHex(b)).toBe(h)
  })

  it('bytesToBase64 / base64ToBytes round-trip', () => {
    const orig = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255])
    const b64 = bytesToBase64(orig)
    const back = base64ToBytes(b64)
    expect(Array.from(back)).toEqual(Array.from(orig))
  })

  it('deriveKey rejects empty password', async () => {
    await expect(deriveKey('', SALT_HEX_A)).rejects.toThrow()
  })

  it('deriveKey rejects salts that are not 16 bytes', async () => {
    // 4 bytes (8 hex chars) only.
    await expect(deriveKey('whatever password ok', 'deadbeef')).rejects.toThrow()
  })
})
