/**
 * IntroBanner.tsx — Variante E "cosa fa + come si usa" dismissibile.
 *
 * Banner unico che combina:
 *   1. Copy "cosa fa": frase 2-period use-case-avvocato (variante `@comm`
 *      ratificata SID-20260601-085130). La prima frase è in <strong>, la
 *      seconda è plain.
 *   2. 3 step compatti "come si usa": Carica → Copia → Riporta. Le parole
 *      chiave (Pseudonimizza/Decodifica + traduzioni) sono in <strong>.
 *   3. Bottone ✕ in alto a destra che persiste il dismiss via
 *      `localStorage.setItem('recode-it.introDismissed', '1')`.
 *
 * Persistenza:
 *   - Al mount, `useState` inizializza leggendo `localStorage`. Se la chiave
 *     vale `'1'` → state iniziale `true` → component renderizza `null`.
 *   - Click su ✕ → setState(true) + scrive localStorage (try/catch per
 *     QuotaExceededError / strict incognito). Banner sparisce immediatamente
 *     (single render, no flicker).
 *   - `typeof window` guard per SSR safety / test env mismatch.
 *
 * Posizionamento:
 *   - Montato in `WireframeWorkArea` come PRIMO figlio della `.wireframe-workarea`
 *     root, sotto la login-bar di `AppHeader` (parent) e SOPRA la
 *     `.wireframe-macro-row` (toolbar 2 modalità). Vale per entrambe le
 *     modalità (codifica / decodifica) — l'intro è generale al prodotto, non
 *     condizionata da `mode`.
 *
 * i18n:
 *   - Copy 4 lingue (IT / EN / DE / FR), keys `app.intro.*` in translations.ts.
 *   - Le porzioni in bold sono inline-split: per la body usiamo 2 keys
 *     (`app.intro.bodyLead` bold + `app.intro.bodyTail` plain). Per ogni step,
 *     pattern split a 3 parti (`step{N}.before`, `step{N}.bold`, `step{N}.after`)
 *     dove `bold` è la singola parola-azione (Carica / Copia+il risultato /
 *     Riporta+la risposta). Questo allinea al pattern già usato in
 *     `bundleBanner.expanded.lead{Before,After}` (split-render canonical).
 *   - aria-label tradotto: "Nascondi questo messaggio".
 *
 * Canon:
 *   - Wireframe Variante E: `MHC-Work/notes/research/recode-it/wireframes/
 *     header_copy_preview/index.html` (`.combo-intro`).
 *   - Founder direttiva SID-20260601-085130 + comm proposta `use-case-avvocato`.
 */

import { useCallback, useState } from 'react'
import { useLanguage } from './LanguageContext'

const DISMISS_KEY = 'recode-it.introDismissed'

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* incognito strict / QuotaExceededError — dismiss vale solo in memoria
       per la sessione corrente, ricomparirà al prossimo reload */
  }
}

export function IntroBanner(): JSX.Element | null {
  const { t } = useLanguage()
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())

  const handleDismiss = useCallback(() => {
    writeDismissed()
    setDismissed(true)
  }, [])

  if (dismissed) return null

  return (
    <div
      className="intro-banner-combo"
      role="region"
      aria-label={t('app.intro.regionAria')}
      data-testid="intro-banner"
    >
      <button
        type="button"
        className="intro-banner-combo__dismiss"
        onClick={handleDismiss}
        aria-label={t('app.intro.dismissAria')}
        title={t('app.intro.dismissAria')}
        data-testid="intro-banner-dismiss"
      >
        ✕
      </button>
      <p className="intro-banner-combo__copy">
        <strong>{t('app.intro.bodyLead')}</strong> {t('app.intro.bodyTail')}
      </p>
      <div className="intro-banner-combo__steps">
        <div className="intro-banner-combo__step">
          <div className="intro-banner-combo__step-num" aria-hidden="true">
            1
          </div>
          <div className="intro-banner-combo__step-text">
            {t('app.intro.step1.before')}
            <strong>{t('app.intro.step1.bold')}</strong>
            {t('app.intro.step1.after')}
          </div>
        </div>
        <div className="intro-banner-combo__step">
          <div className="intro-banner-combo__step-num" aria-hidden="true">
            2
          </div>
          <div className="intro-banner-combo__step-text">
            {t('app.intro.step2.before')}
            <strong>{t('app.intro.step2.bold')}</strong>
            {t('app.intro.step2.after')}
          </div>
        </div>
        <div className="intro-banner-combo__step">
          <div className="intro-banner-combo__step-num" aria-hidden="true">
            3
          </div>
          <div className="intro-banner-combo__step-text">
            {t('app.intro.step3.before')}
            <strong>{t('app.intro.step3.bold')}</strong>
            {t('app.intro.step3.after')}
          </div>
        </div>
      </div>
    </div>
  )
}

export const __TEST__ = { DISMISS_KEY }
