/**
 * EntityHighlight — single inline span representing a detected entity inside
 * the document view (Design C, document-first inline annotation).
 *
 * Renders the original or pseudonymized form depending on `displayMode`, with
 * a category-coded color border + background tint. Click opens the popover
 * (owned by the parent DocumentView so only one is open at a time). Hover
 * triggers a native title tooltip "<originale> → <pseudonimo>" — minimal,
 * accessible, no extra libs.
 *
 * Keyboard support: highlights are <button>-equivalents (role=button + tabIndex)
 * so Tab navigates between entities and Enter opens the popover.
 */

import { forwardRef, type KeyboardEvent, type MouseEvent } from 'react'
import type { ReviewEntity } from './types'

export type DisplayMode = 'pseudonimo' | 'originale'

export function categoryColorKey(category: string): string {
  const c = category.toLowerCase()
  if (c === 'persona' || c === 'avvocato') return 'persona'
  if (
    c === 'luogo' ||
    c === 'citta' ||
    c === 'città' ||
    c === 'via' ||
    c === 'indirizzo'
  )
    return 'luogo'
  if (c === 'data') return 'data'
  if (
    c === 'organizzazione' ||
    c === 'org' ||
    c === 'azienda' ||
    c === 'tribunale'
  )
    return 'organizzazione'
  if (c === 'codice_fiscale' || c === 'iban' || c === 'email' || c === 'cf')
    return 'identificatore'
  return 'altro'
}

type Props = {
  entity: ReviewEntity
  displayMode: DisplayMode
  isActive: boolean
  onActivate: (entityId: string, anchor: HTMLElement) => void
}

export const EntityHighlight = forwardRef<HTMLSpanElement, Props>(
  function EntityHighlight(
    { entity, displayMode, isActive, onActivate },
    ref,
  ) {
    const colorKey = categoryColorKey(entity.category)
    const isFP = entity.status === 'falsePositive'
    const isPreserved = entity.isPreserved === true

    // What text actually shows. FP and preserved entries always show the
    // original (their pseudonym IS the original); regular entries follow the
    // toggle.
    const shown =
      isFP || isPreserved
        ? entity.realValue
        : displayMode === 'pseudonimo'
          ? entity.pseudonym
          : entity.realValue

    const tooltip =
      isFP || isPreserved
        ? `${entity.realValue} (lasciato originale)`
        : `${entity.realValue} → ${entity.pseudonym}`

    const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
      e.stopPropagation()
      onActivate(entity.id, e.currentTarget)
    }
    const handleKey = (e: KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate(entity.id, e.currentTarget)
      }
    }

    const classNames = [
      'entity-hl',
      `entity-hl--${colorKey}`,
      `entity-hl--status-${entity.status}`,
      isPreserved ? 'entity-hl--preserved' : '',
      isActive ? 'entity-hl--active' : '',
    ]
      .filter(Boolean)
      .join(' ')

    const ariaLabel = isFP
      ? `${entity.realValue}, ${entity.category}, lasciato originale, premi Invio per modificare`
      : isPreserved
        ? `${entity.realValue}, ${entity.category}, preservato, premi Invio per modificare`
        : `${entity.realValue}, ${entity.category}, pseudonimo ${entity.pseudonym}, premi Invio per modificare`

    return (
      <span
        ref={ref}
        className={classNames}
        role="button"
        tabIndex={0}
        title={tooltip}
        aria-label={ariaLabel}
        data-entity-id={entity.id}
        data-testid={`entity-hl-${entity.id}`}
        onClick={handleClick}
        onKeyDown={handleKey}
      >
        {shown}
      </span>
    )
  },
)
