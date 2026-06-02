/**
 * onboarding-shared.ts — shared constants + event bridge for the custom
 * "guida a bolle" first-access coachmark tour.
 *
 * The tour lives in TwoLevelShell (it owns the landing↔work level state, which
 * the L1→L2 continuation depends on). The "?" replay button, however, lives in
 * AppHeader (App.tsx) — a sibling of TwoLevelShell in the React tree. Rather
 * than thread a callback through three intermediate components (App → AppShell
 * → DecodificaWorkspace → TwoLevelShell), we bridge replay via a window
 * CustomEvent. AppHeader dispatches REPLAY_EVENT; TwoLevelShell listens and
 * restarts the tour (resetting to the landing level so bubble 1's target
 * exists). This keeps App.tsx free of any tour internals.
 *
 * Persistence convention mirrors IntroBanner (typeof window guard + try/catch
 * for incognito-strict / QuotaExceededError), but uses a DISTINCT key so the
 * two memos never collide:
 *   - IntroBanner  → 'recode-it.introDismissed'
 *   - this tour    → 'recode_onboarding_bubbles_done'  (verbatim per spec)
 */

/** localStorage flag — set once the tour is skipped, finished, or closed. */
export const ONBOARDING_DONE_KEY = 'recode_onboarding_bubbles_done'

/** window CustomEvent name dispatched by the "?" replay button in AppHeader. */
export const ONBOARDING_REPLAY_EVENT = 'recode:onboarding-replay'

/** True if the user has already completed (or dismissed) the tour. */
export function readOnboardingDone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(ONBOARDING_DONE_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the "tour done" flag (best-effort; incognito-strict tolerated). */
export function writeOnboardingDone(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, '1')
  } catch {
    /* incognito strict / QuotaExceededError — the tour simply re-shows on the
       next reload; no hard failure. */
  }
}

/** Fire the replay event (called by the header "?" button). */
export function requestOnboardingReplay(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ONBOARDING_REPLAY_EVENT))
}

/**
 * A single tour step. `level` says which flow level the target lives on, so the
 * controller can drive the L1→L2 transition before trying to anchor a bubble to
 * an element that does not exist yet. `targetTestId` is matched against
 * `[data-testid="…"]`; `placement` is the bubble's preferred side relative to
 * the target (auto-flipped if it would overflow the viewport).
 */
export type OnboardingPlacement = 'top' | 'bottom' | 'left' | 'right'

export type OnboardingStep = {
  /** Stable id (for keys / tests). */
  id: string
  /** Which level the target element belongs to. */
  level: 'landing' | 'work'
  /** data-testid of the element the bubble points at. */
  targetTestId: string
  /** i18n key for the bubble body copy. */
  bodyKey: string
  /** Preferred bubble side; flips automatically near a viewport edge. */
  placement: OnboardingPlacement
}

/**
 * The four bubbles, in order. Steps 1-3 anchor to Level-1 elements; step 4
 * anchors to the Level-2 mode-tabs region (PSEUDONIMIZZA / DECODIFICA), shown
 * on first arrival in the work area.
 */
export const ONBOARDING_STEPS: ReadonlyArray<OnboardingStep> = [
  {
    id: 'dropzone',
    level: 'landing',
    targetTestId: 'landing-dropzone',
    bodyKey: 'onboarding.bubble1.body',
    placement: 'bottom',
  },
  {
    id: 'badges',
    level: 'landing',
    targetTestId: 'landing-badges',
    bodyKey: 'onboarding.bubble2.body',
    placement: 'bottom',
  },
  {
    id: 'continue',
    level: 'landing',
    targetTestId: 'landing-dropzone-cta',
    bodyKey: 'onboarding.bubble3.body',
    placement: 'top',
  },
  {
    id: 'modetabs',
    level: 'work',
    targetTestId: 'wireframe-mode-tabs',
    bodyKey: 'onboarding.bubble4.body',
    placement: 'bottom',
  },
]
