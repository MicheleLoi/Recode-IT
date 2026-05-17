/**
 * Engine package entrypoint.
 *
 * Phase 0 ships only a trivial placeholder so the build pipeline and Vitest
 * have something to compile and exercise. Phase 1 will replace this with the
 * TypeScript port of `MHC-L/gate-local/tools/anonymize.py` plus the regression
 * suite covering bug fixes A-1 / A-2 / A-3 (see IMPLEMENTATION_PLAN.md §Phase 1).
 */

export const ENGINE_VERSION = '0.1.0-phase0'

/**
 * Placeholder helper — exists solely so Vitest has a real symbol to test in
 * Phase 0. Do not build on top of this; it disappears in Phase 1.
 */
export function engineGreeting(name: string): string {
  return `recode-it engine ${ENGINE_VERSION} ready (hello ${name})`
}
