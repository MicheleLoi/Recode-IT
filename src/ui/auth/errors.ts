/**
 * errors.ts — shared helpers to turn an ApiError into a localized
 * user-facing message.
 *
 * Today: only the `weak_password` error is structured (carries
 * `reason` + `min_length` + `min_classes` + `got_classes` in the
 * response body — see backend/password.py::WeakPasswordError and the
 * propagators in backend/signup.py + backend/recovery.py). For every
 * other error code we fall back to `err.message`, which the backend
 * still sends as English prose. That is documented technical debt:
 * MHC-Work/notes/research/recode-it/i18n_debt_post_weak_password_*.md
 * tracks the ~28 other backend error_response sites that need the
 * same code+params refactor.
 */

import { ApiError } from '../../api/client'

type Translator = (key: string) => string

/**
 * Format a number into the user's locale. The catalog uses single-brace
 * placeholders like `{min_length}` so we substitute literally (no
 * react-intl / i18next runtime dependency in this app).
 */
function fmt(template: string, params: Record<string, string | number>): string {
  let out = template
  for (const [k, v] of Object.entries(params)) {
    out = out.split(`{${k}}`).join(String(v))
  }
  return out
}

/**
 * Map an ApiError to a localized string the UI can render directly.
 * Returns the fallback (err.message) when the error code is not yet
 * structured for i18n.
 */
export function localizeApiError(err: ApiError, t: Translator): string {
  if (err.code === 'weak_password') {
    const reason = (err.body?.reason as string | undefined) ?? ''
    const minLength = (err.body?.min_length as number | undefined) ?? 12
    const minClasses = (err.body?.min_classes as number | undefined) ?? 3
    const gotClasses = (err.body?.got_classes as number | undefined) ?? 0
    if (reason === 'length') {
      return fmt(t('auth.password.weak_length'), { min_length: minLength })
    }
    if (reason === 'classes') {
      return fmt(t('auth.password.weak_classes'), {
        min_classes: minClasses,
        got: gotClasses,
      })
    }
    return t('auth.password.weak_generic')
  }
  return err.message
}
