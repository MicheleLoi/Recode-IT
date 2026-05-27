/**
 * DecodificaPanel.tsx — Recode IT post-pivot tab #3 (capabilities_index §9.10).
 *
 * Customer-facing name: "Decodifica". Paid €20 una tantum (or free via MHC
 * Bearer / Pro tier). Two visual states driven by
 * AuthContext.reverseSubstitutionGranted:
 *
 *   • locked   (granted=false): paywall CTA (Stripe checkout via
 *     /recode/reverse-substitution/claim-checkout) + MHC Bearer paste form.
 *     Anonymous users see a sign-in nudge instead of the pay form.
 *   • unlocked (granted=true): paste-field for the AI response +
 *     "Decodifica" button + output area with the decoded text.
 *
 * Replace engine (browser-side, zero server round-trip):
 *   Build a single RegExp alternation from all active pseudonyms, replace all
 *   occurrences in one pass. Pseudonyms are sorted longest-first inside the
 *   alternation so that PERSONA_10 is matched before PERSONA_1. The engine
 *   reports how many replacements were applied so the user can sanity-check.
 *
 * The component never reads from IndexedDB or the network for the substitution
 * itself — it only reads active-mapping-context.active.entries (already in
 * memory, already decrypted for tier=pro by the time this component mounts).
 */

import { useCallback, useRef, useState } from 'react'
import {
  ApiError,
  claimReverseSubstitutionByBearer,
  claimReverseSubstitutionCheckout,
} from '../api/client'
import { useAuthOptional } from '../auth/auth-context'
import { useActiveMappingOptional } from '../auth/active-mapping-context'
import { useLanguage } from './LanguageContext'
import type { MappingEntry } from '../types/engine'

// ---------------------------------------------------------------------------
// Replace engine
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type DecodeResult = {
  output: string
  count: number
}

/**
 * Apply all pseudonym→realValue substitutions from `entries` to `input`.
 *
 * Algorithm:
 *   1. Filter out false-positive entries (they were kept as-is during codifica,
 *      so they won't appear as pseudonyms in the AI response anyway).
 *   2. Build Map<pseudonym → realValue> (first-seen wins for duplicate pseudos).
 *   3. Sort pseudonyms longest-first to avoid PERSONA_1 clobbering PERSONA_10.
 *   4. Single-pass regex alternation: each pseudonym is matched literally
 *      (special chars escaped), replaced in one `String.prototype.replace` call.
 *   5. Count total replacements by tallying replacer invocations.
 */
export function applyReverseSubstitution(
  input: string,
  entries: MappingEntry[],
): DecodeResult {
  const pseudoToReal = new Map<string, string>()
  for (const e of entries) {
    if (e.isFalsePositive === true) continue
    if (!pseudoToReal.has(e.pseudonym)) {
      pseudoToReal.set(e.pseudonym, e.realValue)
    }
  }

  if (pseudoToReal.size === 0) {
    return { output: input, count: 0 }
  }

  // Sort longest-first so PERSONA_10 wins over PERSONA_1 in the alternation.
  const pseudonyms = Array.from(pseudoToReal.keys()).sort(
    (a, b) => b.length - a.length,
  )

  const pattern = new RegExp(pseudonyms.map(escapeRegex).join('|'), 'g')
  let count = 0
  const output = input.replace(pattern, (match) => {
    count++
    return pseudoToReal.get(match) ?? match
  })

  return { output, count }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type LocalStatus = 'idle' | 'bearer-validating' | 'checkout-opening'

export function DecodificaPanel(): JSX.Element {
  const { t } = useLanguage()
  const authCtx = useAuthOptional()
  const user = authCtx?.user ?? null
  const granted = authCtx?.reverseSubstitutionGranted ?? false
  const reverseSubstitutionSource = authCtx?.reverseSubstitutionSource ?? null
  const refreshReverseSubstitution =
    authCtx?.refreshReverseSubstitution ?? (async () => {})
  const activeCtx = useActiveMappingOptional()
  const entries = activeCtx?.active?.entries ?? null

  // ── Locked-state form ──────────────────────────────────────────────────────
  const [localStatus, setLocalStatus] = useState<LocalStatus>('idle')
  const [bearerInput, setBearerInput] = useState('')
  const [bearerError, setBearerError] = useState<string | null>(null)

  const handleBearerValidate = useCallback(async () => {
    const trimmed = bearerInput.trim()
    setBearerError(null)
    if (!trimmed || !trimmed.startsWith('mhc_live_')) {
      setBearerError(t('decodifica.locked.bearerFormatInvalid'))
      return
    }
    setLocalStatus('bearer-validating')
    try {
      await claimReverseSubstitutionByBearer(trimmed)
      await refreshReverseSubstitution()
      setBearerInput('')
    } catch (err) {
      if (err instanceof ApiError) {
        setBearerError(
          err.status === 401
            ? t('decodifica.locked.bearerInvalid')
            : err.status === 400
              ? t('decodifica.locked.bearerFormatInvalid')
              : t('decodifica.locked.bearerError'),
        )
      } else {
        setBearerError(t('decodifica.locked.errorGeneric'))
      }
    } finally {
      setLocalStatus('idle')
    }
  }, [bearerInput, refreshReverseSubstitution, t])

  const handlePayCTA = useCallback(async () => {
    setBearerError(null)
    setLocalStatus('checkout-opening')
    try {
      const resp = await claimReverseSubstitutionCheckout()
      if (resp.already_granted) {
        await refreshReverseSubstitution()
        setLocalStatus('idle')
        return
      }
      if (!resp.checkout_url) {
        setBearerError(t('decodifica.locked.errorGeneric'))
        setLocalStatus('idle')
        return
      }
      window.location.href = resp.checkout_url
    } catch {
      setBearerError(t('decodifica.locked.errorGeneric'))
      setLocalStatus('idle')
    }
  }, [refreshReverseSubstitution, t])

  // ── Unlocked-state decode form ─────────────────────────────────────────────
  const [inputText, setInputText] = useState('')
  const [decodeResult, setDecodeResult] = useState<DecodeResult | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const outputRef = useRef<HTMLTextAreaElement>(null)

  const hasMapping = entries !== null && entries.some((e) => !e.isFalsePositive)

  const handleDecode = useCallback(() => {
    if (!inputText.trim() || !entries) return
    const result = applyReverseSubstitution(inputText, entries)
    setDecodeResult(result)
    setCopyState('idle')
    // Scroll output into view on mobile
    setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
  }, [inputText, entries])

  const handleCopyOutput = useCallback(async () => {
    if (!decodeResult?.output) return
    try {
      await navigator.clipboard.writeText(decodeResult.output)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      /* silent — clipboard unavailable */
    }
  }, [decodeResult])

  const handleClear = useCallback(() => {
    setInputText('')
    setDecodeResult(null)
    setCopyState('idle')
  }, [])

  // ── Source label (unlocked state) ─────────────────────────────────────────
  const sourceLabel = (() => {
    switch (reverseSubstitutionSource) {
      case 'paid':
        return t('decodifica.unlocked.sourcePaid')
      case 'mhc_bearer':
        return t('decodifica.unlocked.sourceBearer')
      case 'pro_tier':
        return t('decodifica.unlocked.sourceProTier')
      default:
        return null
    }
  })()

  // ── Render: LOCKED ─────────────────────────────────────────────────────────
  // Polo E flip (SID-20260527, ratified decision_log 2026-05-27 SID-20260527-102449):
  // bearer MHC-L (FREE) is the PRIMARY path with visual emphasis (gradient blue,
  // "Consigliato" badge); the €20 Stripe purchase becomes the FALLBACK with sober
  // visual treatment (subtle gray background, link-style CTA instead of button).
  // Both paths are preserved — source labels `mhc_bearer / paid / pro_tier` stay
  // untouched in the unlocked state. Anonymous users keep the notLoggedIn notice
  // (Polo E flip applies only to logged-in users; anon gating is invariant).
  // Canon: notes/research/recode-it/wireframes/bundle_crosslink_prototype_20260527.html
  if (!granted) {
    return (
      <section
        className="panel decodifica-panel decodifica-panel--locked"
        aria-labelledby="decodifica-heading"
        data-testid="decodifica-panel-locked"
      >
        <h2 id="decodifica-heading" className="panel__heading">
          {t('decodifica.heading')}
        </h2>

        <div className="decodifica-panel__locked-card">
          <h3 className="decodifica-panel__locked-title">
            {t('decodifica.locked.title')}
          </h3>

          {!user ? (
            <p
              className="decodifica-panel__notice"
              data-testid="decodifica-anon-notice"
            >
              {t('decodifica.locked.notLoggedIn')}
            </p>
          ) : (
            <>
              {/* PRIMARY PATH — MHC-L bearer (FREE).
                  Gradient blue card + "Consigliato" badge. Comes FIRST because
                  the bundle path is the cheap-for-user, sticky-for-product flow. */}
              <div
                className="decodifica-panel__locked--primary"
                data-badge={t('decodifica.locked.primaryBadge')}
                data-testid="decodifica-locked-primary"
              >
                <h4>{t('decodifica.locked.primaryTitle')}</h4>
                <p>{t('decodifica.locked.primaryDescription')}</p>
                <label className="field">
                  <span className="field__label">
                    {t('decodifica.locked.bearerLabel')}
                  </span>
                  <input
                    type="text"
                    className="auth-input"
                    value={bearerInput}
                    onChange={(e) => setBearerInput(e.target.value)}
                    placeholder={t('decodifica.locked.bearerPlaceholder')}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={localStatus === 'bearer-validating'}
                    data-testid="decodifica-bearer-input"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleBearerValidate()}
                  disabled={
                    localStatus === 'bearer-validating' ||
                    bearerInput.trim() === ''
                  }
                  data-testid="decodifica-bearer-btn"
                >
                  {localStatus === 'bearer-validating'
                    ? t('decodifica.locked.bearerValidating')
                    : t('decodifica.locked.bearerValidate')}
                </button>
                {bearerError && (
                  <p
                    className="error"
                    role="alert"
                    data-testid="decodifica-bearer-error"
                  >
                    {bearerError}
                  </p>
                )}
                <p
                  className="decodifica-panel__locked-bearer-help"
                  data-testid="decodifica-bearer-help"
                >
                  {t('decodifica.locked.bearerHelp.lead')}{' '}
                  <a
                    href="https://micheleloi.pro/mhc-l/"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="decodifica-bundle-link"
                  >
                    {t('decodifica.locked.bearerHelp.linkText')}
                  </a>{' '}
                  {t('decodifica.locked.bearerHelp.tail')}
                </p>
              </div>

              {/* FALLBACK PATH — €20 Stripe one-time (sober visual).
                  Subtle gray card; link-style CTA (not button) per prototype
                  to keep visual hierarchy in favour of the bundle path. */}
              <div
                className="decodifica-panel__locked--fallback"
                data-testid="decodifica-locked-fallback"
              >
                <div className="decodifica-panel__locked--fallback-label">
                  {t('decodifica.locked.fallbackLabel')}
                </div>
                <h4>{t('decodifica.locked.fallbackTitle')}</h4>
                <p>{t('decodifica.locked.fallbackDescription')}</p>
                <button
                  type="button"
                  className="decodifica-panel__locked--fallback-link"
                  onClick={() => void handlePayCTA()}
                  disabled={localStatus === 'checkout-opening'}
                  data-testid="decodifica-pay-btn"
                >
                  {localStatus === 'checkout-opening'
                    ? t('decodifica.locked.paymentLoading')
                    : t('decodifica.locked.fallbackLink')}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    )
  }

  // ── Render: UNLOCKED ───────────────────────────────────────────────────────
  return (
    <section
      className="panel decodifica-panel decodifica-panel--unlocked"
      aria-labelledby="decodifica-heading"
      data-testid="decodifica-panel-unlocked"
    >
      <h2 id="decodifica-heading" className="panel__heading">
        {t('decodifica.heading')}
      </h2>

      {sourceLabel && (
        <span
          className="decodifica-panel__source-pill"
          data-testid="decodifica-source-pill"
        >
          {sourceLabel}
        </span>
      )}

      <p className="decodifica-panel__subheading">
        {t('decodifica.subheading')}
      </p>

      {/* Output-verification warning (always visible in Decodifica tab — boundary
          disclosure: decoding precision is empirically ~92-95%, AI-generated
          pseudonym variants can survive substitution and require human review). */}
      <div
        className="banner banner--warning"
        role="status"
        data-testid="decodifica-output-warning"
      >
        <strong>{t('decodifica.outputWarning.title')}</strong>{' '}
        {t('decodifica.outputWarning.body')}
      </div>

      {/* No-mapping warning */}
      {!hasMapping && (
        <div
          className="banner banner--warning"
          role="status"
          data-testid="decodifica-no-mapping"
        >
          {t('decodifica.input.noMapping')}
        </div>
      )}

      {/* Input area */}
      <label className="field">
        <span className="field__label">{t('decodifica.input.label')}</span>
        <textarea
          className="field__textarea"
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value)
            setDecodeResult(null) // reset output on new input
          }}
          placeholder={t('decodifica.input.placeholder')}
          rows={10}
          data-testid="decodifica-input"
          disabled={!hasMapping}
        />
      </label>

      <div className="actions actions--inline">
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleDecode}
          disabled={!inputText.trim() || !hasMapping}
          data-testid="decodifica-btn"
        >
          {t('decodifica.action.button')}
        </button>
        {decodeResult && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={handleClear}
            data-testid="decodifica-clear-btn"
          >
            {t('decodifica.output.clear')}
          </button>
        )}
      </div>

      {/* Output area */}
      {decodeResult && (
        <div
          className="decodifica-panel__output"
          data-testid="decodifica-output-section"
        >
          {decodeResult.count > 0 ? (
            <p
              className="decodifica-panel__count"
              role="status"
              data-testid="decodifica-count"
            >
              <strong>{decodeResult.count}</strong>{' '}
              {t('decodifica.output.replacedCount')}
            </p>
          ) : (
            <p
              className="banner banner--warning"
              role="status"
              data-testid="decodifica-zero-replacements"
            >
              {t('decodifica.output.replacedZero')}
            </p>
          )}

          <label className="field">
            <span className="field__label">
              {t('decodifica.output.label')}
            </span>
            <textarea
              ref={outputRef}
              className="field__textarea field__textarea--readonly"
              value={decodeResult.output}
              readOnly
              rows={10}
              data-testid="decodifica-output"
            />
          </label>

          <div className="actions actions--inline">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleCopyOutput()}
              data-testid="decodifica-copy-btn"
            >
              {copyState === 'copied'
                ? t('decodifica.output.copyDone')
                : t('decodifica.output.copyButton')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
