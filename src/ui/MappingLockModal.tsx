/**
 * MappingLockModal.tsx — affordance contestuale (popup) per la "fissità"
 * delle categorie di un mapping salvato (free tier).
 *
 * Trigger:
 *   primo cambio di uno dei 5 toggle "sostituisci anche"
 *   (places/organizations/courts/cap/date) MENTRE un mapping è
 *   "attivo loaded" da IDB — cioè `active.entries.length > 0`
 *   AND `active.pristine === true`. In quel caso il toggle visivamente
 *   non deve restare scritto: chi gestisce il trigger fa rollback dopo
 *   la chiusura del modal (qualunque via). Stessa logica per ESC /
 *   click-outside / "Va bene, continua".
 *
 * "Elimina il mapping e ricomincia" → chiama `onDeleteMapping`, che a
 * sua volta esegue `closeActive()`. Dopo la cancellazione, il toggle
 * resta come l'utente l'ha impostato (siamo fresh, niente rollback).
 *
 * "Link Pro" apre `https://micheleloi.pro/recode-it/` in nuova tab. Il
 * modal resta aperto (utente vede info Pro in altra tab).
 *
 * Persistence dismiss: localStorage["recodeit:mappingLockHintDismissed"]
 * → "1" se l'utente spunta "Non mostrarmi più" prima di chiudere.
 *
 * Copy ratificato founder (SID-20260531). IT only — chiavi i18n fallback
 * a IT per EN/DE/FR via t() in LanguageContext.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useLanguage } from './LanguageContext'

export const MAPPING_LOCK_HINT_STORAGE_KEY = 'recodeit:mappingLockHintDismissed'

const PRO_URL = 'https://micheleloi.pro/recode-it/'

export type MappingLockModalCloseReason =
  | 'continue'        // "Va bene, continua" / ESC / backdrop click → rollback toggle
  | 'delete-mapping'  // "Elimina il mapping e ricomincia" → no rollback

type Props = {
  isOpen: boolean
  /** Nome user-visible del mapping (`active.label`). Se vuoto/null, il
   * componente userà il fallback "questo mapping". */
  mappingLabel: string | null
  /** Chiamato quando il modal si chiude per qualunque via. Il chiamante
   * decide se rollback del toggle (reason === 'continue') o no
   * (reason === 'delete-mapping'). `dontShowAgain` propagato per
   * persistence in localStorage. */
  onClose: (reason: MappingLockModalCloseReason, dontShowAgain: boolean) => void
  /** Esegue `closeActive()` lato chiamante (banner X equivalent). */
  onDeleteMapping: () => void
}

export function MappingLockModal({
  isOpen,
  mappingLabel,
  onClose,
  onDeleteMapping,
}: Props): JSX.Element | null {
  const { t } = useLanguage()
  const primaryBtnRef = useRef<HTMLButtonElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dontShowRef = useRef<HTMLInputElement>(null)

  // Focus trap minimo: focus al primary button al mount; ESC chiude.
  useEffect(() => {
    if (!isOpen) return
    primaryBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose('continue', dontShowRef.current?.checked === true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const handleContinue = useCallback(() => {
    onClose('continue', dontShowRef.current?.checked === true)
  }, [onClose])

  const handleDelete = useCallback(() => {
    const dontShow = dontShowRef.current?.checked === true
    onDeleteMapping()
    onClose('delete-mapping', dontShow)
  }, [onClose, onDeleteMapping])

  const handleProLink = useCallback(() => {
    // Nuova tab — modal resta aperta per scelta dell'utente.
    window.open(PRO_URL, '_blank', 'noopener,noreferrer')
  }, [])

  if (!isOpen) return null

  const labelForBody = mappingLabel && mappingLabel.trim() !== ''
    ? mappingLabel
    : t('mappingLock.fallbackLabel')

  const body = t('mappingLock.body').replace('{nomeDelMapping}', labelForBody)

  return (
    <div
      ref={overlayRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mapping-lock-modal-title"
      data-testid="mapping-lock-modal"
      onClick={(e) => {
        if (e.target === overlayRef.current) {
          onClose('continue', dontShowRef.current?.checked === true)
        }
      }}
    >
      <div className="modal mapping-lock-modal">
        <h3 id="mapping-lock-modal-title">{t('mappingLock.title')}</h3>
        <p>{body}</p>

        <div className="actions actions--stack">
          <button
            ref={primaryBtnRef}
            type="button"
            className="btn btn--primary"
            onClick={handleContinue}
            data-testid="mapping-lock-continue-btn"
          >
            {t('mappingLock.primary')}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleDelete}
            data-testid="mapping-lock-delete-btn"
          >
            {t('mappingLock.secondary')}
          </button>
        </div>

        <a
          href={PRO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mapping-lock-modal__pro-link"
          onClick={(e) => {
            // Evita doppia-apertura via window.open: lascio il click nativo
            // gestire l'anchor target=_blank (rel noopener). Il preventDefault
            // qui sarebbe ridondante.
            void e
            handleProLink()
            e.preventDefault()
          }}
          data-testid="mapping-lock-pro-link"
        >
          {t('mappingLock.proLink')}
        </a>

        <label className="mapping-lock-modal__dont-show">
          <input
            ref={dontShowRef}
            type="checkbox"
            data-testid="mapping-lock-dont-show"
          />
          <span>{t('mappingLock.dontShowAgain')}</span>
        </label>
      </div>
    </div>
  )
}
