/**
 * DecodificaWorkspace.tsx — 2-macro toggle wrapper (post wireframe-first
 * SID-20260526-172143 redesign Phase 2a):
 *
 *   Macro 1 — "Sostituisci con pseudonimo" (= Codifica, gratis) → ClipboardWidget
 *   Macro 2 — "Rimetti a posto gli originali" (= Decodifica, €20 / chiave MHC) → DecodificaPanel
 *
 * Sostituisce la precedente 3-tab structure (1. Codifica / 2. Mappa / 3. Decodifica).
 * Decisione founder ratifica SID-20260526-172143: i 2 button macro usano
 * natural-language task descriptions del mental model utente, NON jargon
 * canon-side ("Codifica/Decodifica"). Il nome del bottone descrive cosa
 * l'utente fa col documento, non la funzione interna.
 *
 * Mappa (precedente tab 2) accessibile via "I miei mapping" nel nav top
 * (App.tsx → AccountDashboard). Integrazione in-workflow come sezione card
 * sotto i panel arriverà in Phase 2c/2d.
 *
 * Used by:
 *   - App.tsx (main work view)
 *   - DecodificaDemoPage.tsx (dev-only smoke surface at /decodifica-demo)
 */

import { useState } from 'react'
import { ClipboardWidget } from './ClipboardWidget'
import { DecodificaPanel } from './DecodificaPanel'
import { useLanguage } from './LanguageContext'

export type WorkspaceMacro = 'codifica' | 'decodifica'

/** Backward-compat alias for legacy code that may still import WorkspaceTab. */
export type WorkspaceTab = WorkspaceMacro

type Props = {
  /** Initial macro to show (defaults to 'codifica'). */
  initialMacro?: WorkspaceMacro
}

export function DecodificaWorkspace({
  initialMacro = 'codifica',
}: Props): JSX.Element {
  const [activeMacro, setActiveMacro] = useState<WorkspaceMacro>(initialMacro)
  const { t } = useLanguage()

  return (
    <div className="decodifica-workspace">
      {/* ── 2-macro toggle (replaces 3-tab nav) ──────────────────────────── */}
      <div
        className="macro-toggle"
        role="tablist"
        aria-label={t('macro.ariaLabel')}
      >
        <button
          type="button"
          role="tab"
          id="tab-codifica"
          aria-controls="tabpanel-codifica"
          aria-selected={activeMacro === 'codifica'}
          className={`macro-toggle__btn${activeMacro === 'codifica' ? ' is-active' : ''}`}
          onClick={() => setActiveMacro('codifica')}
          title={t('macro.codifica.title')}
          data-testid="tab-codifica"
        >
          {t('macro.codifica')}
        </button>

        <button
          type="button"
          role="tab"
          id="tab-decodifica"
          aria-controls="tabpanel-decodifica"
          aria-selected={activeMacro === 'decodifica'}
          className={`macro-toggle__btn${activeMacro === 'decodifica' ? ' is-active' : ''}`}
          onClick={() => setActiveMacro('decodifica')}
          title={t('macro.decodifica.title')}
          data-testid="tab-decodifica"
        >
          {t('macro.decodifica')}
        </button>
      </div>

      {/* ── Macro panels ──────────────────────────────────────────────────── */}

      {/* Macro 1: Codifica — kept always mounted so NER model stays warm */}
      <div
        role="tabpanel"
        id="tabpanel-codifica"
        aria-labelledby="tab-codifica"
        hidden={activeMacro !== 'codifica'}
        data-testid="tabpanel-codifica"
      >
        <ClipboardWidget />
      </div>

      {/* Macro 2: Decodifica */}
      {activeMacro === 'decodifica' && (
        <div
          role="tabpanel"
          id="tabpanel-decodifica"
          aria-labelledby="tab-decodifica"
          data-testid="tabpanel-decodifica"
        >
          <DecodificaPanel />
        </div>
      )}
    </div>
  )
}
