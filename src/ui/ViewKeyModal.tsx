/**
 * ViewKeyModal.tsx — Recode IT view-key add-on UI (capabilities_index §9.9).
 *
 * Three states driven by auth-context.viewKeyGranted + active-mapping entries:
 *
 *   • locked   (granted=false): paywall CTA (Stripe Payment Link via
 *     /recode/view-key/claim-checkout) + MHC Bearer paste form.
 *   • loading  (refreshViewKey() pending / bearer validation in-flight):
 *     spinner + neutral message.
 *   • unlocked (granted=true): read-only table of original→pseudonym
 *     with Copy / Export CSV gestures.
 *
 * Strategic note: this UI never talks to the mapping-store directly. The
 * mapping entries flow in via active-mapping-context (already decrypted for
 * tier=pro). The user-visible "key" is just a presentation of those entries.
 *
 * Anonymous users (user=null) see a special locked sub-state asking them to
 * sign in or create an account — view-key requires identity for both Stripe
 * funnel attribution (client_reference_id) and Bearer cross-DB linkage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, claimViewKeyByBearer, claimViewKeyCheckout } from '../api/client'
import { useAuth } from '../auth/auth-context'
import { useActiveMapping } from '../auth/active-mapping-context'
import { getCurrentMappingReadOnly, mappingToCsv } from '../storage/mapping-store'
import { useLanguage } from './LanguageContext'

type Props = {
  isOpen: boolean
  onClose: () => void
}

type LocalStatus = 'idle' | 'bearer-validating' | 'checkout-opening'

/**
 * Trigger a browser download of CSV text using the same blob pattern used
 * elsewhere in the app. Filename includes a timestamp so multiple exports
 * don't overwrite each other.
 */
function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so the click handler has time to fire on slow browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function nowStampForFilename(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

export function ViewKeyModal({ isOpen, onClose }: Props): JSX.Element | null {
  const { t } = useLanguage()
  const { user, viewKeyGranted, viewKeySource, refreshViewKey } = useAuth()
  const { active } = useActiveMapping()

  const [localStatus, setLocalStatus] = useState<LocalStatus>('idle')
  const [bearerInput, setBearerInput] = useState('')
  const [bearerError, setBearerError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Derive the read-only mapping view from the active-mapping entries.
  const mappingView = useMemo(
    () => getCurrentMappingReadOnly(active?.entries ?? null),
    [active?.entries],
  )

  // Focus management: focus the close button when the modal opens so the
  // keyboard user has an obvious escape route. ESC key closes too.
  useEffect(() => {
    if (!isOpen) return
    closeButtonRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Reset transient form state every time the modal opens fresh.
  useEffect(() => {
    if (isOpen) {
      setBearerError(null)
      setBearerInput('')
      setCopyState('idle')
      setLocalStatus('idle')
    }
  }, [isOpen])

  const handleBearerValidate = useCallback(async () => {
    const trimmed = bearerInput.trim()
    setBearerError(null)
    if (!trimmed) {
      setBearerError(t('viewKey.bearerFormatInvalid'))
      return
    }
    if (!trimmed.startsWith('mhc_live_')) {
      setBearerError(t('viewKey.bearerFormatInvalid'))
      return
    }
    setLocalStatus('bearer-validating')
    try {
      await claimViewKeyByBearer(trimmed)
      await refreshViewKey()
      setBearerInput('')
    } catch (err) {
      if (err instanceof ApiError) {
        // 401 → bearer not valid / not active; 400 → format error
        if (err.status === 401) {
          setBearerError(t('viewKey.bearerInvalid'))
        } else if (err.status === 400) {
          setBearerError(t('viewKey.bearerFormatInvalid'))
        } else {
          setBearerError(t('viewKey.bearerError'))
        }
      } else {
        setBearerError(t('viewKey.errorGeneric'))
      }
    } finally {
      setLocalStatus('idle')
    }
  }, [bearerInput, refreshViewKey, t])

  const handlePayCTA = useCallback(async () => {
    setBearerError(null)
    setLocalStatus('checkout-opening')
    try {
      const resp = await claimViewKeyCheckout()
      if (resp.already_granted) {
        // Race: backend says granted already (paid in another tab). Refresh
        // local state instead of redirecting.
        await refreshViewKey()
        setLocalStatus('idle')
        return
      }
      if (!resp.checkout_url) {
        setBearerError(t('viewKey.errorGeneric'))
        setLocalStatus('idle')
        return
      }
      // Full-page redirect to Stripe Payment Link. The user returns to the
      // app after payment via Stripe success_url (configured server-side);
      // the webhook flips view_key_permitted_at and refreshViewKey() on
      // next mount picks it up.
      window.location.href = resp.checkout_url
    } catch (err) {
      void err
      setBearerError(t('viewKey.errorGeneric'))
      setLocalStatus('idle')
    }
  }, [refreshViewKey, t])

  const handleCopyAll = useCallback(async () => {
    if (!mappingView || mappingView.size === 0) return
    const csv = mappingToCsv(mappingView, {
      original: t('viewKey.tableColOriginal'),
      pseudonym: t('viewKey.tableColPseudonym'),
    })
    try {
      await navigator.clipboard.writeText(csv)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      // Clipboard API may be unavailable (insecure context, denied perm) —
      // we degrade silently; user can use Export CSV instead.
      setCopyState('idle')
    }
  }, [mappingView, t])

  const handleExportCsv = useCallback(() => {
    if (!mappingView || mappingView.size === 0) return
    const csv = mappingToCsv(mappingView, {
      original: t('viewKey.tableColOriginal'),
      pseudonym: t('viewKey.tableColPseudonym'),
    })
    downloadCsv(csv, `recode-it-view-key-${nowStampForFilename()}.csv`)
  }, [mappingView, t])

  if (!isOpen) return null

  const sourceLabel = (() => {
    switch (viewKeySource) {
      case 'paid':
        return t('viewKey.sourcePaid')
      case 'mhc_bearer':
        return t('viewKey.sourceBearer')
      case 'pro_tier':
        return t('viewKey.sourceProTier')
      default:
        return null
    }
  })()

  return (
    <div
      ref={overlayRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="view-key-modal-title"
      data-testid="view-key-modal"
      onClick={(e) => {
        // Close on backdrop click (but not when the click bubbles up from
        // the .modal card itself).
        if (e.target === overlayRef.current) {
          onClose()
        }
      }}
    >
      <div className="modal view-key-modal" data-state={viewKeyGranted ? 'unlocked' : 'locked'}>
        {!viewKeyGranted ? (
          // ─── Locked state ───────────────────────────────────────────
          <>
            <h3 id="view-key-modal-title">{t('viewKey.modalTitleLocked')}</h3>
            <p>{t('viewKey.lockedDescription')}</p>

            {!user ? (
              <p className="view-key-modal__notice" data-testid="view-key-anon-notice">
                {t('viewKey.notLoggedIn')}
              </p>
            ) : (
              <>
                <div className="view-key-modal__pay">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void handlePayCTA()}
                    disabled={localStatus === 'checkout-opening'}
                    data-testid="view-key-pay-btn"
                  >
                    {localStatus === 'checkout-opening'
                      ? t('viewKey.paymentLoading')
                      : t('viewKey.payCTA')}
                  </button>
                  <p className="view-key-modal__hint">{t('viewKey.payCTAHint')}</p>
                </div>

                <div className="view-key-modal__separator" aria-hidden="true">
                  ─
                </div>

                <div className="view-key-modal__bearer">
                  <p className="view-key-modal__hint">{t('viewKey.bearerCTAhint')}</p>
                  <label className="field">
                    <span className="field__label">
                      {t('viewKey.bearerPasteLabel')}
                    </span>
                    <input
                      type="text"
                      className="auth-input"
                      value={bearerInput}
                      onChange={(e) => setBearerInput(e.target.value)}
                      placeholder={t('viewKey.bearerPastePlaceholder')}
                      autoComplete="off"
                      spellCheck={false}
                      data-testid="view-key-bearer-input"
                      disabled={localStatus === 'bearer-validating'}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => void handleBearerValidate()}
                    disabled={localStatus === 'bearer-validating' || bearerInput.trim() === ''}
                    data-testid="view-key-bearer-validate-btn"
                  >
                    {localStatus === 'bearer-validating'
                      ? t('viewKey.bearerValidating')
                      : t('viewKey.bearerValidate')}
                  </button>
                  {bearerError && (
                    <p
                      className="view-key-modal__error"
                      role="alert"
                      data-testid="view-key-bearer-error"
                    >
                      {bearerError}
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="actions">
              <button
                ref={closeButtonRef}
                type="button"
                className="btn btn--secondary"
                onClick={onClose}
                data-testid="view-key-close-btn"
              >
                {t('viewKey.closeCTA')}
              </button>
            </div>
          </>
        ) : (
          // ─── Unlocked state ─────────────────────────────────────────
          <>
            <h3 id="view-key-modal-title">{t('viewKey.modalTitleUnlocked')}</h3>
            {sourceLabel && (
              <span
                className="view-key-modal__source-pill"
                data-testid="view-key-source-pill"
              >
                {sourceLabel}
              </span>
            )}

            {!mappingView ? (
              <p
                className="view-key-modal__notice"
                data-testid="view-key-no-mapping"
              >
                {t('viewKey.noMapping')}
              </p>
            ) : (
              <>
                <div className="view-key-modal__table-wrap">
                  <table
                    className="view-key-modal__table"
                    data-testid="view-key-table"
                  >
                    <thead>
                      <tr>
                        <th scope="col">{t('viewKey.tableColOriginal')}</th>
                        <th scope="col">{t('viewKey.tableColPseudonym')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(mappingView.entries()).map(([original, pseudonym]) => (
                        <tr key={`${original}::${pseudonym}`}>
                          <td>{original}</td>
                          <td>{pseudonym}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="actions actions--inline">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => void handleCopyAll()}
                    data-testid="view-key-copy-btn"
                  >
                    {copyState === 'copied'
                      ? t('viewKey.copyDone')
                      : t('viewKey.copyCTA')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={handleExportCsv}
                    data-testid="view-key-export-btn"
                  >
                    {t('viewKey.exportCTA')}
                  </button>
                </div>
              </>
            )}

            <div className="actions">
              <button
                ref={closeButtonRef}
                type="button"
                className="btn btn--secondary"
                onClick={onClose}
                data-testid="view-key-close-btn"
              >
                {t('viewKey.closeCTA')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
