/**
 * ViewKeyButton.tsx — CTA wrapping ViewKeyModal (capabilities_index §9.9).
 *
 * Pure presentational: internal `isModalOpen` state + click handler. All
 * permission / mapping reads live in the modal itself so the button stays
 * lightweight and always rendered (cheap to mount everywhere the user
 * might want to inspect the key).
 *
 * The button is disabled when there's no active mapping to inspect — the
 * user must pseudonymize something first. Tooltip explains the gating.
 */

import { useState } from 'react'
import { useActiveMappingOptional } from '../auth/active-mapping-context'
import { useLanguage } from './LanguageContext'
import { ViewKeyModal } from './ViewKeyModal'

type Props = {
  /** Override CSS class — caller can pass a `btn--secondary btn--small` mix. */
  className?: string
  /** Optional explicit disabled override (e.g. when parent knows there's nothing to show). */
  disabled?: boolean
}

export function ViewKeyButton({
  className,
  disabled: disabledOverride,
}: Props): JSX.Element {
  const activeCtx = useActiveMappingOptional()
  const active = activeCtx?.active ?? null
  const { t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)

  // Disable the button only when there's no active mapping AND the parent
  // didn't explicitly override. This lets the modal still surface the
  // "no mapping" notice when opened (some UX flows want the user to discover
  // the locked state even before pseudonymizing).
  const hasMapping = !!active && active.entries.length > 0
  const isDisabled = disabledOverride ?? !hasMapping

  return (
    <>
      <button
        type="button"
        className={className ?? 'btn btn--secondary'}
        onClick={() => setIsOpen(true)}
        disabled={isDisabled}
        title={t('viewKey.buttonTitle')}
        data-testid="view-key-btn"
      >
        {t('viewKey.buttonLabel')}
      </button>
      <ViewKeyModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
