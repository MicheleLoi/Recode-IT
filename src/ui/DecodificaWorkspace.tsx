/**
 * DecodificaWorkspace.tsx — 3-tab wrapper for the post-pivot Recode IT
 * workflow (capabilities_index §9.10):
 *
 *   Tab 1 — Codifica  (free)            → ClipboardWidget (existing)
 *   Tab 2 — Mappa     (free with login) → MappaPanel (new, iter 2)
 *   Tab 3 — Decodifica (€20 una tantum) → DecodificaPanel (new, iter 3)
 *
 * The tab structure is a standard top-tab pattern (role="tablist" / role="tab"
 * / role="tabpanel") — conventional enough that an avvocato who has used any
 * web app in the last 10 years will pick it up instantly (Krug principle 2).
 *
 * Numbered prefixes ("1. Codifica", "2. Mappa", "3. Decodifica") encode the
 * workflow sequence directly into the tab labels, so the user understands
 * order without reading documentation (Krug principle 7 — conventional flow).
 *
 * Used by:
 *   - App.tsx (main work view — replaces bare ClipboardWidget mount)
 *   - DecodificaDemoPage.tsx (dev-only smoke surface at /decodifica-demo)
 */

import { useState } from 'react'
import { ClipboardWidget } from './ClipboardWidget'
import { MappaPanel } from './MappaPanel'
import { DecodificaPanel } from './DecodificaPanel'
import { useLanguage } from './LanguageContext'

export type WorkspaceTab = 'codifica' | 'mappa' | 'decodifica'

type Props = {
  /** Initial tab to show (defaults to 'codifica'). */
  initialTab?: WorkspaceTab
}

export function DecodificaWorkspace({ initialTab = 'codifica' }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab)
  const { t } = useLanguage()

  return (
    <div className="decodifica-workspace">
      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div
        className="workspace-tabs"
        role="tablist"
        aria-label={t('tabs.ariaLabel')}
      >
        <button
          type="button"
          role="tab"
          id="tab-codifica"
          aria-controls="tabpanel-codifica"
          aria-selected={activeTab === 'codifica'}
          className={`workspace-tabs__tab${activeTab === 'codifica' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('codifica')}
          title={t('tabs.codifica.title')}
          data-testid="tab-codifica"
        >
          {t('tabs.codifica')}
        </button>

        <button
          type="button"
          role="tab"
          id="tab-mappa"
          aria-controls="tabpanel-mappa"
          aria-selected={activeTab === 'mappa'}
          className={`workspace-tabs__tab${activeTab === 'mappa' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('mappa')}
          title={t('tabs.mappa.title')}
          data-testid="tab-mappa"
        >
          {t('tabs.mappa')}
        </button>

        <button
          type="button"
          role="tab"
          id="tab-decodifica"
          aria-controls="tabpanel-decodifica"
          aria-selected={activeTab === 'decodifica'}
          className={`workspace-tabs__tab${activeTab === 'decodifica' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('decodifica')}
          title={t('tabs.decodifica.title')}
          data-testid="tab-decodifica"
        >
          {t('tabs.decodifica')}
        </button>
      </div>

      {/* ── Tab panels ─────────────────────────────────────────────────── */}

      {/* Tab 1: Codifica — render always mounted so NER model stays warm */}
      <div
        role="tabpanel"
        id="tabpanel-codifica"
        aria-labelledby="tab-codifica"
        hidden={activeTab !== 'codifica'}
        data-testid="tabpanel-codifica"
      >
        <ClipboardWidget />
      </div>

      {/* Tab 2: Mappa */}
      {activeTab === 'mappa' && (
        <div
          role="tabpanel"
          id="tabpanel-mappa"
          aria-labelledby="tab-mappa"
          data-testid="tabpanel-mappa"
        >
          <MappaPanel />
        </div>
      )}

      {/* Tab 3: Decodifica */}
      {activeTab === 'decodifica' && (
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
