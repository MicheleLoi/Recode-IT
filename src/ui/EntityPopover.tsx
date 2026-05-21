/**
 * EntityPopover — micro popover anchored to an entity highlight (Design C).
 *
 * Four primary options:
 *   1. Use the suggested pseudonym (no-op confirmation; closes popover).
 *   2. Leave the original (false positive).
 *   3. Change category (inline submenu).
 *   4. Substitute anyway (only for preserved entries).
 *
 * Positioning is plain CSS absolute against the anchor element's bounding
 * rect — no Floating UI / Popper dep. The popover is rendered as a sibling
 * of the document view; we read the anchor rect on open and translate.
 *
 * The popover closes on: outside click, Escape, or after any action.
 */

import { useEffect, useRef, useState } from 'react'
import {
  SWITCHABLE_CATEGORIES,
  type ReviewEntity,
  type SwitchableCategory,
} from './types'

type Props = {
  entity: ReviewEntity
  anchor: HTMLElement
  onAcceptPseudonym: (id: string) => void
  onFalsePositive: (id: string) => void
  onChangeCategory: (id: string, category: SwitchableCategory) => void
  onSubstituteAnyway?: (id: string) => void
  onClose: () => void
}

export function EntityPopover({
  entity,
  anchor,
  onAcceptPseudonym,
  onFalsePositive,
  onChangeCategory,
  onSubstituteAnyway,
  onClose,
}: Props): JSX.Element {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [showCategoryMenu, setShowCategoryMenu] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  })

  // Compute position once when anchor changes, then again on window resize /
  // scroll so the popover stays glued to its anchor.
  useEffect(() => {
    const compute = () => {
      const rect = anchor.getBoundingClientRect()
      const top = rect.bottom + window.scrollY + 4
      // Try to align to anchor left; clamp to viewport so it doesn't overflow.
      const desiredWidth = 260
      let left = rect.left + window.scrollX
      const maxLeft =
        window.scrollX + document.documentElement.clientWidth - desiredWidth - 8
      if (left > maxLeft) left = maxLeft
      if (left < window.scrollX + 8) left = window.scrollX + 8
      setPos({ top, left })
    }
    compute()
    window.addEventListener('scroll', compute, true)
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('scroll', compute, true)
      window.removeEventListener('resize', compute)
    }
  }, [anchor])

  // Outside click + Escape to close.
  useEffect(() => {
    const onDoc = (e: globalThis.MouseEvent) => {
      if (!popoverRef.current) return
      const target = e.target as Node
      if (popoverRef.current.contains(target)) return
      if (anchor.contains(target)) return
      onClose()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  // Focus the popover on mount for keyboard users.
  useEffect(() => {
    popoverRef.current?.focus()
  }, [])

  const isFP = entity.status === 'falsePositive'
  const isPreserved = entity.isPreserved === true

  return (
    <div
      ref={popoverRef}
      className="entity-popover"
      role="dialog"
      aria-label={`Modifica ${entity.realValue}`}
      tabIndex={-1}
      style={{ top: pos.top, left: pos.left }}
      data-testid={`entity-popover-${entity.id}`}
    >
      <div className="entity-popover__header">
        <span className="entity-popover__original">{entity.realValue}</span>
        <span className="entity-popover__arrow" aria-hidden>
          →
        </span>
        <span className="entity-popover__pseudo">
          {isFP || isPreserved ? (
            <em>lasciato originale</em>
          ) : (
            entity.pseudonym
          )}
        </span>
      </div>
      <div className="entity-popover__category-tag">{entity.category}</div>

      <ul className="entity-popover__options" role="menu">
        {!isPreserved && (
          <li>
            <button
              type="button"
              className={`entity-popover__option${!isFP ? ' is-selected' : ''}`}
              onClick={() => {
                onAcceptPseudonym(entity.id)
                onClose()
              }}
              role="menuitem"
              data-testid={`popover-accept-${entity.id}`}
            >
              <span className="entity-popover__radio" aria-hidden>
                {!isFP ? '●' : '○'}
              </span>
              Usa pseudonimo <strong>{entity.pseudonym}</strong>
            </button>
          </li>
        )}
        {isPreserved && onSubstituteAnyway && (
          <li>
            <button
              type="button"
              className="entity-popover__option"
              onClick={() => {
                onSubstituteAnyway(entity.id)
                onClose()
              }}
              role="menuitem"
              data-testid={`popover-substitute-${entity.id}`}
            >
              <span className="entity-popover__radio" aria-hidden>
                ○
              </span>
              Sostituisci comunque
            </button>
          </li>
        )}
        <li>
          <button
            type="button"
            className={`entity-popover__option${isFP ? ' is-selected' : ''}`}
            onClick={() => {
              onFalsePositive(entity.id)
              onClose()
            }}
            role="menuitem"
            data-testid={`popover-fp-${entity.id}`}
          >
            <span className="entity-popover__radio" aria-hidden>
              {isFP ? '●' : '○'}
            </span>
            Lascia originale &quot;{entity.realValue}&quot;
          </button>
        </li>
        <li>
          <button
            type="button"
            className="entity-popover__option"
            onClick={() => setShowCategoryMenu((v) => !v)}
            aria-expanded={showCategoryMenu}
            aria-haspopup="menu"
            role="menuitem"
            data-testid={`popover-change-category-${entity.id}`}
          >
            <span className="entity-popover__radio" aria-hidden>
              ○
            </span>
            Cambia categoria <span aria-hidden>▾</span>
          </button>
          {showCategoryMenu && (
            <ul className="entity-popover__submenu" role="menu">
              {SWITCHABLE_CATEGORIES.map((cat) => (
                <li key={cat}>
                  <button
                    type="button"
                    className="entity-popover__submenu-option"
                    onClick={() => {
                      onChangeCategory(entity.id, cat as SwitchableCategory)
                      onClose()
                    }}
                    role="menuitem"
                  >
                    {cat}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      </ul>

      <div className="entity-popover__footer">
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={onClose}
          data-testid={`popover-close-${entity.id}`}
        >
          Chiudi
        </button>
      </div>
    </div>
  )
}
