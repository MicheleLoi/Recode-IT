/**
 * onboarding-shared.ts — shared constants + event bridge for the custom
 * "guida a bolle" first-access coachmark tour.
 *
 * The tour lives in TwoLevelShell (it owns the landing↔work level state AND the
 * work-area macro mode, both of which the tour drives: the L1→L2 continuation
 * and the CODIFICA→DECODIFICA mode-tab switch at step 6). The "?" replay button,
 * however, lives in
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
 * The work-area macro mode a step wants to be shown under. Mirrors
 * WireframeWorkArea's `MacroMode`. When a step declares a `workMode` that
 * differs from the work area's current mode, OnboardingTour asks the parent to
 * switch the mode tab — exactly analogous to the `level` → onRequestLevel
 * hand-off — so the bubble's target (which only renders in the matching mode,
 * e.g. the DECODIFICA tab / its panel) mounts before we anchor to it.
 */
export type OnboardingWorkMode = 'codifica' | 'decodifica'

/**
 * A single tour step. `level` says which flow level the target lives on, so the
 * controller can drive the L1→L2 transition before trying to anchor a bubble to
 * an element that does not exist yet. `workMode` (optional, only meaningful when
 * `level === 'work'`) does the same one level deeper: it drives the
 * CODIFICA↔DECODIFICA mode-tab switch so the step's target is mounted. Steps
 * with no `workMode` impose no mode (the work area keeps whatever mode it has).
 * `targetTestId` is matched against `[data-testid="…"]`; `placement` is the
 * bubble's preferred side relative to the target (auto-flipped if it would
 * overflow the viewport).
 */
export type OnboardingPlacement = 'top' | 'bottom' | 'left' | 'right'

export type OnboardingStep = {
  /** Stable id (for keys / tests). */
  id: string
  /** Which level the target element belongs to. */
  level: 'landing' | 'work'
  /**
   * Which work-area macro mode this step needs (CODIFICA / DECODIFICA).
   * Only consulted when `level === 'work'`. Omitted ⇒ no mode requirement.
   */
  workMode?: OnboardingWorkMode
  /** data-testid of the element the bubble points at. */
  targetTestId: string
  /** i18n key for the bubble body copy. */
  bodyKey: string
  /** Preferred bubble side; flips automatically near a viewport edge. */
  placement: OnboardingPlacement
}

/**
 * The eight bubbles, in order, covering BOTH directions of the flow:
 *   1-3  Level 1 (landing): drop-zone · privacy badges · "Continua →"
 *   4-5  Level 2 (work), CODIFICA mode: the PSEUDONIMIZZA mode tab · the Mappa
 *        panel (where the name→pseudonym correspondence lives)
 *   6-8  Level 2 (work), DECODIFICA mode — the reverse direction, walked end to
 *        end:
 *     6  the DECODIFICA mode tab — reaching this step ACTUALLY switches the
 *        work area to DECODIFICA (via the workMode hand-off) so the user lands
 *        on the reverse page, not just a pointer at the tab. It is the *entry*
 *        to the decodifica walk.
 *     7  the Decodifica INPUT — the editable field where the AI's reply (still
 *        carrying the pseudonyms) is pasted. In the work area's decodifica
 *        layout this is the DX panel body (the pseudonimizzato side becomes the
 *        editable input when the flow inverts).
 *     8  the Decodifica OUTPUT — the read-only field where the real names
 *        reappear, ready to copy. In the decodifica layout this is the SX panel
 *        body (the originale side becomes the reconstructed output).
 *
 * Steps 6-8 all declare workMode 'decodifica', so the CODIFICA→DECODIFICA
 * switch fires EXACTLY ONCE (advancing onto step 6); steps 7 and 8 stay in
 * decodifica with no re-switch. The input/output bodies render even when empty
 * (the textareas show placeholders), so their targets resolve immediately via
 * the existing useLayoutEffect read + rAF poll anchoring — no element is queried
 * before it exists.
 *
 * Copy is DESCRIPTIVE/impersonal narration (the overlay is modal — the user
 * clicks through with Avanti/Fine, they do not act on these elements now).
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
    id: 'codifica-tab',
    level: 'work',
    workMode: 'codifica',
    targetTestId: 'wireframe-tab-codifica',
    bodyKey: 'onboarding.bubble4.body',
    placement: 'bottom',
  },
  {
    id: 'mappa-panel',
    level: 'work',
    workMode: 'codifica',
    targetTestId: 'wireframe-mappa-panel',
    bodyKey: 'onboarding.bubble5.body',
    placement: 'left',
  },
  {
    // ENTRY to the decodifica walk: reaching this step flips the work area to
    // DECODIFICA (workMode hand-off), then bubbles 7-8 tour the page it reveals.
    id: 'decodifica-tab',
    level: 'work',
    workMode: 'decodifica',
    targetTestId: 'wireframe-tab-decodifica',
    bodyKey: 'onboarding.bubble6.body',
    placement: 'bottom',
  },
  {
    // Decodifica INPUT — paste the AI reply (still pseudonymized). DX panel body
    // (the pseudonimizzato side, editable when the flow inverts). 'top' so the
    // bubble sits above the input; auto-flips to 'bottom' near the viewport top.
    id: 'decodifica-input',
    level: 'work',
    workMode: 'decodifica',
    targetTestId: 'wireframe-decodifica-input',
    bodyKey: 'onboarding.bubble7.body',
    placement: 'top',
  },
  {
    // Decodifica OUTPUT — the real names reappear here, ready to copy. SX panel
    // body (the originale side, read-only reconstructed output). 'top' mirrors
    // the input step; auto-flips if it would overflow.
    id: 'decodifica-output',
    level: 'work',
    workMode: 'decodifica',
    targetTestId: 'wireframe-decodifica-output',
    bodyKey: 'onboarding.bubble8.body',
    placement: 'top',
  },
]
