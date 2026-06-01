/**
 * MappaPanel.tsx — Recode IT post-pivot tab #2 (capabilities_index §9.10).
 *
 * Customer-facing name: "Mappa". Free with login (also visible in anonymous
 * mode against the in-RAM mapping). Shows the original → pseudonym table for
 * the active mapping and lets the user:
 *   - correct a wrong pseudonym (edit pseudonym column inline)
 *   - correct a wrong real name (edit nome column inline)
 *   - add a missing pair (form below the table)
 *   - delete a pair (✕ button per row)
 *
 * False-positive entries (e.g. "Comune di Milano" the user marked as
 * non-substituted) are hidden from this surface: the Mappa is the
 * mental-model "which pseudonym replaces which name", FP entries are
 * a separate concept ("which name was preserved as-is").
 *
 * All mutations flow through ActiveMappingContext.updateEntries — which
 * marks the mapping dirty and triggers the existing auto-save / save-button
 * machinery downstream. We never write to mapping-store directly here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActiveMappingOptional } from '../auth/active-mapping-context'
import { useAuthOptional } from '../auth/auth-context'
import { useLanguage } from './LanguageContext'
import { mappingToCsv } from '../storage/mapping-store'
import type { MappingEntry } from '../types/engine'

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function nowStampForFilename(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

export function MappaPanel(): JSX.Element {
  const { t } = useLanguage()
  const authCtx = useAuthOptional()
  const user = authCtx?.user ?? null
  const activeCtx = useActiveMappingOptional()
  const active = activeCtx?.active ?? null
  const updateEntries = activeCtx?.updateEntries

  const sourceEntries = useMemo(() => active?.entries ?? [], [active?.entries])

  // Filter out FP entries — they're a separate concept (preserved originals)
  // and don't belong in the "nome → pseudonimo" mental model.
  const visibleEntries = useMemo(
    () => sourceEntries.filter((e) => e.isFalsePositive !== true),
    [sourceEntries],
  )

  const [newReal, setNewReal] = useState('')
  const [newPseudo, setNewPseudo] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  // Reset the add form when the underlying mapping changes (different doc,
  // new save) so we don't carry over a half-filled draft.
  useEffect(() => {
    setNewReal('')
    setNewPseudo('')
    setAddError(null)
  }, [active?.mappingId])

  const commit = useCallback(
    (next: MappingEntry[]) => {
      updateEntries?.(next)
    },
    [updateEntries],
  )

  const handleEditReal = useCallback(
    (originalIdx: number, value: string) => {
      const next = sourceEntries.map((e, i) =>
        i === originalIdx ? { ...e, realValue: value } : e,
      )
      commit(next)
    },
    [sourceEntries, commit],
  )

  const handleEditPseudo = useCallback(
    (originalIdx: number, value: string) => {
      const next = sourceEntries.map((e, i) =>
        i === originalIdx ? { ...e, pseudonym: value } : e,
      )
      commit(next)
    },
    [sourceEntries, commit],
  )

  const handleDelete = useCallback(
    (originalIdx: number) => {
      const next = sourceEntries.filter((_, i) => i !== originalIdx)
      commit(next)
    },
    [sourceEntries, commit],
  )

  const handleAdd = useCallback(() => {
    setAddError(null)
    const realTrim = newReal.trim()
    const pseudoTrim = newPseudo.trim()
    if (!realTrim || !pseudoTrim) {
      setAddError(t('mappa.add.errorBlank'))
      return
    }
    const dup = sourceEntries.some(
      (e) => e.realValue === realTrim && e.isFalsePositive !== true,
    )
    if (dup) {
      setAddError(t('mappa.add.errorDupReal'))
      return
    }
    const next: MappingEntry[] = [
      ...sourceEntries,
      {
        realValue: realTrim,
        pseudonym: pseudoTrim,
        category: 'manuale',
        isFalsePositive: false,
      },
    ]
    commit(next)
    setNewReal('')
    setNewPseudo('')
  }, [newReal, newPseudo, sourceEntries, commit, t])

  const handleCopyAll = useCallback(async () => {
    if (visibleEntries.length === 0) return
    const map = new Map<string, string>()
    for (const e of visibleEntries) {
      if (!map.has(e.realValue)) map.set(e.realValue, e.pseudonym)
    }
    const csv = mappingToCsv(map, {
      original: t('mappa.table.colReal'),
      pseudonym: t('mappa.table.colPseudo'),
    })
    try {
      await navigator.clipboard.writeText(csv)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('idle')
    }
  }, [visibleEntries, t])

  const handleExportCsv = useCallback(() => {
    if (visibleEntries.length === 0) return
    const map = new Map<string, string>()
    for (const e of visibleEntries) {
      if (!map.has(e.realValue)) map.set(e.realValue, e.pseudonym)
    }
    const csv = mappingToCsv(map, {
      original: t('mappa.table.colReal'),
      pseudonym: t('mappa.table.colPseudo'),
    })
    downloadCsv(csv, `recode-it-mappa-${nowStampForFilename()}.csv`)
  }, [visibleEntries, t])

  // Empty state — most-likely path for fresh visitor: no document loaded yet.
  const isEmpty = visibleEntries.length === 0
  if (isEmpty) {
    return (
      <section className="panel mappa-panel" aria-labelledby="mappa-heading">
        <h2 id="mappa-heading" className="panel__heading">
          {t('mappa.heading')}
        </h2>
        <p className="mappa-panel__subheading">{t('mappa.subheading')}</p>
        <div className="mappa-panel__empty" data-testid="mappa-empty">
          <p className="mappa-panel__empty-title">
            <strong>{t('mappa.empty.title')}</strong>
          </p>
          <p>{t('mappa.empty.hint')}</p>
        </div>
        {user && (
          <div className="mappa-panel__add" data-testid="mappa-add-form-empty">
            <h3 className="mappa-panel__add-heading">{t('mappa.add.heading')}</h3>
            <div className="mappa-panel__add-row">
              <input
                type="text"
                className="auth-input"
                placeholder={t('mappa.add.realPlaceholder')}
                value={newReal}
                onChange={(e) => setNewReal(e.target.value)}
                data-testid="mappa-add-real"
                aria-label={t('mappa.table.colReal')}
              />
              <input
                type="text"
                className="auth-input"
                placeholder={t('mappa.add.pseudoPlaceholder')}
                value={newPseudo}
                onChange={(e) => setNewPseudo(e.target.value)}
                data-testid="mappa-add-pseudo"
                aria-label={t('mappa.table.colPseudo')}
              />
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleAdd}
                data-testid="mappa-add-btn"
                disabled={!newReal.trim() || !newPseudo.trim()}
              >
                {t('mappa.add.button')}
              </button>
            </div>
            {addError && (
              <p className="error" role="alert" data-testid="mappa-add-error">
                {addError}
              </p>
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="panel mappa-panel" aria-labelledby="mappa-heading">
      <h2 id="mappa-heading" className="panel__heading">
        {t('mappa.heading')}
      </h2>
      <p className="mappa-panel__subheading">{t('mappa.subheading')}</p>

      {/* Edit-affordance hint — avvocato discovers inline edit before touching the table */}
      <p className="mappa-panel__edit-hint" data-testid="mappa-edit-hint">
        ✎ {t('mappa.table.editHint')}
      </p>

      <div className="mappa-panel__table-wrap">
        <table className="mappa-panel__table" data-testid="mappa-table">
          <thead>
            <tr>
              <th scope="col">{t('mappa.table.colReal')}</th>
              <th scope="col">{t('mappa.table.colPseudo')}</th>
              <th scope="col" aria-label={t('mappa.table.colActions')}>
                {' '}
              </th>
            </tr>
          </thead>
          <tbody>
            {sourceEntries.map((entry, idx) => {
              if (entry.isFalsePositive === true) return null
              return (
                <tr key={idx} data-testid={`mappa-row-${idx}`}>
                  <td>
                    <input
                      type="text"
                      className="mappa-panel__cell-input"
                      value={entry.realValue}
                      onChange={(e) => handleEditReal(idx, e.target.value)}
                      aria-label={`${t('mappa.table.colReal')} riga ${idx + 1}`}
                      data-testid={`mappa-real-${idx}`}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="mappa-panel__cell-input"
                      value={entry.pseudonym}
                      onChange={(e) => handleEditPseudo(idx, e.target.value)}
                      aria-label={`${t('mappa.table.colPseudo')} riga ${idx + 1}`}
                      data-testid={`mappa-pseudo-${idx}`}
                    />
                  </td>
                  <td className="mappa-panel__cell-action">
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => handleDelete(idx)}
                      title={t('mappa.table.deleteTitle')}
                      aria-label={t('mappa.table.deleteAria')}
                      data-testid={`mappa-delete-${idx}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="actions actions--inline mappa-panel__actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void handleCopyAll()}
          data-testid="mappa-copy-btn"
        >
          {copyState === 'copied' ? t('mappa.copy.done') : t('mappa.copy.button')}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={handleExportCsv}
          data-testid="mappa-export-btn"
        >
          {t('mappa.export.button')}
        </button>
      </div>

      <div className="mappa-panel__add" data-testid="mappa-add-form">
        <h3 className="mappa-panel__add-heading">{t('mappa.add.heading')}</h3>
        <div className="mappa-panel__add-row">
          <input
            type="text"
            className="auth-input"
            placeholder={t('mappa.add.realPlaceholder')}
            value={newReal}
            onChange={(e) => setNewReal(e.target.value)}
            data-testid="mappa-add-real"
            aria-label={t('mappa.table.colReal')}
          />
          <input
            type="text"
            className="auth-input"
            placeholder={t('mappa.add.pseudoPlaceholder')}
            value={newPseudo}
            onChange={(e) => setNewPseudo(e.target.value)}
            data-testid="mappa-add-pseudo"
            aria-label={t('mappa.table.colPseudo')}
          />
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleAdd}
            data-testid="mappa-add-btn"
            disabled={!newReal.trim() || !newPseudo.trim()}
          >
            {t('mappa.add.button')}
          </button>
        </div>
        {addError && (
          <p className="error" role="alert" data-testid="mappa-add-error">
            {addError}
          </p>
        )}
      </div>
    </section>
  )
}
