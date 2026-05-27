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
import heroUrl from './assets/hero.png'
import { AuthProvider, useAuth } from './auth/auth-context'
import { ActiveMappingProvider } from './auth/active-mapping-context'
import {
  BRAND_BY_LANG,
  LanguageProvider,
  SUPPORTED_LANGUAGES,
  TAGLINE_BY_LANG,
  useLanguage,
  type Language,
} from './ui/LanguageContext'
import { VerifiedBanner } from './ui/VerifiedBanner'
import { LoginPage } from './ui/auth/LoginPage'
import { SignupPage } from './ui/auth/SignupPage'
import { RecoveryPage } from './ui/auth/RecoveryPage'
import { AccountDashboard } from './ui/auth/AccountDashboard'
import { UpgradePage } from './ui/upgrade/UpgradePage'
import { PrivacyPage } from './ui/PrivacyPage'
import { DecodificaWorkspace } from './ui/DecodificaWorkspace'
import { DecodificaDemoPage } from './ui/DecodificaDemoPage'

type View = 'work' | 'login' | 'signup' | 'recovery' | 'dashboard' | 'privacy'

function AppHeader({
  view,
  onNavigate,
}: {
  view: View
  onNavigate: (v: View) => void
}): JSX.Element {
  const { user, logout, masterKey } = useAuth()
  const { uiLanguage, setUiLanguage, t } = useLanguage()

  const onLogout = useCallback(async () => {
    await logout()
    onNavigate('login')
  }, [logout, onNavigate])

  return (
    <header className="app__header">
      <div className="app__header-inner">
        {/* Hero: painting + brand + lingua interfaccia chip top-right.
            Wireframe-first canonical (SID-20260526-172143). Tagline esterna
            sotto hero, doc lang nella secondary row sotto (sarà spostata
            full-width sopra le card mappa in Phase 2 work area refactor). */}
        <div className="app__hero">
          <img
            className="app__hero-img"
            src={heroUrl}
            alt={`${BRAND_BY_LANG[uiLanguage]} — sfondo decorativo`}
          />
          <div className="app__hero-overlay" />
          <div className="app__hero-text">
            {/* Hero brand — founder direttiva SID-20260527-181552:
                "Recode IT (e altre lingue) in hero sempre in Blu".
                Brand wrapped in ".app__hero-brand-text" span so the blu
                RegIA color (--regia-blue-dark) is applied uniformly per
                all 4 UI languages (IT/EN/DE/FR), independent of the
                outer h1 default ink color. */}
            <h1 className="app__hero-brand">
              <span className="app__hero-brand-text">
                {BRAND_BY_LANG[uiLanguage]}
              </span>
            </h1>
          </div>
          <select
            id="app-ui-lang-select"
            data-testid="app-ui-lang-select"
            className="app__hero-lang-chip"
            value={uiLanguage}
            onChange={(e) => setUiLanguage(e.target.value as Language)}
            aria-label={t('lang.ui.label')}
          >
            {SUPPORTED_LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {lng.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <p className="app__tagline tagline">{TAGLINE_BY_LANG[uiLanguage]}</p>

        {/* Lingua documento moved to WireframeWorkArea slot post-panels
            (founder direttiva (c) SID-20260527: rimosso da AppHeader,
            integrato canonical-per-prototype tra Decodifica CTA e Mappa
            cards). Zero duplicazione UI. */}
        <div className="app__header-row">
          <nav className="app__nav" aria-label="Navigazione principale">
            {user ? (
              /* Founder direttiva SID-20260527: row top "Strumento / I miei
                 mapping / email / Esci" semplificata a solo identity + Esci.
                 - "Strumento" (nav-work): rimosso — è già la default view,
                   pulsante ridondante.
                 - "I miei mapping" (nav-dashboard): rimosso — la pagina
                   AccountDashboard resta accessibile via card "Chiavi su
                   server" (modal upsell €25). Non si butta la pagina,
                   semplicemente non la mostriamo finché Pro €25 è parcheggiato.
                 Route 'dashboard' resta nel codice (App.tsx AppShell dispatch)
                 per riattivazione futura quando Pro cloud va live. */
              <>
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
        {/* Active mapping banner moved to WireframeWorkArea (founder
            direttiva SID-20260527: era duplicato in alto qui + in basso lì,
            qui rimosso, lì il "good design" 3-row vince). Il banner appare
            sotto i panel + mappa cards, vicino al contesto di lavoro. */}
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
      {view === 'work' && <DecodificaWorkspace />}
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

/**
 * Read the `?token=<value>` query param on first mount. Used by the password
 * recovery flow: when the user clicks the link in the reset email, the SPA
 * lands on `/` (the recovery email link is `/?token=<...>`), App auto-routes
 * to the RecoveryPage, and RecoveryPage.readTokenFromUrl picks up the same
 * query param to auto-fill Stage 2 (verify form). We do NOT strip the token
 * from window.location.search — RecoveryPage reads it on its own mount.
 *
 * Distinct from useInviteTokenFromUrl (which reads `?t=`, the upgrade flow).
 */
function useRecoveryTokenFromUrl(): string | null {
  const [token] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const params = new URLSearchParams(window.location.search)
      const t = params.get('token')
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
  const recoveryToken = useRecoveryTokenFromUrl()
  // Lazy initializer: if `?token=<...>` was on the URL when the SPA mounted
  // (user arrived from a password-reset email link), land directly on the
  // recovery view. RecoveryPage::readTokenFromUrl will then auto-fill Stage 2
  // verify. Otherwise default to 'work' so anonymous local pseudonymization
  // keeps working without a forced login.
  const [view, setView] = useState<View>(() =>
    recoveryToken !== null ? 'recovery' : 'work',
  )
  const inviteToken = useInviteTokenFromUrl()
  const [upgradeDismissed, setUpgradeDismissed] = useState(false)

  // Once the auth state resolves, route the user to the right initial view:
  // logged-in users land on the work surface; anonymous users on login.
  // Exception: if a recovery token brought us here, stay on 'recovery' even
  // if the user happens to be already logged in (the reset flow is the
  // user's explicit intent — overriding it would silently swallow the click).
  useEffect(() => {
    if (loading) return
    if (recoveryToken !== null && view === 'recovery') return
    if (user && view === 'login') setView('work')
    // We intentionally do NOT auto-redirect anonymous users away from 'work'
    // — they can pseudonymize locally without an account.
  }, [loading, user, view, recoveryToken])

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
      {/* BundleBanner — was mounted here as 'header' variant (above AppHeader).
          Founder direttiva SID-20260527-181552: moved to WireframeWorkArea
          toolbar decodifica slot (variant 'inline') — exact symmetric position
          to ".wireframe-modifier-btn" of codifica side. Component preserved
          (legacy 'header' variant still available for future re-mount). */}
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
      {/* Bundle cross-link section "Sotto il brand RegIA" — Touchpoint 3
          (SID-20260527). Sits above the existing minimal footer; uniforms
          the app with landing pages /recode-it/, /beccaria/, /mhc-c/.
          NB: NO mention of /mhc-h/ — Authority discipline, not shipped.
          Canon: notes/research/recode-it/wireframes/bundle_crosslink_prototype_20260527.html */}
      <section
        className="app__footer-bundle"
        aria-labelledby="app-footer-bundle-heading"
        data-testid="app-footer-bundle"
      >
        <h2
          id="app-footer-bundle-heading"
          className="app__footer-bundle-heading"
        >
          {t('app.footer.bundle.heading')}
        </h2>
        <p className="app__footer-bundle-text">
          {t('app.footer.bundle.lead')}{' '}
          <strong>{t('app.footer.bundle.bundleName')}</strong>
          {t('app.footer.bundle.leadTail')}
        </p>
        <nav
          className="app__footer-bundle-links"
          aria-label={t('app.footer.bundle.heading')}
        >
          <a
            href="https://micheleloi.pro/mhc-l/"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="footer-bundle-link-mhcL"
          >
            {t('app.footer.bundle.link.mhcL')}
          </a>
          <a
            href="https://micheleloi.pro/beccaria/"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="footer-bundle-link-beccaria"
          >
            {t('app.footer.bundle.link.beccaria')}
          </a>
          <a
            href="https://micheleloi.pro/mhc-c/"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="footer-bundle-link-mhcC"
          >
            {t('app.footer.bundle.link.mhcC')}
          </a>
        </nav>
        <div className="app__footer-bundle-meta">
          {t('app.footer.bundle.meta')}{' '}
          <a href="mailto:mhcl@micheleloi.pro">mhcl@micheleloi.pro</a>
        </div>
      </section>
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
  // DEV-ONLY: standalone smoke surface for the 3-tab Decodifica workspace,
  // mounted before the real provider stack so it works offline.
  // Vite tree-shakes the branch in production (import.meta.env.DEV = false).
  // Remove together with src/ui/DecodificaDemoPage.tsx when smoke is done.
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.location.pathname === '/decodifica-demo'
  ) {
    return <DecodificaDemoPage />
  }

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
