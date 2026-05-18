/**
 * UI-side types — Phase 2.
 *
 * The engine returns `MappingEntry` objects (pseudonym ↔ original); the UI
 * augments them with review state (accepted / category-changed / false
 * positive) so the entity review list can render and mutate them.
 */

import type { MappingEntry } from '../types/engine'

export type EntityStatus = 'pending' | 'accepted' | 'falsePositive'

/** Categories the user can switch to via the "Cambia categoria" dropdown. */
export const SWITCHABLE_CATEGORIES = [
  'PERSONA',
  'LUOGO',
  'ORGANIZZAZIONE',
  'TRIBUNALE',
  'AVVOCATO',
] as const

export type SwitchableCategory = (typeof SWITCHABLE_CATEGORIES)[number]

/** A single entity shown in the review list, augmented with UI state. */
export type ReviewEntity = MappingEntry & {
  id: string
  status: EntityStatus
}

/**
 * UI-facing tag for Pass 2 preserved entries — drives the badge label in
 * the review list (e.g. CITTÀ, ORG, TRIBUNALE).
 */
export function preservedBadgeLabel(category: string): string {
  switch (category.toLowerCase()) {
    case 'citta':
    case 'città':
    case 'luogo':
      return 'CITTÀ'
    case 'via':
      return 'VIA'
    case 'azienda':
      return 'AZIENDA'
    case 'organizzazione':
      return 'ORG'
    case 'tribunale':
      return 'TRIBUNALE'
    default:
      return category.toUpperCase()
  }
}
