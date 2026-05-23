/**
 * ViewKeyDemoPage.tsx — DEV-ONLY standalone smoke surface for ViewKeyModal.
 *
 * Mounted by App.tsx when `import.meta.env.DEV && location.pathname ===
 * '/view-key-demo'`, BEFORE any auth/api providers are constructed — so it
 * works offline against a non-running backend. The route is unreachable in
 * production builds (Vite tree-shakes the conditional + Vite production env
 * sets DEV=false).
 *
 * Strategy: instead of mounting the real AuthProvider + ActiveMappingProvider
 * (which would fire `/recode/me` and `/recode/view-key/permission` requests
 * the moment they mount), we inject mocked context values directly via the
 * exported AuthContext.Provider / ActiveMappingContext.Provider. The modal's
 * tolerant `useAuthOptional` / `useActiveMappingOptional` hooks consume the
 * mocked values transparently.
 *
 * Layout: a toggle (radio buttons) flips between locked-anonymous,
 * locked-logged-in, and unlocked-with-mapping. Only one modal is on screen
 * at a time so we get full-fidelity rendering (the real modal uses
 * position:fixed overlay — stacking two would distort the visual).
 *
 * Cleanup: delete this file + the small dev-mode branch in App.tsx + revert
 * the `export const` on AuthContext / ActiveMappingContext.
 */

import { useMemo, useState } from 'react'
import { AuthContext, type AuthContextValue, type AuthUser } from '../auth/auth-context'
import {
  ActiveMappingContext,
  type ActiveMappingContextValue,
} from '../auth/active-mapping-context'
import { LanguageProvider } from './LanguageContext'
import { ViewKeyModal } from './ViewKeyModal'
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

// 8 mock entries spanning persona / ente / luogo / codice categories so the
// table renders realistic content for visual smoke (not just one row).
const MOCK_ENTRIES: MappingEntry[] = [
  { realValue: 'Mario Rossi', pseudonym: 'PERSONA_01', category: 'persona' },
  { realValue: 'Giulia Bianchi', pseudonym: 'PERSONA_02', category: 'persona' },
  { realValue: 'Lorenzo De Luca', pseudonym: 'PERSONA_03', category: 'persona' },
  { realValue: 'Studio Legale Verdi & Associati', pseudonym: 'ENTE_01', category: 'organizzazione' },
  { realValue: 'Banca Popolare di Milano', pseudonym: 'ENTE_02', category: 'organizzazione' },
  { realValue: 'Tribunale di Torino', pseudonym: 'TRIBUNALE_01', category: 'tribunale' },
  { realValue: 'Via Garibaldi 42, Roma', pseudonym: 'LUOGO_01', category: 'luogo' },
  { realValue: 'CF: RSSMRA80A01H501Z', pseudonym: 'CODICE_01', category: 'codice' },
]

function buildAuthValue(mode: DemoMode): AuthContextValue {
  // Demo stubs: their return types don't match the real provider signatures,
  // but the modal never invokes them (it only calls refreshViewKey on the
  // post-bearer-validate path, which we route to a void async noop). We cast
  // through `unknown` so the type checker accepts the stubs while keeping
  // the rest of the value strongly typed.
  const noopVoidAsync = async (): Promise<void> => {
    /* dev demo no-op */
  }
  const noopSync = () => {
    /* dev demo no-op */
  }
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
    viewKeyGranted: mode === 'unlocked',
    viewKeySource: mode === 'unlocked' ? 'paid' : null,
    refreshViewKey: noopVoidAsync,
  }
}

function buildActiveMappingValue(mode: DemoMode): ActiveMappingContextValue {
  const noopVoidAsync = async (): Promise<void> => {
    /* dev demo no-op */
  }
  const noopStringAsync = async (): Promise<string> => {
    /* dev demo no-op */
    return ''
  }
  const noopSync = () => {
    /* dev demo no-op */
  }
  return {
    active:
      mode === 'unlocked'
        ? {
            mappingId: 'demo-mapping-id',
            label: 'Demo Mapping (smoke)',
            // `mapper` is required by ActiveMapping but ViewKeyModal only
            // reads `entries`. The real PseudonymMapper is never constructed
            // here — `null as never` is the same trick used in the unit test
            // (see __tests__/ViewKeyModal.test.tsx).
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

export function ViewKeyDemoPage(): JSX.Element {
  const [mode, setMode] = useState<DemoMode>('unlocked')

  // Recompute context values when the mode changes so the modal re-renders
  // against fresh state (avoids stale snapshots of viewKeyGranted etc.).
  const authValue = useMemo(() => buildAuthValue(mode), [mode])
  const activeValue = useMemo(() => buildActiveMappingValue(mode), [mode])

  return (
    <LanguageProvider>
      <div
        style={{
          minHeight: '100vh',
          padding: '24px',
          fontFamily: 'system-ui, sans-serif',
          background: '#f5f7fa',
        }}
      >
        <header
          style={{
            maxWidth: '720px',
            margin: '0 auto 24px',
            padding: '16px 20px',
            background: '#fff',
            border: '1px solid #d0d6de',
            borderRadius: '6px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          }}
        >
          <h1 style={{ margin: '0 0 8px', fontSize: '1.2rem' }}>
            ViewKeyModal — Dev Smoke (/view-key-demo)
          </h1>
          <p style={{ margin: '0 0 12px', color: '#555', fontSize: '0.9rem' }}>
            Standalone surface — no auth required. Switch state to inspect each
            visual. Clicking pay/bearer buttons hits the (offline) backend and
            will surface a generic error: that is expected, not a UI bug.
          </p>
          <fieldset
            style={{
              border: '1px solid #d0d6de',
              borderRadius: '4px',
              padding: '8px 12px',
              margin: 0,
            }}
          >
            <legend style={{ padding: '0 4px', fontSize: '0.85rem' }}>
              Modal state
            </legend>
            <label style={{ marginRight: 16, cursor: 'pointer' }}>
              <input
                type="radio"
                name="demo-mode"
                value="locked-anon"
                checked={mode === 'locked-anon'}
                onChange={() => setMode('locked-anon')}
                data-testid="demo-mode-locked-anon"
              />{' '}
              Locked — anonymous (sign-in nudge)
            </label>
            <label style={{ marginRight: 16, cursor: 'pointer' }}>
              <input
                type="radio"
                name="demo-mode"
                value="locked-logged-in"
                checked={mode === 'locked-logged-in'}
                onChange={() => setMode('locked-logged-in')}
                data-testid="demo-mode-locked-logged-in"
              />{' '}
              Locked — logged in (pay CTA + bearer)
            </label>
            <label style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="demo-mode"
                value="unlocked"
                checked={mode === 'unlocked'}
                onChange={() => setMode('unlocked')}
                data-testid="demo-mode-unlocked"
              />{' '}
              Unlocked — 8 mock mapping rows
            </label>
          </fieldset>
          <p
            style={{
              margin: '12px 0 0',
              fontSize: '0.8rem',
              color: '#888',
            }}
          >
            UI language defaults to <code>it</code>; LanguageProvider is the
            only real provider mounted. Close (X / ESC / backdrop) is wired but
            re-opens immediately because the demo forces <code>isOpen=true</code>.
          </p>
        </header>

        <AuthContext.Provider value={authValue}>
          <ActiveMappingContext.Provider value={activeValue}>
            <ViewKeyModal
              isOpen={true}
              onClose={() => {
                /* demo: ignore close — modal is the surface under test */
              }}
            />
          </ActiveMappingContext.Provider>
        </AuthContext.Provider>
      </div>
    </LanguageProvider>
  )
}
