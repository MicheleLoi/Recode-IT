/**
 * EntityReviewList — render the entities detected during pseudonymization
 * with three per-entity actions: Accetta, Cambia categoria, Falso positivo.
 *
 * Phase 2: regex-only entities. "Cambia categoria" applies to detector-level
 * mapping (UI surface only — the regex pipeline doesn't reassign pools yet;
 * GLiNER integration in Phase 4 will rewire this to the mapper). False
 * positives propagate up to the parent, which adds the realValue to a
 * `Set<string>` passed back to `anonymize()` on the next run.
 */

import { useState } from 'react'
import {
  SWITCHABLE_CATEGORIES,
  type ReviewEntity,
  type SwitchableCategory,
} from './types'

type Props = {
  entities: ReviewEntity[]
  onAccept: (id: string) => void
  onChangeCategory: (id: string, newCategory: SwitchableCategory) => void
  onFalsePositive: (id: string) => void
}

export function EntityReviewList({
  entities,
  onAccept,
  onChangeCategory,
  onFalsePositive,
}: Props): JSX.Element {
  if (!entities.length) {
    return (
      <p className="review-empty" data-testid="review-empty">
        Nessuna entità rilevata. Incolla del testo o trascina un file qui sopra,
        poi premi <em>Pseudonimizza</em>.
      </p>
    )
  }

  return (
    <ul className="review-list" data-testid="review-list">
      {entities.map((entity) => (
        <EntityRow
          key={entity.id}
          entity={entity}
          onAccept={onAccept}
          onChangeCategory={onChangeCategory}
          onFalsePositive={onFalsePositive}
        />
      ))}
    </ul>
  )
}

type RowProps = {
  entity: ReviewEntity
  onAccept: (id: string) => void
  onChangeCategory: (id: string, newCategory: SwitchableCategory) => void
  onFalsePositive: (id: string) => void
}

function EntityRow({
  entity,
  onAccept,
  onChangeCategory,
  onFalsePositive,
}: RowProps): JSX.Element {
  const [categoryOpen, setCategoryOpen] = useState(false)
  const isFalsePositive = entity.status === 'falsePositive'
  const isAccepted = entity.status === 'accepted'

  return (
    <li
      className={`review-row review-row--${entity.status}`}
      data-testid={`review-row-${entity.id}`}
      data-status={entity.status}
    >
      <div className="review-row__meta">
        <span className="review-row__category">{entity.category}</span>
        <span className="review-row__original">{entity.realValue}</span>
        <span className="review-row__arrow" aria-hidden>
          →
        </span>
        <span className="review-row__pseudonym">
          {isFalsePositive ? (
            <em>lasciato originale</em>
          ) : (
            entity.pseudonym
          )}
        </span>
      </div>
      <div className="review-row__actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => onAccept(entity.id)}
          disabled={isAccepted || isFalsePositive}
          aria-label={`Accetta ${entity.realValue}`}
        >
          Accetta
        </button>
        <div className="review-row__category-control">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setCategoryOpen((v) => !v)}
            disabled={isFalsePositive}
            aria-expanded={categoryOpen}
            aria-haspopup="listbox"
          >
            Cambia categoria ▾
          </button>
          {categoryOpen && (
            <select
              className="review-row__category-select"
              defaultValue={entity.category}
              onChange={(e) => {
                onChangeCategory(entity.id, e.target.value as SwitchableCategory)
                setCategoryOpen(false)
              }}
              aria-label={`Cambia categoria per ${entity.realValue}`}
              data-testid={`category-select-${entity.id}`}
            >
              {SWITCHABLE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => onFalsePositive(entity.id)}
          disabled={isFalsePositive}
          aria-label={`Segna ${entity.realValue} come falso positivo`}
        >
          Falso positivo — lascia originale
        </button>
      </div>
    </li>
  )
}
