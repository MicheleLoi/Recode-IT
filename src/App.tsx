/**
 * App.tsx — Recode IT top-level router (Phase 3 wiring).
 *
 * Hosts the AuthProvider + ActiveMappingProvider and dispatches between four
 * views:
 *
 *   - 'work'      → the two-panel ClipboardWidget (default after login).
 *   - 'login'     → unauthenticated landing form.
 *   - 'signup'    → registration with one-shot recovery codes display.
 *   - 'recovery'  → password reset (3-step destructive warning, R-05).
 *   - 'dashboard' → AccountDashboard (saved mappings + delete actions).
 *
 * The router is plain useState rather than react-router to keep the bundle
 * small — there are exactly five views and no deep linking requirement for
 * the MVP. The pseudonymize-without-account workflow stays available: an
 * unauthenticated user can still drop a document and run the pipeline
 * locally; the "Salva mapping" button is the only gate that requires login.
 */

import { useCallback, useEffect, useState } from 'react'
import { GIT_SHA } from './buildInfo'
import { AuthProvider, useAuth } from './auth/auth-context'
import { ActiveMappingProvider, useActiveMapping } from './auth/active-mapping-context'
import {
  BRAND_BY_LANG,
  LanguageProvider,
  SUPPORTED_LANGUAGES,
  TAGLINE_BY_LANG,
  useLanguage,
  type Language,
} from './ui/LanguageContext'
import { ClipboardWidget } from './ui/ClipboardWidget'
import { VerifiedBanner } from './ui/VerifiedBanner'
import { LoginPage } from './ui/auth/LoginPage'
import { SignupPage } from './ui/auth/SignupPage'
import { RecoveryPage } from './ui/auth/RecoveryPage'
import { AccountDashboard } from './ui/auth/AccountDashboard'
import { UpgradePage } from './ui/upgrade/UpgradePage'

type View = 'work' | 'login' | 'signup' | 'recovery' | 'dashboard'

function AppHeader({
  view,
  onNavigate,
}: {
  view: View
  onNavigate: (v: View) => void
}): JSX.Element {
  const { user, logout, masterKey } = useAuth()
  const { active } = useActiveMapping()
  const { language, setLanguage } = useLanguage()

  const onLogout = useCallback(async () => {
    await logout()
    onNavigate('login')
  }, [logout, onNavigate])

  return (
    <header className="app__header">
      <div className="app__header-inner">
        <div className="app__header-row">
          <div>
            <h1>{BRAND_BY_LANG[language]}</h1>
            <p className="tagline">{TAGLINE_BY_LANG[language]}</p>
          </div>
          <div className="app__lang-picker">
            <label htmlFor="app-lang-select" className="app__lang-label">
              Lingua documento
            </label>
            <select
              id="app-lang-select"
              data-testid="app-lang-select"
              className="app__lang-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
            >
              {SUPPORTED_LANGUAGES.map((lng) => (
                <option key={lng} value={lng}>
                  {BRAND_BY_LANG[lng]} ({lng.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
          <nav className="app__nav" aria-label="Navigazione principale">
            {user ? (
              <>
                <button
                  type="button"
                  className={`btn btn--secondary${view === 'work' ? ' is-active' : ''}`}
                  onClick={() => onNavigate('work')}
                  data-testid="nav-work"
                >
                  Strumento
                </button>
                <button
                  type="button"
                  className={`btn btn--secondary${view === 'dashboard' ? ' is-active' : ''}`}
                  onClick={() => onNavigate('dashboard')}
                  data-testid="nav-dashboard"
                >
                  I miei mapping
                </button>
                <span className="app__user" data-testid="auth-user-email">
                  {user.email}
                  {user.tier === 'pro' && !masterKey && (
                    <span
                      className="app__user-lock"
                      title="Master key non in memoria: serve riaprire la password per cifrare/decifrare i mapping."
                    >
                      {' '}
                      (bloccato)
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => void onLogout()}
                  data-testid="logout-btn"
                >
                  Esci
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`btn btn--secondary${view === 'login' ? ' is-active' : ''}`}
                  onClick={() => onNavigate('login')}
                  data-testid="nav-login"
                >
                  Accedi
                </button>
                <button
                  type="button"
                  className={`btn btn--primary${view === 'signup' ? ' is-active' : ''}`}
                  onClick={() => onNavigate('signup')}
                  data-testid="nav-signup"
                >
                  Crea account
                </button>
              </>
            )}
          </nav>
        </div>
        {active && view === 'work' && (
          <div className="active-mapping-banner" data-testid="active-mapping-banner">
            <span className="active-mapping-banner__label">
              Mapping attivo:{' '}
              <strong>{active.label}</strong>
              {active.dirty && (
                <span className="active-mapping-banner__dirty"> · modifiche non salvate</span>
              )}
            </span>
            <span className="active-mapping-banner__hint">
              I prossimi documenti che trascini saranno pseudonimizzati con
              gli stessi pseudonimi (continuità di causa).
            </span>
          </div>
        )}
      </div>
    </header>
  )
}

function AppShell({
  view,
  onNavigate,
}: {
  view: View
  onNavigate: (v: View) => void
}): JSX.Element {
  const { user, loading } = useAuth()

  // Auto-redirect to login if the user lands on a protected view while
  // unauthenticated. We do NOT lock the 'work' view — local pseudonymization
  // works without an account; only persistence requires login.
  useEffect(() => {
    if (loading) return
    if (!user && view === 'dashboard') onNavigate('login')
  }, [loading, user, view, onNavigate])

  if (loading) {
    return (
      <main className="app__main">
        <p data-testid="auth-loading">Caricamento sessione…</p>
      </main>
    )
  }

  return (
    <main className="app__main">
      {view === 'work' && <ClipboardWidget />}
      {view === 'login' && (
        <LoginPage
          onSwitchToSignup={() => onNavigate('signup')}
          onSwitchToRecovery={() => onNavigate('recovery')}
        />
      )}
      {view === 'signup' && (
        <SignupPage onSwitchToLogin={() => onNavigate('login')} />
      )}
      {view === 'recovery' && (
        <RecoveryPage onBackToLogin={() => onNavigate('login')} />
      )}
      {view === 'dashboard' && (
        <AccountDashboard
          onBack={() => onNavigate('work')}
          onOpened={() => onNavigate('work')}
        />
      )}
    </main>
  )
}

/**
 * Read the `?t=<token>` query param from window.location on first mount. We
 * read it once and freeze it in state so the URL can later be cleaned (e.g.
 * after navigating away from the upgrade flow) without remounting the page.
 */
function useInviteTokenFromUrl(): string | null {
  const [token] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const params = new URLSearchParams(window.location.search)
      const t = params.get('t')
      return t && t.length > 0 ? t : null
    } catch {
      return null
    }
  })
  return token
}

function AppInner(): JSX.Element {
  const { user, loading } = useAuth()
  const [view, setView] = useState<View>('work')
  const inviteToken = useInviteTokenFromUrl()
  const [upgradeDismissed, setUpgradeDismissed] = useState(false)

  // Once the auth state resolves, route the user to the right initial view:
  // logged-in users land on the work surface; anonymous users on login.
  useEffect(() => {
    if (loading) return
    if (user && view === 'login') setView('work')
    // We intentionally do NOT auto-redirect anonymous users away from 'work'
    // — they can pseudonymize locally without an account.
  }, [loading, user, view])

  // Invite token path: when ?t=<token> is present we override the regular
  // view dispatch and show UpgradePage. The user can still dismiss to the
  // regular flow with the "Torna alla home" button (sets upgradeDismissed).
  const showUpgrade = inviteToken !== null && !upgradeDismissed

  return (
    <div className="app">
      <VerifiedBanner />
      <AppHeader view={view} onNavigate={setView} />
      {showUpgrade ? (
        <main className="app__main">
          <UpgradePage
            token={inviteToken!}
            onBack={() => {
              setUpgradeDismissed(true)
              setView(user ? 'work' : 'login')
            }}
          />
        </main>
      ) : (
        <AppShell view={view} onNavigate={setView} />
      )}
      <footer className="app__footer">
        <span>
          Recode IT — pseudonimizzazione e recoding in locale, senza upload del
          documento originale.
        </span>
        <span className="app__footer-links">
          <a href="/privacy">Privacy</a>
          <span className="app__build">build {GIT_SHA}</span>
        </span>
      </footer>
    </div>
  )
}

export function App(): JSX.Element {
  return (
    <LanguageProvider>
      <AuthProvider>
        <ActiveMappingProvider>
          <AppInner />
        </ActiveMappingProvider>
      </AuthProvider>
    </LanguageProvider>
  )
}
