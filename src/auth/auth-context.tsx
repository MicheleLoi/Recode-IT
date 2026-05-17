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
}

export type AuthContextValue = {
  user: AuthUser | null
  masterKey: CryptoKey | null
  loading: boolean
  signup: (email: string, password: string) => Promise<api.SignupResponse>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** Re-derive the master key for an existing session (user typed password again). */
  unlock: (password: string) => Promise<void>
  /** Drop the in-memory key (keep the session). */
  lockKey: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      setUser({
        user_id: me.user_id,
        email: me.email,
        kdf_salt: me.kdf_salt,
        email_verified: me.email_verified,
      })
    } catch {
      setUser(null)
      setMasterKey(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signupFn = useCallback(
    async (email: string, password: string) => {
      const resp = await api.signup(email, password)
      return resp
    },
    [],
  )

  const loginFn = useCallback(async (email: string, password: string) => {
    const resp = await api.login(email, password)
    setUser({
      user_id: resp.user_id,
      email: resp.email,
      kdf_salt: resp.kdf_salt,
      email_verified: resp.email_verified,
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
    }),
    [user, masterKey, loading, signupFn, loginFn, logoutFn, unlockFn, lockKeyFn, refresh],
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

export function useRequireAuth(): AuthUser {
  const { user } = useAuth()
  if (!user) {
    throw new Error('useRequireAuth: not logged in')
  }
  return user
}
