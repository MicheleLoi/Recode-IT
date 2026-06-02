/**
 * TwoLevelShell.tsx — orchestratore del flusso 2-livelli (Recode IT redesign).
 *
 * Spec canonica: MHC-Work/notes/research/recode-it/wireframes/flusso_2livelli/index.html
 * Canon SID: flusso_2livelli/index.html (2026-06-02). Refinement SID-20260602.
 *
 * Gestisce lo stato `level: 'landing' | 'work'`:
 *   - 'landing'  → LandingLevel (hero + badge + intro + drop-zone unificata con "Continua →")
 *   - 'work'     → WireframeWorkArea (pulsantoni + 2 colonne + mappa laterale)
 *
 * Il passaggio da landing a work avviene via `onContinue(text)`:
 *   il testo incollato/trascinato in Livello 1 diventa `initialText` di
 *   WireframeWorkArea, pre-popolando il pannello originale in Livello 2.
 *
 * Architettura:
 *   DecodificaWorkspace → TwoLevelShell → LandingLevel | WireframeWorkArea
 *
 * Note:
 *   - showMappaLaterale=true abilita la 3a colonna mappa in WireframeWorkArea.
 *   - initialMode default 'codifica' (l'utente ha incollato un documento da
 *     pseudonimizzare). Il toggle PSEUDONIMIZZA/DECODIFICA in Livello 2 è
 *     sempre disponibile per switchare.
 *   - L2-b: bottone "← Torna all'inizio / Nuovo documento" prominente e
 *     internazionalizzato (key shell.backToStart, 4 lingue). Visibile e
 *     chiaro per l'utente distratto — non si perde nel layout.
 */

import { useCallback, useState } from 'react'
import { LandingLevel } from './LandingLevel'
import { useLanguage } from './LanguageContext'
import { WireframeWorkArea } from './WireframeWorkArea'

type Level = 'landing' | 'work'

export function TwoLevelShell(): JSX.Element {
  const { t } = useLanguage()
  const [level, setLevel] = useState<Level>('landing')
  const [initialText, setInitialText] = useState<string>('')

  const handleContinue = useCallback((text: string) => {
    setInitialText(text)
    setLevel('work')
  }, [])

  const handleBackToLanding = useCallback(() => {
    setInitialText('')
    setLevel('landing')
  }, [])

  if (level === 'landing') {
    return <LandingLevel onContinue={handleContinue} />
  }

  return (
    <div className="two-level-work" data-testid="two-level-work">
      {/* L2-b: bottone "← Torna all'inizio / Nuovo documento" prominente.
          Visibile e chiaro — non ci si perde. i18n 4 lingue (shell.backToStart).
          Niente mini-upload in L2: l'upload vive in L1. */}
      <button
        type="button"
        className="two-level-back-btn two-level-back-btn--prominent"
        onClick={handleBackToLanding}
        data-testid="two-level-back-btn"
      >
        {t('shell.backToStart')}
      </button>
      <WireframeWorkArea
        initialMode="codifica"
        initialText={initialText}
        showMappaLaterale={true}
      />
    </div>
  )
}
