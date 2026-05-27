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
 * La precedente architettura 2-macro toggle (ClipboardWidget alternato a
 * DecodificaPanel) viene superata: `WireframeWorkArea` integra entrambe le
 * macro come stato interno, con flusso che si inverte (sx=input editabile in
 * Codifica, dx=input editabile in Decodifica), label dei panel semantici
 * stabili. ClipboardWidget + DecodificaPanel + PseudonymizePanel restano nel
 * tree e sono ancora utilizzati da `DecodificaDemoPage.tsx` (dev smoke
 * surface a /decodifica-demo) per audit/regression del flusso vecchio se
 * serve.
 *
 * Used by:
 *   - App.tsx (main work view, route 'work')
 *   - DecodificaDemoPage.tsx (dev-only smoke surface — usa ancora il vecchio
 *     flow, non viene tipicamente toccata).
 */

import { WireframeWorkArea } from './WireframeWorkArea'

/**
 * Backward-compat type — alcuni file di test / dev possono ancora importare
 * `WorkspaceTab` / `WorkspaceMacro`. La sostanza ora vive dentro
 * `WireframeWorkArea` (macro mode interno).
 */
export type WorkspaceMacro = 'codifica' | 'decodifica'
export type WorkspaceTab = WorkspaceMacro

type Props = {
  /** Initial macro to show (defaults to 'codifica'). */
  initialMacro?: WorkspaceMacro
}

export function DecodificaWorkspace({
  initialMacro = 'codifica',
}: Props): JSX.Element {
  return (
    <div className="decodifica-workspace" data-testid="decodifica-workspace">
      <WireframeWorkArea initialMode={initialMacro} />
    </div>
  )
}
