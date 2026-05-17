/**
 * ClipboardWidget — the Phase 2 two-panel single-page UI.
 *
 * Owns the cross-panel state: original text, pseudonymized output, the
 * mapping table, and the review-state augmentation that drives
 * `EntityReviewList`. Mapping lives only in React state (Phase 3 will move
 * it to encrypted server-side storage).
 */

import { useMemo, useState } from 'react'
import type { MappingEntry } from '../types/engine'
import { PseudonymizePanel } from './PseudonymizePanel'
import { RecodePanel } from './RecodePanel'
import type { ReviewEntity, SwitchableCategory } from './types'

function buildReviewEntities(mapping: MappingEntry[]): ReviewEntity[] {
  return mapping.map((entry, idx) => ({
    ...entry,
    id: `${entry.category}::${entry.realValue}::${idx}`,
    status: 'pending' as const,
  }))
}

export function ClipboardWidget(): JSX.Element {
  const [originalText, setOriginalText] = useState('')
  const [pseudonymizedText, setPseudonymizedText] = useState('')
  const [entities, setEntities] = useState<ReviewEntity[]>([])

  // Effective mapping for the recode panel: excludes entities the user has
  // marked as false positives (their realValue stays unchanged in the output,
  // so there's nothing to reverse).
  const effectiveMapping = useMemo<MappingEntry[]>(
    () =>
      entities
        .filter((e) => e.status !== 'falsePositive')
        .map(({ pseudonym, realValue, category }) => ({
          pseudonym,
          realValue,
          category,
        })),
    [entities],
  )

  const handleResult = ({
    originalText: orig,
    pseudonymizedText: pseudo,
    mapping,
  }: {
    originalText: string
    pseudonymizedText: string
    mapping: MappingEntry[]
  }) => {
    setOriginalText(orig)
    setPseudonymizedText(pseudo)
    setEntities(buildReviewEntities(mapping))
  }

  const handleAccept = (id: string) => {
    setEntities((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: 'accepted' } : e)),
    )
  }

  const handleChangeCategory = (id: string, newCategory: SwitchableCategory) => {
    setEntities((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, category: newCategory, status: 'accepted' } : e,
      ),
    )
  }

  const handleFalsePositive = (id: string) => {
    setEntities((prev) => {
      const target = prev.find((e) => e.id === id)
      if (!target) return prev
      // Restore the original text in the pseudonymized preview: replace every
      // occurrence of the pseudonym with the realValue, then mark the entity
      // as false positive so the recode panel skips it.
      if (target.pseudonym && target.pseudonym !== target.realValue) {
        setPseudonymizedText((cur) => cur.split(target.pseudonym).join(target.realValue))
      }
      return prev.map((e) =>
        e.id === id ? { ...e, status: 'falsePositive' } : e,
      )
    })
  }

  return (
    <div className="clipboard-widget" data-testid="clipboard-widget">
      <PseudonymizePanel
        originalText={originalText}
        pseudonymizedText={pseudonymizedText}
        entities={entities}
        onResult={handleResult}
        onOriginalChange={setOriginalText}
        onAccept={handleAccept}
        onChangeCategory={handleChangeCategory}
        onFalsePositive={handleFalsePositive}
      />
      <RecodePanel mapping={effectiveMapping} />
    </div>
  )
}
