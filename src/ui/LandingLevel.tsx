/**
 * LandingLevel.tsx — Livello 1 del flusso 2-livelli.
 *
 * Spec canonica: MHC-Work/notes/research/recode-it/wireframes/flusso_2livelli/index.html
 *
 * Layout:
 *   - Hero (branding, tagline) — riusa gli stili .app__hero di AppHeader
 *   - 3 trust badge: 100% nel browser / Niente upload al server / GDPR
 *   - Drop-zone unificata con textarea interna + bottone "Continua →" DENTRO
 *     la drop-zone, disabilitato se textarea vuota, abilitato al primo input.
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
 * Canon SID: flusso_2livelli/index.html (2026-06-02).
 */

import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
} from 'react'
import {
  BRAND_BY_LANG,
  TAGLINE_BY_LANG,
  useLanguage,
} from './LanguageContext'
import { extractText, SUPPORTED_EXTENSIONS } from '../extraction/extract'

type Props = {
  /** Called when the user clicks "Continua →" or drops a file. */
  onContinue: (text: string) => void
}

const ACCEPTED_EXTENSIONS = SUPPORTED_EXTENSIONS

export function LandingLevel({ onContinue }: Props): JSX.Element {
  const { t, uiLanguage } = useLanguage()
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
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="landing-hero">
        <div className="landing-hero__text">
          <h1 className="landing-hero__brand">{BRAND_BY_LANG[uiLanguage]}</h1>
          <p className="landing-hero__tagline">{TAGLINE_BY_LANG[uiLanguage]}</p>
        </div>
      </div>

      {/* ── Trust badges ────────────────────────────────────────────── */}
      <div className="landing-badges" aria-label="Garanzie di privacy">
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
        <div
          className="landing-dropzone__icon"
          aria-hidden
          onClick={(e) => {
            e.stopPropagation()
            fileInputRef.current?.click()
          }}
          style={{ cursor: 'pointer' }}
          title="Carica file"
        >
          🗂
        </div>
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

        {/* Hidden file input — triggered by icon click */}
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
