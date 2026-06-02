/**
 * DecodificaWorkspace.tsx — wireframe-first work area shell.
 *
 * Post SID-20260527 ("cambia tutto, rendilo come il prototype"), questo
 * componente è un thin wrapper che monta `WireframeWorkArea` — il quale
 * contiene 2-macro toggle + toolbar centrata + 2 panel side-by-side +
 * sezione mappa cards + modal "I miei mapping" + Decodifica preview
 * pattern, tutto in un'unica surface coerente al prototype HTML
 * (`MHC-Work/notes/research/recode-it/wireframes/prototype/prototype.html`).
 *
 * Post 2026-06-02 (redesign 2-livelli, flusso_2livelli/index.html):
 * Il default view è ora TwoLevelShell che gestisce:
 *   - Livello 1: LandingLevel (hero + badge + drop-zone unificata)
 *   - Livello 2: WireframeWorkArea (pulsantoni + 2 colonne + mappa laterale)
 *
 * La prop `initialMacro` è preservata per backward compat con DecodificaDemoPage
 * e altri consumer che montano direttamente WireframeWorkArea via questo wrapper.
 * Quando non specificata (default), usa TwoLevelShell (flusso 2-livelli).
 *
 * La precedente architettura (ClipboardWidget alternato a DecodificaPanel)
 * viene superata: WireframeWorkArea integra entrambe le macro come stato interno.
 * ClipboardWidget + DecodificaPanel + PseudonymizePanel restano nel tree e sono
 * ancora utilizzati da DecodificaDemoPage.tsx (dev smoke surface a /decodifica-demo).
 *
 * Used by:
 *   - App.tsx (main work view, route 'work')
 *   - DecodificaDemoPage.tsx (dev-only smoke surface — usa ancora il vecchio flow)
 */

import { WireframeWorkArea } from './WireframeWorkArea'
import { TwoLevelShell } from './TwoLevelShell'

/**
 * Backward-compat type — alcuni file di test / dev possono ancora importare
 * `WorkspaceTab` / `WorkspaceMacro`. La sostanza ora vive dentro
 * `WireframeWorkArea` (macro mode interno).
 */
export type WorkspaceMacro = 'codifica' | 'decodifica'
export type WorkspaceTab = WorkspaceMacro

type Props = {
  /**
   * Initial macro to show (defaults to 'codifica').
   * When provided explicitly, bypasses TwoLevelShell and mounts
   * WireframeWorkArea directly (legacy path for DecodificaDemoPage, tests, etc.).
   */
  initialMacro?: WorkspaceMacro
  /**
   * When true, bypass TwoLevelShell and use WireframeWorkArea directly.
   * Useful for dev smoke surfaces that don't want the landing level.
   */
  bypassLanding?: boolean
}

export function DecodificaWorkspace({
  initialMacro,
  bypassLanding = false,
}: Props): JSX.Element {
  // Use TwoLevelShell (flusso 2-livelli) unless explicitly bypassed or
  // an initialMacro is provided (backward compat).
  if (!bypassLanding && initialMacro === undefined) {
    return (
      <div className="decodifica-workspace" data-testid="decodifica-workspace">
        <TwoLevelShell />
      </div>
    )
  }

  return (
    <div className="decodifica-workspace" data-testid="decodifica-workspace">
      <WireframeWorkArea initialMode={initialMacro ?? 'codifica'} />
    </div>
  )
}
