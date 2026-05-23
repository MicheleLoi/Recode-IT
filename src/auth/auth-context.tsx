/**
 * auth-context.tsx — Recode IT auth + master-key context (Phase 3).
 *
 * Holds (a) the logged-in user record returned by /recode/me and (b) the
 * derived AES-GCM CryptoKey (the "master key" for mapping encryption).
 * The CryptoKey is created from the user's password + kdf_salt at login
 * time and lives ONLY in memory (no localStorage / IndexedDB) so closing
 * the tab automatically discards it — a deliberate alignment with the
 * MHC-L zero-server-content posture for the most sensitive credential
 * derivative.
 *
 * Note: the JWT cookie persists for 30 days, so re-opening the tab gives
 * the user a "logged in" session without the key. The UI must prompt for
 * the password (without sending it to the server) to re-derive the master
 * key whenever an encrypted mapping needs decryption.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from '../api/client'
import { deriveKey } from '../api/crypto'

export type AuthUser = {
  user_id: string
  email: string
  kdf_salt: string
  email_verified: boolean
  /**
   * Pricing tier — drives the persistence backend dispatched at runtime
   * (capabilities_index §9 / mapping-store.ts):
   *   'free' = IndexedDB locale in chiaro
   *   'pro'  = server blob AES-256-GCM
   * Falls back to 'free' on hydration from a legacy `/recode/me` response
   * that predates the migration (defensive — server should always send it
   * post-migration 002).
   */
  tier: api.Tier
  /** Display name collected at signup. */
  name: string
  marketing_consent: boolean
}

/**
 * View-key permission state — drives the "Vedi la chiave" CTA modal
 * (capabilities_index §9.9, view-key add-on €20 una tantum / MHC Bearer free /
 * Pro tier implicit). Field names align with backend response shape from
 * GET /recode/view-key/permission (`granted` + `source`).
 */
export type ViewKeySource = 'paid' | 'mhc_bearer' | 'pro_tier' | null

export type AuthContextValue = {
  user: AuthUser | null
  masterKey: CryptoKey | null
  loading: boolean
  signup: (input: api.SignupInput) => Promise<api.SignupResponse>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** Re-derive the master key for an existing session (user typed password again). */
  unlock: (password: string) => Promise<void>
  /** Drop the in-memory key (keep the session). */
  lockKey: () => void
  refresh: () => Promise<void>
  /**
   * Whether the current user has unlocked the view-key feature (paid €20 add-on,
   * validated an MHC Bearer, or holds a Pro tier subscription).
   * `null` while permission hasn't been resolved (initial mount, no session).
   */
  viewKeyGranted: boolean
  /** Which authority path granted the view-key permission. */
  viewKeySource: ViewKeySource
  /**
   * Re-fetch /recode/view-key/permission and update local state. Called
   * automatically post-login and on mount when a user is present; can also
   * be triggered manually after a bearer validation or post-checkout return.
   */
  refreshViewKey: () => Promise<void>
}

// Exported so dev-only demo surfaces (e.g. ViewKeyDemoPage at /view-key-demo)
// can inject mocked context values without going through AuthProvider's
// network-coupled init path. Regular app code keeps using `useAuth()` /
// `useAuthOptional()` and `<AuthProvider>` — never imports the raw context.
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewKeyGranted, setViewKeyGranted] = useState(false)
  const [viewKeySource, setViewKeySource] = useState<ViewKeySource>(null)

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      setUser({
        user_id: me.user_id,
        email: me.email,
        kdf_salt: me.kdf_salt,
        email_verified: me.email_verified,
        // Defensive defaulting: pre-migration servers don't send these fields.
        tier: me.tier ?? 'free',
        name: me.name ?? '',
        marketing_consent: me.marketing_consent ?? false,
      })
    } catch {
      setUser(null)
      setMasterKey(null)
      setViewKeyGranted(false)
      setViewKeySource(null)
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Fetch the current view-key permission from the backend and update local
   * state. Silent on failure (anonymous users get 401, which is expected):
   * we clear the local flags rather than surfacing an error to the user.
   */
  const refreshViewKey = useCallback(async () => {
    try {
      const resp = await api.getViewKeyPermission()
      setViewKeyGranted(resp.granted === true)
      setViewKeySource(resp.source)
    } catch {
      setViewKeyGranted(false)
      setViewKeySource(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Auto-fetch view-key permission whenever the user identity changes (login,
  // refresh, logout). Anonymous users see the 401 swallowed by refreshViewKey
  // and the flags stay false — which is the correct UX (Vedi la chiave button
  // shows the locked modal with paywall + bearer paste options).
  const userId = user?.user_id ?? null
  useEffect(() => {
    if (userId === null) {
      setViewKeyGranted(false)
      setViewKeySource(null)
      return
    }
    void refreshViewKey()
  }, [userId, refreshViewKey])

  const signupFn = useCallback(
    async (input: api.SignupInput) => {
      const resp = await api.signup(input)
      return resp
    },
    [],
  )

  const loginFn = useCallback(async (email: string, password: string) => {
    const resp = await api.login(email, password)
    // Login response doesn't carry tier/name (existing endpoint) — derive
    // it from a follow-up /recode/me call so the auth state is complete
    // before any save/load gesture is enabled.
    const me = await api.me()
    setUser({
      user_id: resp.user_id,
      email: resp.email,
      kdf_salt: resp.kdf_salt,
      email_verified: resp.email_verified,
      tier: me.tier ?? 'free',
      name: me.name ?? '',
      marketing_consent: me.marketing_consent ?? false,
    })
    const key = await deriveKey(password, resp.kdf_salt)
    setMasterKey(key)
  }, [])

  const logoutFn = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
      setMasterKey(null)
      setViewKeyGranted(false)
      setViewKeySource(null)
    }
  }, [])

  const unlockFn = useCallback(
    async (password: string) => {
      if (!user) {
        throw new Error('cannot unlock: no user in session')
      }
      const key = await deriveKey(password, user.kdf_salt)
      setMasterKey(key)
    },
    [user],
  )

  const lockKeyFn = useCallback(() => setMasterKey(null), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      masterKey,
      loading,
      signup: signupFn,
      login: loginFn,
      logout: logoutFn,
      unlock: unlockFn,
      lockKey: lockKeyFn,
      refresh,
      viewKeyGranted,
      viewKeySource,
      refreshViewKey,
    }),
    [
      user,
      masterKey,
      loading,
      signupFn,
      loginFn,
      logoutFn,
      unlockFn,
      lockKeyFn,
      refresh,
      viewKeyGranted,
      viewKeySource,
      refreshViewKey,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return ctx
}

/**
 * Tolerant variant of `useAuth()` — returns `null` when no AuthProvider is
 * mounted. Used by ancillary surfaces (view-key add-on UI) that can be
 * rendered in test contexts without the full provider stack.
 */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext)
}

export function useRequireAuth(): AuthUser {
  const { user } = useAuth()
  if (!user) {
    throw new Error('useRequireAuth: not logged in')
  }
  return user
}
