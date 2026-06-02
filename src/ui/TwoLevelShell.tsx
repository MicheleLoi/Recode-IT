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

import { useCallback, useEffect, useState } from 'react'
import { LandingLevel } from './LandingLevel'
import { useLanguage } from './LanguageContext'
import { WireframeWorkArea } from './WireframeWorkArea'
import { OnboardingTour } from './onboarding/OnboardingTour'
import {
  ONBOARDING_REPLAY_EVENT,
  readOnboardingDone,
  writeOnboardingDone,
} from './onboarding/onboarding-shared'

type Level = 'landing' | 'work'

export function TwoLevelShell(): JSX.Element {
  const { t } = useLanguage()
  const [level, setLevel] = useState<Level>('landing')
  const [initialText, setInitialText] = useState<string>('')

  // Onboarding "guida a bolle" — runs once on first access. The tour spans both
  // levels (bubbles 1-3 on landing, bubble 4 in the work area). TwoLevelShell
  // hosts it because it owns the level state that the L1→L2 hand-off needs.
  // `tourActive` starts true only when the done-flag is unset; the "?" header
  // button re-activates it via the ONBOARDING_REPLAY_EVENT bridge (without
  // permanently clearing the flag — finishing/skipping a replay just re-persists
  // done=1).
  const [tourActive, setTourActive] = useState<boolean>(() => !readOnboardingDone())

  const handleContinue = useCallback((text: string) => {
    setInitialText(text)
    setLevel('work')
  }, [])

  const handleBackToLanding = useCallback(() => {
    setInitialText('')
    setLevel('landing')
  }, [])

  // Replay bridge: the "?" button in AppHeader (a sibling outside this subtree)
  // dispatches ONBOARDING_REPLAY_EVENT. We reset to the landing level so bubble
  // 1's target exists, then re-open the tour from the start.
  useEffect(() => {
    const onReplay = () => {
      setInitialText('')
      setLevel('landing')
      // Force a fresh mount of the tour so it restarts at step 0 even if it was
      // already active (toggle off→on across a microtask).
      setTourActive(false)
      window.setTimeout(() => setTourActive(true), 0)
    }
    window.addEventListener(ONBOARDING_REPLAY_EVENT, onReplay)
    return () => window.removeEventListener(ONBOARDING_REPLAY_EVENT, onReplay)
  }, [])

  const handleTourFinish = useCallback(() => {
    writeOnboardingDone()
    setTourActive(false)
  }, [])

  const handleTourSkip = useCallback(() => {
    writeOnboardingDone()
    setTourActive(false)
  }, [])

  const requestLevel = useCallback((next: Level) => {
    setLevel((prev) => (prev === next ? prev : next))
  }, [])

  // The tour is rendered as an overlay sibling so it survives the landing↔work
  // swap below (it must persist across the L1→L2 transition it drives). Keyed so
  // a replay produces a clean remount at step 0.
  const tour = tourActive ? (
    <OnboardingTour
      currentLevel={level}
      onRequestLevel={requestLevel}
      onFinish={handleTourFinish}
      onSkip={handleTourSkip}
    />
  ) : null

  if (level === 'landing') {
    return (
      <>
        <LandingLevel onContinue={handleContinue} />
        {tour}
      </>
    )
  }

  return (
    <>
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
      {tour}
    </>
  )
}
