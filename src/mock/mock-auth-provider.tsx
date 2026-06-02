/**
 * mock-auth-provider.tsx — DEV-ONLY mock for e2e-test-build branch.
 *
 * PURPOSE: de-risk the production deploy by giving the founder a fully
 * functional local test surface — real NER engine, real regex pipeline,
 * real Decodifica reverse-substitution — with ONLY the auth/permission
 * gate faked out (no backend required).
 *
 * ACTIVATION: this module is only reachable when
 *   - import.meta.env.DEV === true  (Vite dev server, never a prod build)
 *   - import.meta.env.VITE_MOCK_FULL === '1'  (explicit opt-in flag)
 * Both conditions are required. A production build cannot satisfy the first
 * condition (Vite sets DEV=false at build time), so this file is tree-shaken
 * out entirely from any prod bundle.
 *
 * WHAT IS MOCKED:
 *   - Logged-in user: Michele Loi (mock), tier=free, email verified.
 *   - reverseSubstitutionGranted: true  (Decodifica unlocked via mhc_bearer).
 *   - All AuthContext methods (login, logout, signup, unlock, etc.) are
 *     no-ops that resolve immediately — the founder cannot actually log out
 *     in mock mode (the button is there but does nothing).
 *
 * WHAT IS NOT MOCKED (runs REAL production code):
 *   - NER engine (ONNX/transformers.js in Worker thread).
 *   - Regex pipeline (phone, CF, email, VAT, IBAN, date…).
 *   - applyReverseSubstitution() in DecodificaPanel.
 *   - IndexedDB active-mapping persistence (tier=free path, fully local).
 *   - UI rendering, tab switching, copy/clear, language selector.
 *
 * REMOVAL: drop this file + revert the App.tsx VITE_MOCK_FULL ramp when the
 * prod deploy test is complete. The branch mock/e2e-test-build is
 * use-and-discard — never merge to main.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from '../auth/auth-context'
import type { AuthContextValue, AuthUser } from '../auth/auth-context'
import type { SignupResponse, SignupInput } from '../api/client'

// ---------------------------------------------------------------------------
// Fictitious user — consistent across the mock session.
// ---------------------------------------------------------------------------
const MOCK_USER: AuthUser = {
  user_id: 'mock-user-e2e-test',
  email: 'test@recode-mock.local',
  kdf_salt: 'mocksalt_not_used',
  email_verified: true,
  tier: 'free',
  name: 'Utente Test (mock)',
  marketing_consent: false,
}

// ---------------------------------------------------------------------------
// MockAuthProvider
// ---------------------------------------------------------------------------

export function MockAuthProvider({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  // Mock state — user is always present, Decodifica always granted.
  const [user] = useState<AuthUser>(MOCK_USER)

  const value = useMemo<AuthContextValue>(() => ({
    user,
    masterKey: null,      // tier=free does not need masterKey
    loading: false,       // no async init — no loading spinner

    // --- no-ops: the mock session is permanently logged in ----------------
    signup: async (_input: SignupInput): Promise<SignupResponse> => ({
      user_id: MOCK_USER.user_id,
      email: MOCK_USER.email,
      kdf_salt: MOCK_USER.kdf_salt,
      recovery_codes: ['mock-code'],
      warning: '[mock] signup disabled in mock mode',
    }),
    login: async (_email: string, _password: string): Promise<void> => {
      // no-op: already "logged in"
    },
    logout: async (): Promise<void> => {
      // no-op: mock session cannot be ended from the UI
    },
    unlock: async (_password: string): Promise<void> => {
      // no-op: tier=free has no masterKey
    },
    lockKey: () => {
      // no-op
    },
    refresh: async (): Promise<void> => {
      // no-op: user state is stable in mock
    },

    // --- Decodifica gate: always unlocked via mhc_bearer ------------------
    reverseSubstitutionGranted: true,
    reverseSubstitutionSource: 'mhc_bearer',
    refreshReverseSubstitution: async (): Promise<void> => {
      // no-op: permission is hardcoded to granted
    },
  }), [user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
