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
import { PrivacyPage } from './ui/PrivacyPage'

type View = 'work' | 'login' | 'signup' | 'recovery' | 'dashboard' | 'privacy'

function AppHeader({
  view,
  onNavigate,
}: {
  view: View
  onNavigate: (v: View) => void
}): JSX.Element {
  const { user, logout, masterKey } = useAuth()
  const { active, closeActive } = useActiveMapping()
  const { uiLanguage, setUiLanguage, docLanguage, setDocLanguage, t } = useLanguage()

  const onLogout = useCallback(async () => {
    await logout()
    onNavigate('login')
  }, [logout, onNavigate])

  return (
    <header className="app__header">
      <div className="app__header-inner">
        <div className="app__header-row">
          <div>
            <h1>{BRAND_BY_LANG[uiLanguage]}</h1>
            <p className="tagline">{TAGLINE_BY_LANG[uiLanguage]}</p>
          </div>
          <div className="app__lang-pickers">
            <div className="app__lang-picker">
              <label htmlFor="app-ui-lang-select" className="app__lang-label">
                {t('lang.ui.label')}
              </label>
              <select
                id="app-ui-lang-select"
                data-testid="app-ui-lang-select"
                className="app__lang-select"
                value={uiLanguage}
                onChange={(e) => setUiLanguage(e.target.value as Language)}
              >
                {SUPPORTED_LANGUAGES.map((lng) => (
                  <option key={lng} value={lng}>
                    {BRAND_BY_LANG[lng]} ({lng.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
            <div className="app__lang-picker">
              <label htmlFor="app-doc-lang-select" className="app__lang-label">
                {t('lang.doc.label')}
              </label>
              <select
                id="app-doc-lang-select"
                data-testid="app-doc-lang-select"
                className="app__lang-select"
                value={docLanguage}
                onChange={(e) => setDocLanguage(e.target.value as Language)}
              >
                {SUPPORTED_LANGUAGES.map((lng) => (
                  <option key={lng} value={lng}>
                    {lng.toUpperCase()} — {t(`lang.doc.option.${lng}`)}
                  </option>
                ))}
              </select>
            </div>
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
                  {t('nav.work')}
                </button>
                <button
                  type="button"
                  className={`btn btn--secondary${view === 'dashboard' ? ' is-active' : ''}`}
                  onClick={() => onNavigate('dashboard')}
                  data-testid="nav-dashboard"
                >
                  {t('nav.dashboard')}
                </button>
                <span className="app__user" data-testid="auth-user-email">
                  {user.email}
                  {user.tier === 'pro' && !masterKey && (
                    <span
                      className="app__user-lock"
                      title={t('nav.lockedTitle')}
                    >
                      {' '}
                      {t('nav.lockedHint')}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => void onLogout()}
                  data-testid="logout-btn"
                >
                  {t('nav.logout')}
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
                  {t('nav.login')}
                </button>
                <button
                  type="button"
                  className={`btn btn--primary${view === 'signup' ? ' is-active' : ''}`}
                  onClick={() => onNavigate('signup')}
                  data-testid="nav-signup"
                >
                  {t('nav.signup')}
                </button>
              </>
            )}
          </nav>
        </div>
        {active && view === 'work' && (
          <div className="active-mapping-banner" data-testid="active-mapping-banner">
            <span className="active-mapping-banner__label">
              {t('banner.active.label')}{' '}
              <strong>{active.label}</strong>
              {active.dirty && (
                <span className="active-mapping-banner__dirty">
                  {' '}{t('banner.active.dirty')}
                </span>
              )}
            </span>
            <span className="active-mapping-banner__hint">
              {t('banner.active.hint')}
            </span>
            <button
              type="button"
              className="active-mapping-banner__close"
              onClick={() => {
                if (
                  active.dirty &&
                  // eslint-disable-next-line no-alert
                  !window.confirm(t('banner.active.deleteConfirm'))
                ) {
                  return
                }
                closeActive()
              }}
              data-testid="close-active-mapping-btn"
              title={t('banner.active.deleteTitle')}
              aria-label={t('banner.active.deleteAria')}
            >
              {t('banner.active.delete')}
            </button>
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
  const { t } = useLanguage()

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
        <p data-testid="auth-loading">{t('app.loadingSession')}</p>
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
      {view === 'privacy' && (
        <PrivacyPage onBack={() => onNavigate('work')} />
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
  const { uiLanguage, t } = useLanguage()
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

  // Deep-link support: if the URL path is /privacy on first mount, land
  // on the privacy view. Footer links use full hrefs so external pages
  // (Google results, shared links, RSS feeds) keep working.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.pathname === '/privacy' && view !== 'privacy') {
      setView('privacy')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          {BRAND_BY_LANG[uiLanguage]} — {t('app.footer.tagline')}
        </span>
        <span className="app__footer-links">
          <a
            href="/privacy"
            onClick={(e) => {
              // Intercept the link click so we render the React route in-app
              // (preserves header/footer/active language) instead of doing a
              // full page navigation. The href stays as /privacy so the link
              // is still shareable, openable in a new tab, and indexable.
              if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                e.preventDefault()
                setView('privacy')
                if (typeof window !== 'undefined') {
                  window.history.pushState({}, '', '/privacy')
                }
              }
            }}
            data-testid="footer-privacy-link"
          >
            {t('app.footer.privacy')}
          </a>
          <span className="app__build">{t('app.footer.build')} {GIT_SHA}</span>
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
