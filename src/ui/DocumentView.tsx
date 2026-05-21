/**
 * DocumentView — Design C document-first inline annotation renderer.
 *
 * Renders the document text as a flowing paragraph where each detected entity
 * appears as an inline color-coded <span> (EntityHighlight). The avvocato
 * works directly on the document — clicking an entity opens a popover with
 * options (use pseudonym / leave original / change category / etc).
 *
 * Two display modes (toggle in toolbar):
 *   - 'pseudonimo'  → entities show their pseudonym (default; safe-to-share view)
 *   - 'originale'   → entities show their real value (avvocato reading aid)
 * In both modes highlights stay visible so the avvocato sees WHAT was detected.
 *
 * Manual annotation: when the user selects un-highlighted text and releases
 * the mouse, we surface a tiny floating menu with category buttons. The
 * selection-to-offset mapping uses the pre-highlight original text (we always
 * compute offsets against `originalText` regardless of display mode).
 *
 * Implementation notes:
 * - We tokenize by scanning `text` left-to-right, longest entity match first
 *   per position. This keeps "Mario Rossi" intact even if "Mario" is also
 *   detected.
 * - For performance, we early-exit if a document is huge (>50k chars) with a
 *   warning — the founder's MVP target is <5000 chars / <30 entities, which is
 *   trivially fast.
 * - The popover is rendered conditionally on `activeEntityId`. Anchor element
 *   is captured at click time via the highlight's onActivate callback.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { EntityHighlight, type DisplayMode } from './EntityHighlight'
import { EntityPopover } from './EntityPopover'
import type { ReviewEntity, SwitchableCategory } from './types'
import type { ManualCategory } from '../engine/manual_annotate'

type Token =
  | { kind: 'text'; content: string }
  | { kind: 'entity'; entity: ReviewEntity }

type Props = {
  originalText: string
  pseudonymizedText: string
  entities: ReviewEntity[]
  displayMode: DisplayMode
  onAccept: (id: string) => void
  onFalsePositive: (id: string) => void
  onChangeCategory: (id: string, category: SwitchableCategory) => void
  onSubstituteAnyway?: (id: string) => void
  /** Manual annotation: user selected an un-highlighted span. */
  onManualAnnotate?: (start: number, end: number, category: ManualCategory) => void
}

const MANUAL_CATEGORY_OPTIONS: ReadonlyArray<{
  value: ManualCategory
  label: string
}> = [
  { value: 'persona', label: 'Persona' },
  { value: 'luogo', label: 'Luogo' },
  { value: 'organizzazione', label: 'Organizzazione' },
  { value: 'tribunale', label: 'Tribunale' },
  { value: 'altro', label: 'Altro' },
]

/**
 * Tokenize `text` into a flat sequence of text and entity tokens. We do
 * longest-first matching at each cursor position to avoid splitting "Mario
 * Rossi" because "Mario" is also a detected entity.
 *
 * IMPORTANT: `entitySearchValue` decides whether we look for the original
 * value or the pseudonym in `text`. When rendering the pseudonymized text we
 * look for pseudonyms; when rendering the original we look for original values.
 * FP/preserved entries always look for the original (their pseudonym IS the
 * original).
 */
function tokenize(
  text: string,
  entities: ReviewEntity[],
  searchKey: (e: ReviewEntity) => string,
): Token[] {
  if (!text) return []
  if (entities.length === 0) return [{ kind: 'text', content: text }]

  // Build a list of (search-string, entity) pairs sorted by length desc so
  // longest matches win at any position.
  const candidates = entities
    .map((e) => ({ needle: searchKey(e), entity: e }))
    .filter((c) => c.needle && c.needle.length > 0)
    .sort((a, b) => b.needle.length - a.needle.length)

  const tokens: Token[] = []
  let i = 0
  let buf = ''
  while (i < text.length) {
    // Try to match an entity starting at i.
    let matched: { needle: string; entity: ReviewEntity } | null = null
    for (const c of candidates) {
      if (text.startsWith(c.needle, i)) {
        matched = c
        break
      }
    }
    if (matched) {
      if (buf) {
        tokens.push({ kind: 'text', content: buf })
        buf = ''
      }
      tokens.push({ kind: 'entity', entity: matched.entity })
      i += matched.needle.length
    } else {
      buf += text[i]
      i += 1
    }
  }
  if (buf) tokens.push({ kind: 'text', content: buf })
  return tokens
}

export function DocumentView({
  originalText,
  pseudonymizedText,
  entities,
  displayMode,
  onAccept,
  onFalsePositive,
  onChangeCategory,
  onSubstituteAnyway,
  onManualAnnotate,
}: Props): JSX.Element {
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null)
  const [activeAnchor, setActiveAnchor] = useState<HTMLElement | null>(null)
  const [manualMenuPos, setManualMenuPos] = useState<{
    top: number
    left: number
    start: number
    end: number
  } | null>(null)
  const docRef = useRef<HTMLDivElement>(null)

  // Choose the text + search strategy by display mode. Note: for fp/preserved
  // entries we still want to highlight, but in BOTH modes their text is the
  // original (pseudonym == realValue effectively).
  const { textToRender, searchKey } = useMemo(() => {
    if (displayMode === 'originale') {
      return {
        textToRender: originalText,
        searchKey: (e: ReviewEntity) => e.realValue,
      }
    }
    // pseudonimo mode: in pseudonymizedText, FP/preserved entries still show
    // realValue (the engine doesn't substitute them), regular ones show
    // pseudonym.
    return {
      textToRender: pseudonymizedText || originalText,
      searchKey: (e: ReviewEntity) => {
        if (e.status === 'falsePositive' || e.isPreserved === true) {
          return e.realValue
        }
        return e.pseudonym
      },
    }
  }, [displayMode, originalText, pseudonymizedText])

  const tokens = useMemo(() => {
    // Performance guard — extremely long docs degrade tokenize O(n*entities).
    // For prototype we just render plain text in that case; founder's MVP is
    // well below this threshold.
    if (textToRender.length > 50000) {
      return [{ kind: 'text', content: textToRender } as Token]
    }
    return tokenize(textToRender, entities, searchKey)
  }, [textToRender, entities, searchKey])

  const activeEntity = useMemo(
    () => entities.find((e) => e.id === activeEntityId) ?? null,
    [entities, activeEntityId],
  )

  const handleActivate = useCallback((id: string, anchor: HTMLElement) => {
    setActiveEntityId(id)
    setActiveAnchor(anchor)
    setManualMenuPos(null)
  }, [])

  const closePopover = useCallback(() => {
    setActiveEntityId(null)
    setActiveAnchor(null)
  }, [])

  /**
   * Selection handling for manual annotation. We only fire if:
   *   - the user has a non-empty selection
   *   - the selection lives entirely inside the doc view's text nodes (not
   *     across a highlight — we ignore those for simplicity)
   *   - we can compute a start/end offset against `originalText`
   *
   * Offset computation: we walk through tokens to compute the cumulative
   * offset of each text node in the rendered DOM into the FULL ORIGINAL
   * TEXT. Since `textToRender` may be the pseudonymized text, the offsets
   * we surface to onManualAnnotate must be against `originalText`. For
   * simplicity we only allow manual annotation in 'originale' display
   * mode — in 'pseudonimo' mode we surface a hint that the avvocato
   * should switch.
   */
  const handleMouseUp = useCallback(() => {
    if (!onManualAnnotate) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setManualMenuPos(null)
      return
    }
    const doc = docRef.current
    if (!doc) return
    const range = sel.getRangeAt(0)
    // Reject selections that touch a highlight span — keeps the gesture
    // unambiguous (manual annotation == picking NEW text).
    const startEl = range.startContainer.parentElement
    const endEl = range.endContainer.parentElement
    if (
      startEl?.closest('.entity-hl') ||
      endEl?.closest('.entity-hl')
    ) {
      setManualMenuPos(null)
      return
    }
    const selectedText = sel.toString()
    if (!selectedText.trim()) return

    let start: number, end: number
    if (displayMode === 'originale') {
      // Walk text nodes to compute offset against rendered text.
      const offsetIntoRendered = (node: Node, off: number): number => {
        let acc = 0
        const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT)
        let n: Node | null = walker.nextNode()
        while (n) {
          if (n === node) return acc + off
          acc += (n.textContent ?? '').length
          n = walker.nextNode()
        }
        return -1
      }
      const startOffRendered = offsetIntoRendered(
        range.startContainer,
        range.startOffset,
      )
      const endOffRendered = offsetIntoRendered(
        range.endContainer,
        range.endOffset,
      )
      if (startOffRendered < 0 || endOffRendered < 0) return
      start = Math.min(startOffRendered, endOffRendered)
      end = Math.max(startOffRendered, endOffRendered)
    } else {
      // 'pseudonimo' mode: string-search the selected text in originalText.
      // First-occurrence is fine — onManualAnnotate at the engine level
      // applies the substitution to every occurrence in the document.
      const idx = originalText.indexOf(selectedText)
      if (idx < 0) return
      start = idx
      end = idx + selectedText.length
    }

    if (start === end) return
    const rect = range.getBoundingClientRect()
    setManualMenuPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      start,
      end,
    })
  }, [displayMode, originalText, onManualAnnotate])

  // Close manual menu on outside click / Escape.
  useEffect(() => {
    if (!manualMenuPos) return
    const onDoc = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.manual-menu')) return
      // If the user selects something else / clicks outside, close.
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return
      setManualMenuPos(null)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setManualMenuPos(null)
    }
    // Schedule listener to avoid being immediately triggered by the mouseup
    // that opened the menu.
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDoc)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [manualMenuPos])

  const pickCategory = (category: ManualCategory) => {
    if (!manualMenuPos || !onManualAnnotate) return
    onManualAnnotate(manualMenuPos.start, manualMenuPos.end, category)
    setManualMenuPos(null)
    window.getSelection()?.removeAllRanges()
  }

  const emptyState = !textToRender

  return (
    <div className="docview-wrapper">
      {!emptyState && entities.length > 0 && (
        <p className="docview__manual-hint" data-testid="docview-manual-hint">
          Se vedi un nome o un dato sensibile <strong>in chiaro</strong> nel testo
          qui sotto (il modello NER non l'ha riconosciuto), selezionalo e scegli
          la categoria dal menu che appare. Basta selezionarlo una volta — la
          sostituzione si applica a tutte le occorrenze nel documento.
        </p>
      )}
      <div
        ref={docRef}
        className="docview"
        onMouseUp={handleMouseUp}
        data-testid="document-view"
        data-display-mode={displayMode}
        aria-label="Documento con entità rilevate"
      >
        {emptyState ? (
          <p className="docview__empty" data-testid="docview-empty">
            Trascina un file qui sopra o incolla il testo per cominciare. Le
            entità rilevate appariranno evidenziate direttamente nel
            documento.
          </p>
        ) : (
          tokens.map((tok, idx) => {
            if (tok.kind === 'text') {
              return <span key={`t-${idx}`}>{tok.content}</span>
            }
            return (
              <EntityHighlight
                key={`e-${tok.entity.id}-${idx}`}
                entity={tok.entity}
                displayMode={displayMode}
                isActive={activeEntityId === tok.entity.id}
                onActivate={handleActivate}
              />
            )
          })
        )}
      </div>

      {activeEntity && activeAnchor && (
        <EntityPopover
          entity={activeEntity}
          anchor={activeAnchor}
          onAcceptPseudonym={onAccept}
          onFalsePositive={onFalsePositive}
          onChangeCategory={onChangeCategory}
          onSubstituteAnyway={onSubstituteAnyway}
          onClose={closePopover}
        />
      )}

      {manualMenuPos && (
        <div
          className="manual-menu"
          style={
            {
              top: manualMenuPos.top,
              left: manualMenuPos.left,
            } as CSSProperties
          }
          role="menu"
          aria-label="Anonimizza la selezione"
          data-testid="manual-menu"
        >
          <div className="manual-menu__title">Anonimizza come</div>
          {MANUAL_CATEGORY_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              className="manual-menu__option"
              onClick={() => pickCategory(c.value)}
              role="menuitem"
              data-testid={`manual-menu-${c.value}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
