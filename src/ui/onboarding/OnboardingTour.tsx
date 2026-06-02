/**
 * OnboardingTour.tsx — custom "guida a bolle" coachmark tour (no third-party
 * library: react-joyride / shepherd / driver.js / intro.js are all avoided per
 * spec). A small React component + CSS (.onboarding-* in styles.css) only.
 *
 * REAL PRODUCTION feature — NOT mock-gated. It runs for every first-time user,
 * independent of import.meta.env.DEV / VITE_MOCK_FULL.
 *
 * Mechanism
 * ─────────
 * - The controller is driven by props from a parent that owns the level state
 *   (TwoLevelShell): `currentLevel` ('landing' | 'work'), `onRequestLevel` to
 *   advance L1→L2, and lifecycle callbacks. Steps are declared in
 *   onboarding-shared.ts; bubbles 1-3 anchor to Level-1 elements, bubble 4 to
 *   the Level-2 mode-tabs region.
 * - Anchoring: each step names a `data-testid`. We resolve the element with
 *   document.querySelector('[data-testid="…"]') and read getBoundingClientRect().
 *   The rect is recomputed on window resize + scroll (capture phase, so inner
 *   scroll containers count) and via a short rAF poll while a target is still
 *   mounting — this is what makes the L1→L2 hand-off robust: when "Avanti" is
 *   pressed on step 3, we call onRequestLevel('work'); Level 2 mounts a frame
 *   or two later, the poll picks up the new mode-tabs rect, and bubble 4 snaps
 *   into place. No element is queried before it exists.
 * - Visual: a fixed full-viewport backdrop with a transparent "spotlight" hole
 *   punched over the target (box-shadow trick), plus a bubble positioned beside
 *   the target with a small CSS arrow pointing at it. Placement auto-flips when
 *   it would overflow the viewport.
 *
 * Accessibility
 * ─────────────
 * - role="dialog" + aria-modal on the bubble, labelled by its body text.
 * - Esc skips/closes the whole tour ("Salta" is always reachable, never trapped).
 * - Focus moves to the bubble on each step; "Avanti"/"Fine" is focusable and
 *   gets initial focus so Enter/Space advances. We do NOT hard-trap focus —
 *   the user can Tab out; the backdrop blocks pointer interaction with the app
 *   beneath, but the keyboard escape hatch (Esc, focusable Salta) stays open.
 *
 * Persistence + replay are handled by the parent via onboarding-shared.ts
 * (ONBOARDING_DONE_KEY = 'recode_onboarding_bubbles_done'). This component is
 * purely presentational + interaction; it never writes localStorage itself.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLanguage } from '../LanguageContext'
import {
  ONBOARDING_STEPS,
  type OnboardingPlacement,
  type OnboardingStep,
} from './onboarding-shared'

type Props = {
  /** Which flow level is currently mounted (owned by TwoLevelShell). */
  currentLevel: 'landing' | 'work'
  /** Ask the parent to switch level (used to drive the L1→L2 hand-off). */
  onRequestLevel: (level: 'landing' | 'work') => void
  /** User pressed "Fine" on the last bubble (or otherwise completed). */
  onFinish: () => void
  /** User pressed "Salta", Esc, or the close affordance. */
  onSkip: () => void
}

/** Viewport-relative box of a target element (plus a comfort margin baked in). */
type TargetRect = {
  top: number
  left: number
  width: number
  height: number
}

const SPOTLIGHT_PADDING = 6 // px of breathing room around the highlighted target
const BUBBLE_GAP = 14 // px between the target edge and the bubble
const BUBBLE_MAX_WIDTH = 320 // keep bubbles readable, matches CSS
const VIEWPORT_MARGIN = 12 // min distance the bubble keeps from any screen edge

function readRect(testId: string): TargetRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector(`[data-testid="${testId}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  // A zero-size rect means the element is in the DOM but not laid out yet
  // (e.g. display:none ancestor mid-transition) — treat as "not ready".
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/**
 * Compute the bubble's top/left and the arrow side, given the target rect, the
 * preferred placement, and the measured bubble size. Flips the placement to the
 * opposite side when the preferred side would push the bubble off-screen, then
 * clamps the cross-axis so the bubble never leaves the viewport.
 */
function computeBubblePosition(
  target: TargetRect,
  preferred: OnboardingPlacement,
  bubble: { width: number; height: number },
): { top: number; left: number; arrow: OnboardingPlacement } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768

  const spaceTop = target.top
  const spaceBottom = vh - (target.top + target.height)
  const spaceLeft = target.left
  const spaceRight = vw - (target.left + target.width)

  // Flip to the opposite side if the preferred side lacks room for the bubble.
  let placement = preferred
  const need = (side: OnboardingPlacement) =>
    side === 'top' || side === 'bottom' ? bubble.height + BUBBLE_GAP : bubble.width + BUBBLE_GAP
  const spaceFor = (side: OnboardingPlacement) =>
    side === 'top'
      ? spaceTop
      : side === 'bottom'
        ? spaceBottom
        : side === 'left'
          ? spaceLeft
          : spaceRight
  const opposite: Record<OnboardingPlacement, OnboardingPlacement> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  }
  if (spaceFor(placement) < need(placement) && spaceFor(opposite[placement]) >= need(placement)) {
    placement = opposite[placement]
  }

  let top: number
  let left: number
  // The arrow points back AT the target, i.e. it sits on the side of the bubble
  // facing the target — the opposite of the bubble's placement direction.
  const arrow = opposite[placement]

  if (placement === 'bottom') {
    top = target.top + target.height + BUBBLE_GAP
    left = target.left + target.width / 2 - bubble.width / 2
  } else if (placement === 'top') {
    top = target.top - bubble.height - BUBBLE_GAP
    left = target.left + target.width / 2 - bubble.width / 2
  } else if (placement === 'right') {
    top = target.top + target.height / 2 - bubble.height / 2
    left = target.left + target.width + BUBBLE_GAP
  } else {
    top = target.top + target.height / 2 - bubble.height / 2
    left = target.left - bubble.width - BUBBLE_GAP
  }

  // Clamp inside the viewport on both axes.
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - bubble.width - VIEWPORT_MARGIN))
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - bubble.height - VIEWPORT_MARGIN))

  return { top, left, arrow }
}

export function OnboardingTour({
  currentLevel,
  onRequestLevel,
  onFinish,
  onSkip,
}: Props): JSX.Element | null {
  const { t } = useLanguage()
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<TargetRect | null>(null)
  const [bubbleSize, setBubbleSize] = useState({ width: BUBBLE_MAX_WIDTH, height: 160 })
  const bubbleRef = useRef<HTMLDivElement>(null)
  const nextBtnRef = useRef<HTMLButtonElement>(null)

  const step: OnboardingStep | undefined = ONBOARDING_STEPS[stepIndex]
  const total = ONBOARDING_STEPS.length
  const isLast = stepIndex === total - 1

  // When the active step lives on a different level than what's mounted, ask the
  // parent to switch. This is the L1→L2 driver: advancing onto step 4 (level
  // 'work') triggers onRequestLevel('work'); the mode-tabs target then mounts
  // and the poll below picks up its rect.
  useEffect(() => {
    if (step && step.level !== currentLevel) {
      onRequestLevel(step.level)
    }
  }, [step, currentLevel, onRequestLevel])

  // ── Rect resolution, step 1 of 2: SYNCHRONOUS first read ──────────────────
  // Resolve the target rect *synchronously, before paint* on every step change.
  // This is the primary resolver: when the target already exists (steps 1-3, and
  // step 4 once Level 2 has mounted), `rect` is populated in the SAME commit, so
  // the spotlight + bubble never depend on an animation frame firing to appear.
  //
  // This also subsumes the old "reset to null on step change" effect: we read the
  // NEW target here and set it (or null when the target isn't in the DOM yet),
  // which both clears the previous step's stale rect AND fills the new one in one
  // synchronous step — there is no window where a freshly-read rect gets clobbered
  // back to null by a separate reset effect.
  //
  // Root cause this fixes (Bug B): previously the rect was resolved ONLY inside
  // the rAF poll below, with a separate effect forcing rect=null on every step.
  // Whenever that first frame was delayed/throttled (background tab, a busy tick,
  // or simply sampling the DOM during the L1→L2 transition) `rect` stayed null,
  // so the component rendered `__backdrop-plain` and the bubble stayed
  // visibility:hidden even though getBoundingClientRect would have returned a
  // valid rect. A synchronous pre-paint read removes that rAF dependency.
  useLayoutEffect(() => {
    if (!step) return
    setRect(readRect(step.targetTestId))
  }, [step])

  // ── Rect resolution, step 2 of 2: rAF poll for LATE mounts + live tracking ──
  // The synchronous read above handles every target that already exists. The poll
  // exists for the one case it can't: the L1→L2 hand-off, where pressing "Avanti"
  // on step 3 calls onRequestLevel('work') and the Level-2 mode-tabs target mounts
  // a frame or two later. The poll picks up that rect when it appears and keeps it
  // live (it never overwrites a good rect with null, so a momentarily-detached
  // target during a transition doesn't flash the bubble away). resize + capture-
  // phase scroll keep the spotlight glued to the target as the page moves.
  useEffect(() => {
    if (!step) return
    let raf = 0
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      const next = readRect(step.targetTestId)
      setRect((prev) => {
        if (!next) return prev // keep last good rect rather than flashing empty
        if (
          prev &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.height === next.height
        ) {
          return prev
        }
        return next
      })
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)

    const onMove = () => {
      const next = readRect(step.targetTestId)
      if (next) setRect(next)
    }
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [step])

  // Measure the bubble after render so positioning uses real dimensions.
  useLayoutEffect(() => {
    if (bubbleRef.current) {
      const r = bubbleRef.current.getBoundingClientRect()
      setBubbleSize((prev) =>
        prev.width === r.width && prev.height === r.height
          ? prev
          : { width: r.width, height: r.height },
      )
    }
  }, [rect, stepIndex])

  // Move focus to the primary action on each step so Enter/Space advances and a
  // screen reader announces the bubble. Not a hard focus trap (Esc + Salta stay
  // reachable) — see file header.
  useEffect(() => {
    nextBtnRef.current?.focus()
  }, [stepIndex, rect])

  // Esc anywhere skips/closes the whole tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onSkip()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onSkip])

  const handleNext = useCallback(() => {
    if (isLast) {
      onFinish()
    } else {
      setStepIndex((i) => Math.min(i + 1, total - 1))
    }
  }, [isLast, onFinish, total])

  const position = useMemo(() => {
    if (!rect) return null
    return computeBubblePosition(rect, step?.placement ?? 'bottom', bubbleSize)
  }, [rect, step, bubbleSize])

  if (!step) return null

  // Spotlight hole: a transparent box over the target with a huge box-shadow
  // that paints the surrounding dim backdrop (so the target stays bright while
  // everything else is dimmed and pointer-blocked).
  const spotlightStyle: React.CSSProperties | undefined = rect
    ? {
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
      }
    : undefined

  const bodyText = t(step.bodyKey)
  const stepLabel = t('onboarding.step')
    .replace('{n}', String(stepIndex + 1))
    .replace('{total}', String(total))

  return (
    <div
      className="onboarding-tour"
      data-testid="onboarding-tour"
      data-step={step.id}
      aria-live="polite"
    >
      {/* Dimming backdrop + spotlight hole. When the rect isn't ready yet we
          render a plain full-screen dim (no hole) so there's never a flash of
          un-dimmed UI during the L1→L2 transition. */}
      {rect ? (
        <div
          className="onboarding-tour__spotlight"
          style={spotlightStyle}
          data-testid="onboarding-spotlight"
          aria-hidden="true"
        />
      ) : (
        <div className="onboarding-tour__backdrop-plain" aria-hidden="true" />
      )}

      {/* The coachmark bubble. Hidden until we have a position so it doesn't
          paint at (0,0) for a frame. */}
      <div
        ref={bubbleRef}
        className={`onboarding-tour__bubble${position ? ` onboarding-tour__bubble--${position.arrow}` : ''}`}
        style={
          position
            ? { top: position.top, left: position.left, visibility: 'visible' }
            : { visibility: 'hidden' }
        }
        role="dialog"
        aria-modal="true"
        aria-label={t('onboarding.regionAria')}
        data-testid="onboarding-bubble"
      >
        <button
          type="button"
          className="onboarding-tour__close"
          onClick={onSkip}
          aria-label={t('onboarding.closeAria')}
          title={t('onboarding.closeAria')}
          data-testid="onboarding-close"
        >
          ✕
        </button>

        <p className="onboarding-tour__body" data-testid="onboarding-body">
          {bodyText}
        </p>

        <div className="onboarding-tour__footer">
          <span
            className="onboarding-tour__step-indicator"
            data-testid="onboarding-step-indicator"
            aria-hidden="true"
          >
            {stepLabel}
          </span>
          <div className="onboarding-tour__actions">
            <button
              type="button"
              className="onboarding-tour__skip"
              onClick={onSkip}
              data-testid="onboarding-skip"
            >
              {t('onboarding.skip')}
            </button>
            <button
              ref={nextBtnRef}
              type="button"
              className="onboarding-tour__next"
              onClick={handleNext}
              data-testid="onboarding-next"
            >
              {isLast ? t('onboarding.finish') : t('onboarding.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
