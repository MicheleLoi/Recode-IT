/**
 * LandingLevel.tsx — Livello 1 del flusso 2-livelli.
 *
 * Spec canonica: MHC-Work/notes/research/recode-it/wireframes/flusso_2livelli/index.html
 *
 * Layout:
 *   - Hero (branding, tagline) — riusa gli stili .app__hero di AppHeader
 *   - 3 trust badge: 100% nel browser / Niente upload al server / GDPR
 *   - Intro section: headline "Pseudonimizza i dati prima di mandarli all'AI"
 *     + 2 step (Codifica / Decodifica) + trust points.
 *     Copy verbatim da communication/recode-it/site_copy_draft_20260524.md
 *     (§"Cosa fa, in due tempi"). i18n 4 lingue (keys landing.intro.*).
 *   - Drop-zone unificata con textarea interna + bottone "Continua →" DENTRO
 *     la drop-zone, disabilitato se textarea vuota, abilitato al primo input.
 *   - L1-a: upload-per-click leggibile — freccia-su + testo "… o clicca per
 *     caricare" sotto la textarea (link cliccabile, chiaro).
 *   - L'utente incolla/trascina il documento → "Continua →" attivo → click →
 *     il testo viene passato al Livello 2 (WireframeWorkArea via onContinue).
 *
 * Il "Continua →" è l'UNICO ingresso al Livello 2. Non c'è bottone separato
 * fuori dalla drop-zone. Non c'è scelta modalità (Codifica/Decodifica) qui:
 * quella scelta vive in Livello 2 (pulsantoni PSEUDONIMIZZA / DECODIFICA).
 *
 * i18n: chiavi 'landing.*' in translations.ts (IT/EN/DE/FR complete).
 * Il brand + tagline vengono da LanguageContext (BRAND_BY_LANG / TAGLINE_BY_LANG)
 * come nel resto dell'app.
 *
 * Drag & Drop: la drop-zone accetta file (stessi formati di WireframeWorkArea:
 * .txt/.md/.docx/.pdf). Sul drop si estrae il testo via extractText e si
 * chiama onContinue immediatamente (non serve premere "Continua →").
 *
 * Canon SID: flusso_2livelli/index.html (2026-06-02). Refinement SID-20260602.
 */

import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
} from 'react'
import { useLanguage } from './LanguageContext'
import { extractText, SUPPORTED_EXTENSIONS } from '../extraction/extract'

type Props = {
  /** Called when the user clicks "Continua →" or drops a file. */
  onContinue: (text: string) => void
}

const ACCEPTED_EXTENSIONS = SUPPORTED_EXTENSIONS

export function LandingLevel({ onContinue }: Props): JSX.Element {
  const { t } = useLanguage()
  const [text, setText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      setError(null)
      if (!files || files.length === 0) return
      const file = files[0]
      if (!file) return
      const name = file.name.toLowerCase()
      if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        setError(
          `Formato non supportato. Trascina un file ${ACCEPTED_EXTENSIONS.join(', ')}.`,
        )
        return
      }
      setLoading(true)
      try {
        const result = await extractText(file)
        if (result.scannedPdf) {
          setError(
            'PDF scannerizzato: nessun testo selezionabile. Carica una versione testuale.',
          )
          setLoading(false)
          return
        }
        // Drop → continua subito, senza aspettare il click su "Continua →"
        onContinue(result.text)
      } catch (err) {
        setError(`Impossibile leggere il file: ${(err as Error).message}`)
      } finally {
        setLoading(false)
      }
    },
    [onContinue],
  )

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    void handleFiles(e.dataTransfer.files)
  }
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(true)
  }
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
  }
  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    void handleFiles(e.target.files)
  }

  const handleContinue = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onContinue(trimmed)
  }

  return (
    <div className="landing-level" data-testid="landing-level">
      {/* Hero rimosso (item 3, SID-20260602): brand+tagline già presenti
          nell'header globale AppHeader. La landing parte dai badge + intro. */}

      {/* ── Trust badges ────────────────────────────────────────────── */}
      {/* data-testid anchors onboarding bubble 2 (ONBOARDING_STEPS[1]); without
          it the tour's querySelector('[data-testid="landing-badges"]') returned
          null and step 2's rect never resolved (the spotlight/bubble stayed
          hidden). The class name alone is not a stable anchor for the tour. */}
      <div className="landing-badges" data-testid="landing-badges" aria-label="Garanzie di privacy">
        <span className="landing-badge">
          <span className="landing-badge__icon" aria-hidden>🔒</span>
          {t('landing.badge.browser')}
        </span>
        <span className="landing-badge">
          <span className="landing-badge__icon" aria-hidden>✓</span>
          {t('landing.badge.noUpload')}
        </span>
        <span className="landing-badge">
          <span className="landing-badge__icon" aria-hidden>📄</span>
          {t('landing.badge.gdpr')}
        </span>
      </div>

      {/* ── Intro section (L1-b) ─────────────────────────────────────
          Copy verbatim da site_copy_draft_20260524.md §"Cosa fa, in due tempi".
          Headline + 2 step (Codifica / Decodifica) + trust points.
          Posizione: dopo i badge, prima della drop-zone. ──────────── */}
      <div className="landing-intro" data-testid="landing-intro">
        <h2 className="landing-intro__headline">{t('landing.intro.headline')}</h2>
        <div className="landing-intro__steps">
          <div className="landing-intro__step">
            <span className="landing-intro__step-label">{t('landing.intro.step1.label')}</span>
            <p className="landing-intro__step-body">{t('landing.intro.step1.body')}</p>
          </div>
          <div className="landing-intro__step">
            <span className="landing-intro__step-label">{t('landing.intro.step2.label')}</span>
            <p className="landing-intro__step-body">{t('landing.intro.step2.body')}</p>
          </div>
        </div>
        <p className="landing-intro__trust">
          {t('landing.intro.trust')} {t('landing.intro.gdpr')}
        </p>
      </div>

      {/* ── Unified drop-zone ────────────────────────────────────────── */}
      <div
        className={`landing-dropzone${dragOver ? ' landing-dropzone--dragover' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => {
          // Click on the drop-zone (outside the textarea) → focus textarea
          if (document.activeElement?.tagName !== 'TEXTAREA') {
            document.getElementById('landing-dropzone-textarea')?.focus()
          }
        }}
        data-testid="landing-dropzone"
        role="region"
        aria-label={t('landing.dropzone.title')}
      >
        <div className="landing-dropzone__title">{t('landing.dropzone.title')}</div>
        <div className="landing-dropzone__hint">{t('landing.dropzone.hint')}</div>

        <textarea
          id="landing-dropzone-textarea"
          className="landing-dropzone__textarea"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          placeholder={t('landing.dropzone.placeholder')}
          onClick={(e) => e.stopPropagation()}
          data-testid="landing-dropzone-textarea"
          rows={6}
        />

        {/* L1-a: upload-per-click leggibile — freccia-su + testo esplicito.
            Posizione: sotto la textarea, sopra il bottone Continua.
            Non più icona 🗂 sgranata: un link con affordance visiva chiara. */}
        <button
          type="button"
          className="landing-dropzone__upload-link"
          onClick={(e) => {
            e.stopPropagation()
            fileInputRef.current?.click()
          }}
          data-testid="landing-upload-link"
        >
          <span className="landing-dropzone__upload-arrow" aria-hidden>↑</span>
          {t('landing.dropzone.uploadLink')}
        </button>

        <button
          type="button"
          className="landing-dropzone__cta"
          disabled={!text.trim() || loading}
          onClick={(e) => {
            e.stopPropagation()
            handleContinue()
          }}
          data-testid="landing-dropzone-cta"
        >
          {loading ? '…' : t('landing.dropzone.cta')}
        </button>

        {/* Hidden file input — triggered by upload-link button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleFileInput}
          style={{ display: 'none' }}
          data-testid="landing-file-input"
        />
      </div>

      {error && (
        <p className="error" role="alert" data-testid="landing-error">
          {error}
        </p>
      )}
    </div>
  )
}
