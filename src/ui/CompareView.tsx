/**
 * CompareView — Design C v3 split-pane confronto originale/pseudonimo.
 *
 * Modalità opt-in attivata dal bottone "⇆ Confronta originale" nella toolbar
 * di PseudonymizePanel. Mostra due pannelli affiancati con lettura
 * comparativa simultanea (il flow naturale dell'avvocato):
 *   - sinistra: testo ORIGINALE con highlight DESATURATI (entità già gestite
 *     dal NER restano visibili ma non rubano attenzione)
 *   - destra:  testo PSEUDONIMIZZATO con highlight pieni
 *
 * Funzioni:
 *   - scroll sync proporzionale (scrollTop/scrollHeight ratio — semplice,
 *     evita tokenization-mapping fra le due viste; edge case noto: se
 *     l'originale è molto più corto del pseudo il sync diventa "loose" ma
 *     adequate per MVP).
 *   - selezione testo non-highlighted nel pannello sinistro → menu
 *     contestuale flottante con 4 categorie quick-click. Click → manual
 *     annotation via callback parent → entrambi i pannelli si aggiornano in
 *     real-time perché il render dipende dallo state `entities` upstream.
 *
 * I highlight desaturati a sinistra usano la classe `entity-hl--desaturated`
 * (vedi styles.css). Non sono cliccabili — il confronto è read-only su
 * quelli; l'avvocato può chiudere il confronto e ripetere la modifica via
 * popover in vista singola.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from 'react'
import type { ReviewEntity } from './types'
import type { ManualCategory } from '../engine/manual_annotate'

type Token =
  | { kind: 'text'; content: string }
  | { kind: 'entity'; entity: ReviewEntity }

/**
 * Quick-pick categories per il menu contestuale. 4 opzioni esplicite dal
 * brief: Persona, Luogo, Data, Organizzazione.
 *
 * Nota: 'data' NON è in ManualCategory (engine/manual_annotate.ts esporta
 * 'persona' | 'luogo' | 'organizzazione' | 'tribunale' | 'altro'). Le date
 * sono tipicamente catturate dal regex pass dell'engine; per il quick-pick
 * manuale "Data" mappiamo a 'altro' (maschera generica <MANUALE>). Documentato
 * come compromesso accettabile per MVP — il brief privilegia discoverability
 * delle 4 categorie esplicite sulla precisione tassonomica.
 */
const MANUAL_CATEGORY_OPTIONS: ReadonlyArray<{
  value: ManualCategory
  label: string
}> = [
  { value: 'persona', label: 'Persona' },
  { value: 'luogo', label: 'Luogo' },
  { value: 'altro', label: 'Data' },
  { value: 'organizzazione', label: 'Organizzazione' },
]

function tokenize(
  text: string,
  entities: ReviewEntity[],
  searchKey: (e: ReviewEntity) => string,
): Token[] {
  if (!text) return []
  if (entities.length === 0) return [{ kind: 'text', content: text }]
  const candidates = entities
    .map((e) => ({ needle: searchKey(e), entity: e }))
    .filter((c) => c.needle && c.needle.length > 0)
    .sort((a, b) => b.needle.length - a.needle.length)

  const tokens: Token[] = []
  let i = 0
  let buf = ''
  while (i < text.length) {
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

type Props = {
  originalText: string
  pseudonymizedText: string
  entities: ReviewEntity[]
  /** Manual annotation: user selected an un-highlighted span in left panel. */
  onManualAnnotate: (start: number, end: number, category: ManualCategory) => void
}

export function CompareView({
  originalText,
  pseudonymizedText,
  entities,
  onManualAnnotate,
}: Props): JSX.Element {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  // Re-entrancy guard: scrolling pane A → set sync flag → pane B's onScroll
  // sees the flag and skips, to avoid the infinite ping-pong.
  const syncingRef = useRef<'left' | 'right' | null>(null)
  const [manualMenuPos, setManualMenuPos] = useState<{
    top: number
    left: number
    start: number
    end: number
  } | null>(null)

  // Tokenization — left: originals, right: pseudonyms (FP/preserved fall back).
  const leftTokens = useMemo(() => {
    if (originalText.length > 50000) {
      return [{ kind: 'text', content: originalText } as Token]
    }
    return tokenize(originalText, entities, (e) => e.realValue)
  }, [originalText, entities])

  const rightTokens = useMemo(() => {
    const t = pseudonymizedText || originalText
    if (t.length > 50000) {
      return [{ kind: 'text', content: t } as Token]
    }
    return tokenize(t, entities, (e) => {
      if (e.status === 'falsePositive' || e.isPreserved === true) {
        return e.realValue
      }
      return e.pseudonym
    })
  }, [pseudonymizedText, originalText, entities])

  // Scroll-sync: proporzionale via scrollTop / (scrollHeight - clientHeight).
  // Trade-off documentato in CompareView header: i due testi hanno lunghezza
  // diversa quindi il sync non è character-anchored — è "good enough" per il
  // flow comparativo dell'MVP.
  const onLeftScroll = useCallback((_e: UIEvent<HTMLDivElement>) => {
    if (syncingRef.current === 'right') return
    const l = leftRef.current
    const r = rightRef.current
    if (!l || !r) return
    syncingRef.current = 'left'
    const lMax = l.scrollHeight - l.clientHeight
    const rMax = r.scrollHeight - r.clientHeight
    if (lMax > 0 && rMax > 0) {
      const ratio = l.scrollTop / lMax
      r.scrollTop = ratio * rMax
    }
    // Rilascia il lock dopo il frame.
    window.requestAnimationFrame(() => {
      syncingRef.current = null
    })
  }, [])

  const onRightScroll = useCallback((_e: UIEvent<HTMLDivElement>) => {
    if (syncingRef.current === 'left') return
    const l = leftRef.current
    const r = rightRef.current
    if (!l || !r) return
    syncingRef.current = 'right'
    const lMax = l.scrollHeight - l.clientHeight
    const rMax = r.scrollHeight - r.clientHeight
    if (lMax > 0 && rMax > 0) {
      const ratio = r.scrollTop / rMax
      l.scrollTop = ratio * lMax
    }
    window.requestAnimationFrame(() => {
      syncingRef.current = null
    })
  }, [])

  // Selection → menu contestuale (solo pannello sinistro = originale).
  const handleLeftMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setManualMenuPos(null)
      return
    }
    const doc = leftRef.current
    if (!doc) return
    const range = sel.getRangeAt(0)
    // Reject selezioni che toccano un highlight (anche desaturato): gesto
    // ambiguo, restiamo coerenti con DocumentView.
    const startEl = range.startContainer.parentElement
    const endEl = range.endContainer.parentElement
    if (
      startEl?.closest('.entity-hl') ||
      endEl?.closest('.entity-hl')
    ) {
      setManualMenuPos(null)
      return
    }
    // Verifica che la selezione sia interamente dentro il pannello sinistro.
    if (
      !doc.contains(range.startContainer) ||
      !doc.contains(range.endContainer)
    ) {
      setManualMenuPos(null)
      return
    }
    // Calcola offset rispetto al testo renderizzato (= originalText, perché
    // a sinistra renderizziamo l'originale).
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
    const start = Math.min(startOffRendered, endOffRendered)
    const end = Math.max(startOffRendered, endOffRendered)
    if (start === end) return
    const rect = range.getBoundingClientRect()
    setManualMenuPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      start,
      end,
    })
  }, [])

  // Chiusura menu su outside-click / Escape.
  useEffect(() => {
    if (!manualMenuPos) return
    const onDoc = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.manual-menu')) return
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return
      setManualMenuPos(null)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setManualMenuPos(null)
    }
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
    if (!manualMenuPos) return
    onManualAnnotate(manualMenuPos.start, manualMenuPos.end, category)
    setManualMenuPos(null)
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div className="compare-view" data-testid="compare-view">
      <div className="compare-view__pane compare-view__pane--left">
        <div className="compare-view__pane-header">Originale</div>
        <p className="compare-view__pane-hint">
          Se il modello NER non ha riconosciuto un'entità, selezionala qui sotto e
          scegli la categoria dal menu che appare. Basta selezionarla una volta —
          la sostituzione si applica a tutte le occorrenze nel documento.
        </p>
        <div
          ref={leftRef}
          className="compare-view__doc compare-view__doc--desaturated"
          onScroll={onLeftScroll}
          onMouseUp={handleLeftMouseUp}
          data-testid="compare-left"
          aria-label="Documento originale con entità desaturate"
        >
          {leftTokens.map((tok, idx) => {
            if (tok.kind === 'text') {
              return <span key={`l-t-${idx}`}>{tok.content}</span>
            }
            // Highlight desaturato non-cliccabile.
            const colorKey = categoryColorKeyLite(tok.entity.category)
            return (
              <span
                key={`l-e-${tok.entity.id}-${idx}`}
                className={`entity-hl entity-hl--${colorKey} entity-hl--desaturated`}
                data-entity-id={tok.entity.id}
              >
                {tok.entity.realValue}
              </span>
            )
          })}
        </div>
      </div>

      <div className="compare-view__divider" aria-hidden="true" />

      <div className="compare-view__pane compare-view__pane--right">
        <div className="compare-view__pane-header">Pseudonimizzato</div>
        <div
          ref={rightRef}
          className="compare-view__doc"
          onScroll={onRightScroll}
          data-testid="compare-right"
          aria-label="Documento pseudonimizzato"
        >
          {rightTokens.map((tok, idx) => {
            if (tok.kind === 'text') {
              return <span key={`r-t-${idx}`}>{tok.content}</span>
            }
            const colorKey = categoryColorKeyLite(tok.entity.category)
            const isFp =
              tok.entity.status === 'falsePositive' ||
              tok.entity.isPreserved === true
            const shown = isFp ? tok.entity.realValue : tok.entity.pseudonym
            return (
              <span
                key={`r-e-${tok.entity.id}-${idx}`}
                className={`entity-hl entity-hl--${colorKey}${
                  isFp ? ' entity-hl--preserved' : ''
                }`}
                title={`${tok.entity.realValue} → ${tok.entity.pseudonym}`}
                data-entity-id={tok.entity.id}
              >
                {shown}
              </span>
            )
          })}
        </div>
      </div>

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
          data-testid="compare-manual-menu"
        >
          <div className="manual-menu__title">Anonimizza come</div>
          {MANUAL_CATEGORY_OPTIONS.map((c) => (
            <button
              key={`${c.value}-${c.label}`}
              type="button"
              className="manual-menu__option"
              onClick={() => pickCategory(c.value)}
              role="menuitem"
              data-testid={`compare-manual-menu-${c.label.toLowerCase()}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Mini duplicato della categoryColorKey per evitare il import circolare
 * stilistico (EntityHighlight era pensato come componente, qui rendiamo
 * inline desaturato). Stessa logica.
 */
function categoryColorKeyLite(category: string): string {
  const c = category.toLowerCase()
  if (c === 'persona' || c === 'avvocato') return 'persona'
  if (
    c === 'luogo' ||
    c === 'citta' ||
    c === 'città' ||
    c === 'via' ||
    c === 'indirizzo'
  )
    return 'luogo'
  if (c === 'data') return 'data'
  if (
    c === 'organizzazione' ||
    c === 'org' ||
    c === 'azienda' ||
    c === 'tribunale'
  )
    return 'organizzazione'
  if (c === 'codice_fiscale' || c === 'iban' || c === 'email' || c === 'cf')
    return 'identificatore'
  return 'altro'
}
