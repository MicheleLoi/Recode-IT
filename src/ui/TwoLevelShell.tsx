/**
 * TwoLevelShell.tsx — orchestratore del flusso 2-livelli (Recode IT redesign).
 *
 * Spec canonica: MHC-Work/notes/research/recode-it/wireframes/flusso_2livelli/index.html
 * Canon SID: flusso_2livelli/index.html (2026-06-02).
 *
 * Gestisce lo stato `level: 'landing' | 'work'`:
 *   - 'landing'  → LandingLevel (hero + badge + drop-zone unificata con "Continua →")
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
 *   - Il bottone "← Torna all'inizio" in work area permette di tornare al
 *     Livello 1 (reset testo + stato). Non è nel wireframe ma è utile per
 *     l'UX reale — è un link discreto.
 */

import { useCallback, useState } from 'react'
import { LandingLevel } from './LandingLevel'
import { WireframeWorkArea } from './WireframeWorkArea'

type Level = 'landing' | 'work'

export function TwoLevelShell(): JSX.Element {
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
      {/* Bottone "← Inizia di nuovo" — discreto, per tornare al Livello 1. */}
      <button
        type="button"
        className="two-level-back-btn"
        onClick={handleBackToLanding}
        data-testid="two-level-back-btn"
      >
        ← Inizia di nuovo
      </button>
      <WireframeWorkArea
        initialMode="codifica"
        initialText={initialText}
        showMappaLaterale={true}
      />
    </div>
  )
}
