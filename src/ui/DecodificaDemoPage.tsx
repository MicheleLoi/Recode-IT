/**
 * DecodificaDemoPage.tsx — DEV-ONLY standalone smoke surface for the full
 * Decodifica workflow (all 3 tabs: Codifica / Mappa / Decodifica).
 *
 * Mounted by App.tsx when `import.meta.env.DEV &&
 * location.pathname === '/decodifica-demo'`, BEFORE any auth/api providers
 * — so it works offline against a non-running backend. Unreachable in
 * production (Vite tree-shakes the conditional).
 *
 * Strategy: inject mocked AuthContext + ActiveMappingContext so
 * MappaPanel and DecodificaPanel render against controlled state.
 * The Codifica tab (ClipboardWidget) is shown in an "unavailable offline"
 * placeholder — ClipboardWidget mounts the full NER pipeline and issues
 * real /recode/me fetches, which would fail in offline mode. The demo
 * focuses on the two new panels.
 *
 * Three demo modes (same mental model as the old ViewKeyDemoPage):
 *   • locked-anon       → Decodifica locked + sign-in nudge
 *   • locked-logged-in  → Decodifica locked + pay/bearer CTAs
 *   • unlocked          → Decodifica unlocked + 8 mock mapping rows
 *
 * Cleanup: delete this file + the small dev branch in App.tsx together.
 */

import { useMemo, useState } from 'react'
import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
} from '../auth/auth-context'
import {
  ActiveMappingContext,
  type ActiveMappingContextValue,
} from '../auth/active-mapping-context'
import { LanguageProvider } from './LanguageContext'
import { MappaPanel } from './MappaPanel'
import { DecodificaPanel } from './DecodificaPanel'
import { useLanguage } from './LanguageContext'
import type { MappingEntry } from '../types/engine'

type DemoMode = 'locked-anon' | 'locked-logged-in' | 'unlocked'

const MOCK_USER: AuthUser = {
  user_id: 'demo-user-id',
  email: 'demo@recode-it.local',
  kdf_salt: 'demo-salt',
  email_verified: true,
  tier: 'free',
  name: 'Demo User',
  marketing_consent: false,
}

const MOCK_ENTRIES: MappingEntry[] = [
  { realValue: 'Mario Rossi', pseudonym: 'PERSONA_01', category: 'persona', isFalsePositive: false },
  { realValue: 'Giulia Bianchi', pseudonym: 'PERSONA_02', category: 'persona', isFalsePositive: false },
  { realValue: 'Lorenzo De Luca', pseudonym: 'PERSONA_03', category: 'persona', isFalsePositive: false },
  { realValue: 'Studio Legale Verdi & Associati', pseudonym: 'ENTE_01', category: 'organizzazione', isFalsePositive: false },
  { realValue: 'Banca Popolare di Milano', pseudonym: 'ENTE_02', category: 'organizzazione', isFalsePositive: false },
  { realValue: 'Tribunale di Torino', pseudonym: 'TRIBUNALE_01', category: 'tribunale', isFalsePositive: false },
  { realValue: 'Via Garibaldi 42, Roma', pseudonym: 'LUOGO_01', category: 'luogo', isFalsePositive: false },
  { realValue: 'CF: RSSMRA80A01H501Z', pseudonym: 'CODICE_01', category: 'codice', isFalsePositive: false },
]

function buildAuthValue(mode: DemoMode): AuthContextValue {
  const noopVoidAsync = async (): Promise<void> => { /* demo no-op */ }
  const noopSync = (): void => { /* demo no-op */ }
  return {
    user: mode === 'locked-anon' ? null : MOCK_USER,
    masterKey: null,
    loading: false,
    signup: noopVoidAsync as unknown as AuthContextValue['signup'],
    login: noopVoidAsync as unknown as AuthContextValue['login'],
    logout: noopVoidAsync,
    unlock: noopVoidAsync,
    lockKey: noopSync,
    refresh: noopVoidAsync,
    reverseSubstitutionGranted: mode === 'unlocked',
    reverseSubstitutionSource: mode === 'unlocked' ? 'paid' : null,
    refreshReverseSubstitution: noopVoidAsync,
  }
}

function buildActiveMappingValue(mode: DemoMode): ActiveMappingContextValue {
  const noopVoidAsync = async (): Promise<void> => { /* demo no-op */ }
  const noopStringAsync = async (): Promise<string> => ''
  const noopSync = (): void => { /* demo no-op */ }
  return {
    active:
      mode === 'unlocked'
        ? {
            mappingId: 'demo-mapping-id',
            label: 'Demo Mapping (smoke)',
            mapper: null as never,
            entries: MOCK_ENTRIES,
            dirty: false,
            pristine: true,
          }
        : null,
    saveActive: noopStringAsync as unknown as ActiveMappingContextValue['saveActive'],
    openMapping: noopVoidAsync,
    closeActive: noopSync,
    updateEntries: noopSync,
    deleteActive: noopVoidAsync,
    renameActive: noopSync,
  }
}

/** Inner content — uses useLanguage so must live inside LanguageProvider. */
function DemoContent(): JSX.Element {
  const { t } = useLanguage()
  const [mode, setMode] = useState<DemoMode>('locked-logged-in')
  const [activeTab, setActiveTab] = useState<'mappa' | 'decodifica'>('decodifica')

  const authValue = useMemo(() => buildAuthValue(mode), [mode])
  const activeValue = useMemo(() => buildActiveMappingValue(mode), [mode])

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '24px',
        fontFamily: 'system-ui, sans-serif',
        background: '#f5f7fa',
      }}
    >
      {/* ── Dev header ─────────────────────────────────────────────── */}
      <header
        style={{
          maxWidth: '800px',
          margin: '0 auto 24px',
          padding: '16px 20px',
          background: '#fff',
          border: '1px solid #d0d6de',
          borderRadius: '6px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
        }}
      >
        <h1 style={{ margin: '0 0 4px', fontSize: '1.2rem' }}>
          Decodifica Workspace — Dev Smoke (/decodifica-demo)
        </h1>
        <p style={{ margin: '0 0 12px', color: '#555', fontSize: '0.85rem' }}>
          Mappa + Decodifica con mocked context. La tab Codifica è omessa qui (richiede NER + backend online).
          Cliccando pay/bearer si riceve un errore di rete: è comportamento atteso.
        </p>

        {/* Mode selector */}
        <fieldset
          style={{
            border: '1px solid #d0d6de',
            borderRadius: '4px',
            padding: '8px 12px',
            marginBottom: '10px',
          }}
        >
          <legend style={{ padding: '0 4px', fontSize: '0.85rem' }}>
            Stato Decodifica
          </legend>
          {(['locked-anon', 'locked-logged-in', 'unlocked'] as DemoMode[]).map((m) => (
            <label
              key={m}
              style={{ marginRight: 16, cursor: 'pointer', fontSize: '0.9rem' }}
            >
              <input
                type="radio"
                name="demo-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                data-testid={`demo-mode-${m}`}
              />{' '}
              {m === 'locked-anon'
                ? 'Locked — anonimo'
                : m === 'locked-logged-in'
                  ? 'Locked — autenticato (pay/bearer)'
                  : 'Unlocked — 8 mock entries'}
            </label>
          ))}
        </fieldset>

        {/* Tab selector */}
        <fieldset
          style={{
            border: '1px solid #d0d6de',
            borderRadius: '4px',
            padding: '8px 12px',
          }}
        >
          <legend style={{ padding: '0 4px', fontSize: '0.85rem' }}>
            Tab
          </legend>
          {(['mappa', 'decodifica'] as const).map((tab) => (
            <label
              key={tab}
              style={{ marginRight: 16, cursor: 'pointer', fontSize: '0.9rem' }}
            >
              <input
                type="radio"
                name="demo-tab"
                value={tab}
                checked={activeTab === tab}
                onChange={() => setActiveTab(tab)}
                data-testid={`demo-tab-${tab}`}
              />{' '}
              {tab === 'mappa' ? '2. Mappa' : '3. Decodifica'}
            </label>
          ))}
        </fieldset>
      </header>

      {/* ── Mocked workspace panels ─────────────────────────────────── */}
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Tab bar mirroring the real workspace */}
        <div
          className="workspace-tabs"
          role="tablist"
          aria-label={t('tabs.ariaLabel')}
          style={{ marginBottom: 0 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mappa'}
            className={`workspace-tabs__tab${activeTab === 'mappa' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('mappa')}
            data-testid="workspace-tab-mappa"
          >
            {t('tabs.mappa')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'decodifica'}
            className={`workspace-tabs__tab${activeTab === 'decodifica' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('decodifica')}
            data-testid="workspace-tab-decodifica"
          >
            {t('tabs.decodifica')}
          </button>
        </div>

        <AuthContext.Provider value={authValue}>
          <ActiveMappingContext.Provider value={activeValue}>
            {activeTab === 'mappa' ? <MappaPanel /> : <DecodificaPanel />}
          </ActiveMappingContext.Provider>
        </AuthContext.Provider>
      </div>
    </div>
  )
}

export function DecodificaDemoPage(): JSX.Element {
  return (
    <LanguageProvider>
      <DemoContent />
    </LanguageProvider>
  )
}
