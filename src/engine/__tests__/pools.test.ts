import { describe, it, expect } from 'vitest'
import {
  CITY_POOL,
  COMPANY_POOL,
  PERSON_POOL,
  STREET_POOL,
  VOCAB_RAW,
} from '../pools'
import { VocabAllocator } from '../vocab'

describe('pseudonym pools', () => {
  it('PERSON_POOL is non-empty and starts with vocab JSON entries', () => {
    expect(PERSON_POOL.length).toBeGreaterThan(0)
    expect(PERSON_POOL[0]).toBe('Tizio')
  })

  it('CITY_POOL contains "Metropoli" (present in both vocab + anonymize.py)', () => {
    expect(CITY_POOL).toContain('Metropoli')
  })

  it('COMPANY_POOL starts with "Alfa"', () => {
    expect(COMPANY_POOL[0]).toBe('Alfa')
  })

  it('STREET_POOL has the 12 reference entries', () => {
    expect(STREET_POOL.length).toBe(12)
  })

  it('VOCAB_RAW exposes the three category lists', () => {
    expect(VOCAB_RAW.persona.length).toBeGreaterThan(0)
    expect(VOCAB_RAW.luogo.length).toBeGreaterThan(0)
    expect(VOCAB_RAW.organizzazione.length).toBeGreaterThan(0)
  })

  it('union semantics: anonymize.py-only entries appear after vocab entries', () => {
    // "Aureliano" is in anonymize.py's PERSON_POOL but NOT in the JSON; it
    // should still appear in the merged pool — and after the JSON entries.
    expect(PERSON_POOL).toContain('Aureliano')
    const aurelianoIdx = PERSON_POOL.indexOf('Aureliano')
    const tizioIdx = PERSON_POOL.indexOf('Tizio')
    expect(aurelianoIdx).toBeGreaterThan(tizioIdx)
  })
})

describe('VocabAllocator', () => {
  it('returns the first unused pseudonym deterministically', () => {
    const alloc = new VocabAllocator()
    const first = alloc.nextFor('persona', '')
    expect(first).toBe('Tizio')
  })

  it('skips pseudonyms already present in the text', () => {
    const alloc = new VocabAllocator()
    // "Tizio" appears in the text → allocator must skip it.
    const next = alloc.nextFor('persona', 'il sig. Tizio è qui')
    expect(next).not.toBe('Tizio')
    expect(next).toBeTruthy()
  })

  it('returns null for an unknown category', () => {
    const alloc = new VocabAllocator()
    expect(alloc.nextFor('non-esistente', '')).toBeNull()
  })

  it('generates a suffixed fallback when the pool is exhausted', () => {
    // Build a custom mini-pool of size 2 and consume both.
    const alloc = new VocabAllocator({
      persona: ['Alpha', 'Beta'],
      luogo: [],
      organizzazione: [],
    })
    const all = `Alpha Beta`
    const fallback = alloc.nextFor('persona', all)
    expect(fallback).toBe('Alpha_1')
  })

  it('exposes the canonical category list', () => {
    const alloc = new VocabAllocator()
    expect([...alloc.categories()]).toEqual([
      'persona',
      'luogo',
      'organizzazione',
    ])
  })
})
