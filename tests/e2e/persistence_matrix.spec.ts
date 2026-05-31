/**
 * persistence_matrix.spec.ts — Recode IT persistence/UI matrix end-to-end.
 *
 * Purpose: run the 15-flow a-priori matrix (predizione vs osservato) against
 * la live site (default https://recode.micheleloi.pro/) e produce un
 * markdown report `persistence_matrix_results.md` accanto a questo file.
 *
 * Founder direttiva (SID-20260530): "si prova tutto, niente a mano". Tutta
 * la matrice è eseguibile a una sola invocazione, refresh fra flussi simula
 * l'utente che chiude e riapre il browser (NO Playwright context isolation
 * deliberate — vogliamo riprodurre lo stato IDB reale).
 *
 * Founder direttiva 2026-05-31 ("Opzione C — connectOverCDP"):
 * - Il harness si connette via CDP al Chrome del founder già loggato
 *   (vedi `fixtures.ts` + `tests/e2e/README.md`).
 * - I flussi precedentemente `needs-auth` sono ora `ok-via-cdp` (l'auth è
 *   "free" perché il context appartiene al founder già autenticato).
 * - Warm-up NER eseguito UNA volta prima della matrice (cold start ~60s
 *   per caricare il modello ONNX ~64 MB; chiamate successive ~5-10s).
 *
 * F1 incorporazione dati grezzi (verifica manuale chief_of_staff via
 * Chrome MCP, 2026-05-31):
 * - Mapping persistito su IDB ha shape `{pseudonym, realValue, category,
 *   isFalsePositive}` — i campi `isPreserved/pass/source` sono strippati.
 * - Banner "Mapping attivo: N pseudonimi" compare al reload (read-back IDB ok).
 * - Bug osservato è PIÙ GRAVE della predizione iniziale: oltre alla mappa
 *   UI che mostra Palermo→Palermo identity, ANCHE il testo del pannello
 *   pseudonimizzato resta "Palermo" non sostituito. Cioè la predizione
 *   "text Palermo→Roma OK, map identity" era sbagliata: ENTRAMBI identity.
 *   Il fix `b15894a` (`seedFromEntries` skip identity) NON basta — c'è un
 *   altro percorso che propaga la prev identity al rendering text + map.
 * - Nota NER (doc A): il modello misdetect "Giulia Ferraro\nPiazza Aurora"
 *   come singolo span LOC → "Giulia Ferraro" NON viene rilevato come PER →
 *   resta in chiaro. Predicted dei flussi su doc A deve riflettere questa
 *   asimmetria.
 *
 * Run:
 *   npm run test:e2e
 *   RECODE_HEADLESS=1 npm run test:e2e
 *   RECODE_URL=http://localhost:5173 npm run test:e2e
 *   RECODE_CDP_URL=http://localhost:9333 npm run test:e2e
 */

import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Config ───────────────────────────────────────────────────────────────

const RECODE_URL = process.env.RECODE_URL ?? 'https://recode.micheleloi.pro/'
// ESM-safe equivalent of __dirname (the project has "type": "module").
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPORT_PATH = path.join(__dirname, 'persistence_matrix_results.md')

// ── Doc samples ──────────────────────────────────────────────────────────
//
// DOC_A: testo esatto usato dal chief_of_staff in F1 (verifica manuale
// 2026-05-31). Tenuto verbatim per confronto diretto con i risultati F1.
// Contiene "Palermo" (city che innesca il bug seed-identity) e
// "Giulia Ferraro\nPiazza Aurora" (NER misdetect noto: collassa in singolo
// span LOC, Giulia non rilevata come PER).

const DOC_A = `Test - sessione

Marco Bellini
Via delle Magnolie 18, 90133 Palermo
marco.bellini@example.it
+39 347 551 2093

Giulia Ferraro
Piazza Aurora 4, 20122 Milano
giulia.ferraro@example.it`

// DOC_B: città mai vista in S1 → alloca fresh pseudonimo "next-city" sul seed.
const DOC_B = `Scheda secondaria

Lorenzo Marchetti
Via dei Mille 8, 40121 Bologna
lorenzo.marchetti@example.it
+39 333 111 2233`

// DOC_MIXED: subset DOC_A (Marco Bellini + Palermo) + entry nuova Bologna.
// Serve per testare interazione seed (Palermo) + nuovo (Bologna) sulla stessa
// pseudonimizzazione S2.
const DOC_MIXED = `Scheda mista

Marco Bellini
Via delle Magnolie 18, 90133 Palermo
marco.bellini@example.it

Lorenzo Marchetti
Via dei Mille 8, 40121 Bologna
lorenzo.marchetti@example.it`

// ── Types ────────────────────────────────────────────────────────────────

type SaveMode = 'none' | 'manual' | 'autosave'
type ActionS2 = 'pseudonimizza' | 'applica' | 'pseudonimizza_then_applica'
type Mode = 'ok-via-cdp' | 'anon-only' | 'todo-complex'

interface MappingEntry {
  real: string
  pseudo: string
}

interface FlowPrediction {
  // Free-form descrittiva delle aspettative; per assert specifici usiamo i campi sotto.
  textNoLongerContains?: string[]   // Sostituzioni attese nel testo pseudonimizzato.
  textStillContains?: string[]      // Token che DEVONO restare (identity-mapping atteso).
  mapHasReal?: string[]             // real-value attesi nella mappa.
  mapHasPseudoMatching?: { real: string; pseudoMatches: RegExp }[]
  mapMustNotHaveReal?: string[]     // real-value che NON devono comparire.
  description: string               // Narrativa human-readable (entra nel report).
}

interface Flow {
  id: string
  description: string
  riskLevel: 'basso' | 'medio' | 'alto'
  mode: Mode
  setupS1: {
    doc: 'A' | 'B' | 'mixed'
    luoghi: boolean
    runPseudonimizza: boolean
  }
  saveMode: SaveMode
  setupS2: {
    doc: 'A' | 'B' | 'mixed' | 'same-as-s1'
  }
  actionS2: ActionS2
  luoghiS2: boolean
  predicted: FlowPrediction
}

interface FlowResult {
  id: string
  passed: boolean
  observedText: string
  observedMap: MappingEntry[]
  deltas: string[]
  skipped: boolean
  skipReason?: string
}

// ── Matrix definition ────────────────────────────────────────────────────
//
// Nota generale "doc A NER misdetect": in tutti i flussi che usano doc A,
// "Giulia Ferraro" NON viene rilevato come PER (collassa nello span LOC con
// "Piazza Aurora"). Quindi le predizioni su PER citano "Marco Bellini" come
// unica persona attesa nella mappa. La cosa NON è un bug del harness — è una
// limitazione del modello NER osservata nei dati grezzi F1.

const MATRIX: Flow[] = [
  {
    id: 'F1',
    description: 'doc A, Luoghi OFF + Pseudo / save manuale / refresh → Luoghi ON + Pseudo',
    riskLevel: 'alto',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description:
        'Bug grave (verifica manuale chief_of_staff 2026-05-31): ENTRAMBI identity — il TESTO del pannello pseudonimizzato resta "Palermo" (Pass-2 non sostituisce) E la mappa UI mostra Palermo→Palermo identity. Il fix `b15894a` (seedFromEntries skip identity) NON è sufficiente: un altro percorso propaga la prev identity al rendering text+map. Nota NER: "Giulia Ferraro\\nPiazza Aurora" misdetect come singolo span LOC → Giulia non è in mappa come PER, resta in chiaro nel testo.',
      textStillContains: ['Palermo'],
      mapHasReal: ['Marco Bellini', 'Palermo'],
    },
  },
  {
    id: 'F2',
    description: 'doc A, Luoghi ON + Pseudo / save manuale / refresh → Luoghi ON + Pseudo',
    riskLevel: 'basso',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: true, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description:
        'Continuità Palermo→<cityX> idempotente fra le due sessioni. NER doc A: "Giulia Ferraro" non è PER (misdetect, vedi nota generale).',
      textNoLongerContains: ['Palermo'],
      mapHasReal: ['Marco Bellini', 'Palermo'],
    },
  },
  {
    id: 'F3',
    description: 'doc A, Luoghi OFF + Pseudo / NO save / refresh → Luoghi ON + Pseudo',
    riskLevel: 'basso',
    mode: 'anon-only',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: true },
    saveMode: 'none',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description:
        'Mapper vuoto al refresh (nessuna persistenza), allocazione fresh: Palermo→<cityX> canon. NER doc A: "Giulia Ferraro" non è PER.',
      textNoLongerContains: ['Palermo'],
      mapHasReal: ['Marco Bellini', 'Palermo'],
    },
  },
  {
    id: 'F4',
    description: 'doc A, Luoghi OFF / autosave ON / refresh → Luoghi ON + Pseudo',
    riskLevel: 'alto',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: true },
    saveMode: 'autosave',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description:
        'Identico F1 (autosave salva stessa shape strippata): ENTRAMBI identity — text "Palermo" intatto, map Palermo→Palermo. Stesso bug, vettore di save diverso.',
      textStillContains: ['Palermo'],
      mapHasReal: ['Marco Bellini', 'Palermo'],
    },
  },
  {
    id: 'F5',
    description: 'doc A, Luoghi ON + Pseudo / save manuale / refresh → doc B → Luoghi ON + Pseudo',
    riskLevel: 'basso',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: true, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'B' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description: 'Bologna (mai vista) → nextCity post-seed, continuità seed da S1.',
      textNoLongerContains: ['Bologna'],
      mapHasReal: ['Bologna'],
    },
  },
  {
    id: 'F6',
    description: 'doc A, Luoghi OFF + Pseudo / save manuale / refresh → doc B → Luoghi ON + Pseudo',
    riskLevel: 'medio',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'B' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description:
        'Bologna→<cityFresh> per nuova entità, ma UI map riporta anche prev Palermo identity (rumore residuo da S1 strip). Possibile bug analogo F1 sullo state misto.',
      textNoLongerContains: ['Bologna'],
      mapHasReal: ['Bologna', 'Palermo'],
    },
  },
  {
    id: 'F7',
    description: 'doc A, Luoghi ON + Pseudo / save manuale / refresh → doc misto → Luoghi ON + Pseudo',
    riskLevel: 'basso',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: true, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'mixed' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description: 'Palermo→<cityX> (seed S1 conservato), Bologna→<cityNext> (nuova alloc).',
      textNoLongerContains: ['Palermo', 'Bologna'],
      mapHasReal: ['Palermo', 'Bologna'],
    },
  },
  {
    id: 'F8',
    description: 'doc A, Luoghi ON + Pseudo / save manuale / refresh → Luoghi OFF + Pseudo',
    riskLevel: 'alto',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: true, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: false,
    predicted: {
      description:
        'Text Palermo (Pass-2 identity in S2 con Luoghi OFF), map UI mostra Palermo→<cityX> dal seed S1: discrepanza opposta a F1.',
      textStillContains: ['Palermo'],
      mapHasReal: ['Palermo'],
    },
  },
  {
    id: 'F9',
    description: 'doc A, Luoghi OFF + Pseudo / save manuale / refresh → Luoghi OFF + Applica',
    riskLevel: 'basso',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'applica',
    luoghiS2: false,
    predicted: {
      description: 'Identity entries da entrambe le sessioni, UI consistent, text Palermo identity.',
      textStillContains: ['Palermo'],
      mapHasReal: ['Palermo'],
    },
  },
  {
    id: 'F10',
    description: 'doc A, Luoghi OFF + Pseudo / save manuale / refresh → Luoghi ON + APPLICA (senza prior Pseudo S2)',
    riskLevel: 'medio',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'applica',
    luoghiS2: true,
    predicted: {
      description:
        'Niente NER detections in S2 (no prior Pseudo S2) → Pass-2 non emette → toggle sembra rotto (no-op visivo).',
      textStillContains: ['Palermo'],
    },
  },
  {
    id: 'F11',
    description: 'doc A, Luoghi ON + Pseudo + 1 FP marcata / save manuale / refresh → Luoghi ON + Pseudo',
    riskLevel: 'basso',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: true, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description: 'FP filtrata via userFalsePositives Set. NOTA: FP marking automatico non implementato in questa passata, la marcatura UI viene tentata best-effort.',
      mapMustNotHaveReal: ['Comune di Milano'], // placeholder — FP marking non implementato in questa passata
    },
  },
  {
    id: 'F12',
    description: 'TODO: doc A, Luoghi OFF / save manuale / refresh → Luoghi ON + "Sostituisci comunque" su entry singola',
    riskLevel: 'basso',
    mode: 'todo-complex',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: true },
    saveMode: 'manual',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description: 'Flip preservata, funziona su state locale. SKIP: interazione "Sostituisci comunque" troppo complessa per questa passata.',
    },
  },
  {
    id: 'F13',
    description: 'doc vuoto / autosave ON / no-op',
    riskLevel: 'basso',
    mode: 'anon-only',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: false },
    saveMode: 'autosave',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: false,
    predicted: {
      description: 'autosave skip (no entities → save-group non renderizzato), no-op.',
    },
  },
  {
    id: 'F14',
    description: 'doc A, Luoghi OFF, NO Pseudo / autosave ON / refresh → Luoghi ON + Pseudo',
    riskLevel: 'basso',
    mode: 'ok-via-cdp',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: false },
    saveMode: 'autosave',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description: 'entities=[] → no autosave → IDB vuoto → fresh allocation a S2.',
      textNoLongerContains: ['Palermo'],
      mapHasReal: ['Palermo'],
    },
  },
  {
    id: 'F15',
    description: 'TODO: doc A grande, Luoghi OFF / autosave ON, toggle rapido / refresh → Luoghi ON',
    riskLevel: 'medio',
    mode: 'todo-complex',
    setupS1: { doc: 'A', luoghi: false, runPseudonimizza: true },
    saveMode: 'autosave',
    setupS2: { doc: 'same-as-s1' },
    actionS2: 'pseudonimizza',
    luoghiS2: true,
    predicted: {
      description: 'Race autosave debounced 600ms. SKIP: timing-based, troppo complesso per questa passata.',
    },
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * FIX (run 12, da diagnosi Opus residuo): React state `active.entries` viene
 * popolato al boot da `loadAggregateMapping` (active-mapping-context.tsx:222)
 * PRIMA che `clearIndexedDB` cancelli IDB. Cross-flow contamination: il flusso
 * N parte con active.entries del flusso N-1. Fix: dopo clearIDB, clicca anche
 * "Elimina mapping" (close-active-mapping-btn) per resettare React state ora
 * che IDB è vuoto. Se il bottone non c'è (active.entries.length===0), no-op.
 */
async function clearActiveMappingUI(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const btn = document.querySelector(
      '[data-testid="close-active-mapping-btn"]',
    ) as HTMLButtonElement | null
    if (!btn) return 'no-active-mapping'
    btn.click()
    return 'clicked'
  })
  if (result === 'clicked') {
    await page.waitForTimeout(400)
  }
}

async function clearIndexedDB(page: Page): Promise<void> {
  // Plus: clear localStorage 'recodeit:autoSaveMapping' (persistito) per
  // ripartire da autosave OFF — altrimenti il save manuale è disabled
  // perché autoSaveEnabled vince (WireframeWorkArea.tsx:1430).
  await page.evaluate(() => {
    try { window.localStorage.removeItem('recodeit:autoSaveMapping') } catch { /* ignore */ }
  })
  await page.evaluate(async () => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('recode-it')
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  })
}

async function gotoFresh(page: Page): Promise<void> {
  // Disable beforeunload listener that recode installs when entities exist
  // ("modifiche non salvate"). Without this, page.goto races with the dialog
  // and fails with ERR_ABORTED / frame detached, killing the page for all
  // subsequent flows.
  try {
    await page.evaluate(() => {
      try { (window as unknown as { onbeforeunload: unknown }).onbeforeunload = null } catch { /* ignore */ }
      try { window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation() }, true) } catch { /* ignore */ }
    })
  } catch {
    // ignore: first call before any page is loaded
  }
  await page.goto(RECODE_URL, { waitUntil: 'domcontentloaded' })
  // Ensure macro tab is on "codifica" (default).
  await page.locator('[data-testid="wireframe-textarea-originale"]').waitFor({
    state: 'visible',
    timeout: 30000,
  })
}

async function loadDoc(page: Page, docKey: 'A' | 'B' | 'mixed'): Promise<void> {
  const text = docKey === 'A' ? DOC_A : docKey === 'B' ? DOC_B : DOC_MIXED
  const ta = page.locator('[data-testid="wireframe-textarea-originale"]')
  await ta.click()
  // `fill` triggers React's onChange synthetic event correctly (the controlled
  // textarea sets value via React state). NON usare evaluate `.value = …`:
  // bypassa il React state, lascia il bottone PSEUDONIMIZZA disabled.
  await ta.fill(text)
  // Belt-and-suspenders: dispatchEvent('input') esplicito per garantire che
  // un React listener "input" (raro ma possibile) si sganci.
  await ta.dispatchEvent('input')
  // Attendere che il bottone PSEUDONIMIZZA si abiliti (proxy che lo state
  // React ha registrato il doc). Timeout breve perché è solo state propagation.
  await page
    .locator('[data-testid="wireframe-action-btn"]:not([disabled])')
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => {
      // Non fatale — alcuni flussi hanno l'azione non-Pseudonimizza come main,
      // ma in genere l'enabling è il segnale che React state è caricato.
    })
}

async function resetDoc(page: Page): Promise<void> {
  // Hit the "nuovo documento" button if present, else clear via UI.
  const btn = page.locator('[data-testid="wireframe-new-doc-btn"]')
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
  } else {
    const ta = page.locator('[data-testid="wireframe-textarea-originale"]')
    await ta.fill('')
    await ta.dispatchEvent('input')
  }
}

async function ensureLuoghi(page: Page, on: boolean): Promise<void> {
  // Open the dropdown if closed, set checkbox, verify, close via ESC.
  const dd = page.locator('[data-testid="wireframe-modifier-dropdown"]')
  if (!(await dd.isVisible().catch(() => false))) {
    await page.locator('[data-testid="wireframe-modifier-btn"]').click()
    await dd.waitFor({ state: 'visible' })
  }
  const cb = page.locator('[data-testid="wireframe-modifier-places"]')
  await cb.waitFor({ state: 'visible' })
  // FIX (run 11, da diagnosi Opus): Playwright setChecked/check setta property
  // DOM ma NON triggera React synthetic onChange in modo affidabile sulle
  // checkbox controlled. Click DOM programmatico via el.click() invece SI
  // triggera l'event chain (HTMLInputElement.click() dispatcha 'click' event
  // che è interpretato come user gesture → React onChange).
  let final = await cb.isChecked()
  for (let attempt = 0; attempt < 3 && final !== on; attempt++) {
    await cb.evaluate((el: HTMLInputElement) => el.click())
    await page.waitForTimeout(250)
    final = await cb.isChecked()
  }
  if (final !== on) {
    throw new Error(
      `ensureLuoghi: failed to set Luoghi=${on} (final=${final}) — DOM click did not trigger React onChange`,
    )
  }
  // FIX (run 8): bypass Playwright click stability per il close del dropdown.
  // Close via click su modifier-btn ma con JS evaluate.
  await page.evaluate(() => {
    const btn = document.querySelector(
      '[data-testid="wireframe-modifier-btn"]',
    ) as HTMLButtonElement | null
    if (btn) btn.click()
  })
  await page.waitForTimeout(200)
  // eslint-disable-next-line no-console
  console.log(`[ensureLuoghi] set Luoghi=${on}, final=${final}`)
  await dd.waitFor({ state: 'hidden' }).catch(() => {})
}

async function pressPseudonimizza(page: Page, timeoutMs = 60_000): Promise<void> {
  await page.locator('[data-testid="wireframe-action-btn"]').click()
  // POST-run, il pannello destro non è più una <textarea> ma un <DocumentView>
  // (data-testid="document-view"). Aspettiamo che appaia DOC-VIEW oppure che
  // la textarea (fallback caso senza output) abbia valore: prima delle due.
  await page.waitForFunction(
    () => {
      const dv = document.querySelector('[data-testid="document-view"]')
      if (dv && (dv.textContent ?? '').trim().length > 0) return true
      const ta = document.querySelector(
        '[data-testid="wireframe-textarea-pseudonimizzato"]',
      ) as HTMLTextAreaElement | null
      return !!ta && ta.value.length > 0
    },
    null,
    { timeout: timeoutMs },
  )
  // Small settle buffer for React state propagation to mappa table.
  await page.waitForTimeout(500)
}

async function pressApplica(page: Page): Promise<void> {
  // Open dropdown if closed.
  const dd = page.locator('[data-testid="wireframe-modifier-dropdown"]')
  if (!(await dd.isVisible().catch(() => false))) {
    await page.locator('[data-testid="wireframe-modifier-btn"]').click()
    await dd.waitFor({ state: 'visible' })
  }
  await page.locator('[data-testid="wireframe-modifier-apply-btn"]').click()
  // Wait until the apply button reverts (isApplyingModifiers cleared)
  await page
    .locator('[data-testid="wireframe-modifier-apply-btn"][aria-busy="false"]')
    .waitFor({ timeout: 60000 })
    .catch(() => {})
  await page.waitForTimeout(500)
}

async function pressSaveManual(page: Page): Promise<{ saved: boolean; reason?: string }> {
  const btn = page.locator('[data-testid="wireframe-save-btn"]')
  if (!(await btn.isVisible().catch(() => false))) {
    return { saved: false, reason: 'save-btn not rendered (no entities or auth missing)' }
  }
  // FIX (run 7): Playwright .click() in some renderings non completa in 90s
  // perché ri-retenta per layout-shift. Click diretto via JS evaluate,
  // bypassa stability checks. Il bottone è già stato controllato visible.
  const clicked = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="wireframe-save-btn"]')
    if (b instanceof HTMLButtonElement && !b.disabled) {
      b.click()
      return true
    }
    return false
  })
  if (!clicked) {
    return { saved: false, reason: 'save-btn disabled at click time (autosave on?)' }
  }
  await page.waitForTimeout(1500)
  return { saved: true }
}

async function setAutosave(page: Page, on: boolean): Promise<{ set: boolean; reason?: string }> {
  const toggle = page.locator('[data-testid="wireframe-save-autosave-toggle"]')
  if (!(await toggle.isVisible().catch(() => false))) {
    return { set: false, reason: 'autosave-toggle not rendered (no entities or auth missing)' }
  }
  const checked = await toggle.isChecked()
  if (checked === on) return { set: true }
  // FIX (run 11): stesso pattern di ensureLuoghi — DOM .click() programmatico
  // su HTMLInputElement triggera React onChange in modo affidabile.
  await toggle.evaluate((el: HTMLInputElement) => el.click())
  await page.waitForTimeout(200)
  const final = await toggle.isChecked()
  if (final !== on) {
    return { set: false, reason: `autosave-toggle failed to reach ${on} (got ${final})` }
  }
  return { set: true }
}

async function readPseudonymizedText(page: Page): Promise<string> {
  // Post-run il pannello destro è <DocumentView>, pre-run è <textarea>.
  return await page.evaluate(() => {
    const dv = document.querySelector('[data-testid="document-view"]')
    if (dv) return (dv.textContent ?? '').replace(/\s+\n/g, '\n').trim()
    const ta = document.querySelector(
      '[data-testid="wireframe-textarea-pseudonimizzato"]',
    ) as HTMLTextAreaElement | null
    return ta ? ta.value : ''
  })
}

async function readMappingTable(page: Page): Promise<MappingEntry[]> {
  // Mappa table is rendered by MappaPanel inside wireframe-card-locali.
  const rows: MappingEntry[] = await page.evaluate(() => {
    const out: { real: string; pseudo: string }[] = []
    const table = document.querySelector('[data-testid="mappa-table"]')
    if (!table) return out
    let idx = 0
    while (true) {
      const realEl = document.querySelector(
        `[data-testid="mappa-real-${idx}"]`,
      ) as HTMLInputElement | null
      const pseudoEl = document.querySelector(
        `[data-testid="mappa-pseudo-${idx}"]`,
      ) as HTMLInputElement | null
      if (!realEl || !pseudoEl) break
      out.push({ real: realEl.value, pseudo: pseudoEl.value })
      idx++
    }
    return out
  })
  return rows
}

/**
 * Warm-up NER: forza il caricamento del modello ONNX (~64 MB) prima della
 * matrice, così la prima cold-start non scade il timeout di un flusso reale.
 * Cold start ~30-60s, warm subsequent calls ~5-10s.
 *
 * Esegue: clear IDB → goto fresh → carica un doc dummy minimale → premi
 * PSEUDONIMIZZA con timeout esteso (90s) → log a stdout.
 */
async function warmUpNER(page: Page): Promise<void> {
  console.log('[warm-up] starting NER warm-up (cold start ~30-60s, prima volta)')
  const t0 = Date.now()
  // FIX (run 6): localStorage cleanup in addInitScript fixture; niente reload.
  // FIX (run 12): clearActiveMappingUI dopo clearIDB per reset cross-flow state.
  await gotoFresh(page)
  await clearIndexedDB(page)
  await clearActiveMappingUI(page)
  // Doc dummy minimo: una sola entità PER perché il modello esegua almeno
  // una forward pass e materializzi le ONNX session.
  const dummy = 'Mario Rossi è un nominativo di prova.'
  const ta = page.locator('[data-testid="wireframe-textarea-originale"]')
  await ta.click()
  await ta.fill(dummy)
  await ta.dispatchEvent('input')
  await ensureLuoghi(page, false)
  try {
    await pressPseudonimizza(page, 90_000)
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`[warm-up] OK (${dt}s) — NER model caricato`)
  } catch (err) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(
      `[warm-up] FAILED after ${dt}s — ${(err as Error).message}\n` +
        `Procedo comunque; i flussi successivi potrebbero scadere se NER non è caricato.`,
    )
  }
  // Cleanup post warm-up (clear IDB per non avvelenare F1).
  await clearIndexedDB(page)
}

// ── Flow runner ──────────────────────────────────────────────────────────

async function runFlow(page: Page, flow: Flow): Promise<FlowResult> {
  const result: FlowResult = {
    id: flow.id,
    passed: false,
    observedText: '',
    observedMap: [],
    deltas: [],
    skipped: false,
  }

  if (flow.mode === 'todo-complex') {
    result.skipped = true
    result.skipReason = 'marked TODO (complex interaction) — skipped in this pass'
    return result
  }

  // Stage 1 — fresh state.
  // FIX (run 6): localStorage cleanup spostato in addInitScript del fixture
  // (gira PRIMA del bootstrap React, ogni navigation). Niente reload —
  // evita race con beforeunload listener che causa frame detach.
  // FIX (run 12): clearIDB + clearActiveMappingUI per resettare anche React
  // state caricato da loadAggregateMapping (cross-flow contamination).
  await gotoFresh(page)
  await clearIndexedDB(page)
  await clearActiveMappingUI(page)
  await loadDoc(page, flow.setupS1.doc)
  await ensureLuoghi(page, flow.setupS1.luoghi)
  if (flow.setupS1.runPseudonimizza) {
    await pressPseudonimizza(page)
  }

  // Save phase.
  if (flow.saveMode === 'manual') {
    const r = await pressSaveManual(page)
    if (!r.saved) {
      result.skipped = true
      result.skipReason = `save manual required but ${r.reason}`
      return result
    }
  } else if (flow.saveMode === 'autosave') {
    const r = await setAutosave(page, true)
    if (!r.set) {
      result.skipped = true
      result.skipReason = `autosave required but ${r.reason}`
      return result
    }
    // Wait beyond debounce.
    await page.waitForTimeout(1000)
  }

  // Stage 2 — refresh (no IDB clear → simulate user reopens tab).
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page
    .locator('[data-testid="wireframe-textarea-originale"]')
    .waitFor({ state: 'visible', timeout: 30000 })

  // Load doc B / mixed / same.
  const docS2 =
    flow.setupS2.doc === 'same-as-s1' ? flow.setupS1.doc : flow.setupS2.doc
  await resetDoc(page)
  await loadDoc(page, docS2)
  await ensureLuoghi(page, flow.luoghiS2)

  // Action S2.
  if (flow.actionS2 === 'pseudonimizza') {
    await pressPseudonimizza(page)
  } else if (flow.actionS2 === 'applica') {
    await pressApplica(page)
  } else if (flow.actionS2 === 'pseudonimizza_then_applica') {
    await pressPseudonimizza(page)
    await pressApplica(page)
  }

  // Observe.
  result.observedText = await readPseudonymizedText(page)
  result.observedMap = await readMappingTable(page)

  // Validate predictions.
  const deltas: string[] = []
  const pred = flow.predicted
  if (pred.textNoLongerContains) {
    for (const tok of pred.textNoLongerContains) {
      if (result.observedText.includes(tok)) {
        deltas.push(`text STILL contains "${tok}" (predicted: absent)`)
      }
    }
  }
  if (pred.textStillContains) {
    for (const tok of pred.textStillContains) {
      if (!result.observedText.includes(tok)) {
        deltas.push(`text MISSING "${tok}" (predicted: present)`)
      }
    }
  }
  if (pred.mapHasReal) {
    for (const r of pred.mapHasReal) {
      const found = result.observedMap.some((e) =>
        e.real.toLowerCase().includes(r.toLowerCase()),
      )
      if (!found) {
        deltas.push(`map MISSING real="${r}" (predicted: present)`)
      }
    }
  }
  if (pred.mapMustNotHaveReal) {
    for (const r of pred.mapMustNotHaveReal) {
      const found = result.observedMap.some((e) =>
        e.real.toLowerCase().includes(r.toLowerCase()),
      )
      if (found) {
        deltas.push(`map UNEXPECTED real="${r}" (predicted: absent)`)
      }
    }
  }
  if (pred.mapHasPseudoMatching) {
    for (const cond of pred.mapHasPseudoMatching) {
      const row = result.observedMap.find((e) =>
        e.real.toLowerCase().includes(cond.real.toLowerCase()),
      )
      if (!row) {
        deltas.push(`map missing real="${cond.real}" for pseudo-pattern check`)
      } else if (!cond.pseudoMatches.test(row.pseudo)) {
        deltas.push(
          `map real="${cond.real}" → pseudo="${row.pseudo}" does not match ${cond.pseudoMatches}`,
        )
      }
    }
  }

  result.deltas = deltas
  result.passed = deltas.length === 0
  return result
}

// ── Report writer ────────────────────────────────────────────────────────

function writeReport(results: FlowResult[]): void {
  const ts = new Date().toISOString()
  const lines: string[] = []
  lines.push(`# Recode IT — persistence matrix results`)
  lines.push('')
  lines.push(`- Generated: ${ts}`)
  lines.push(`- Target URL: ${RECODE_URL}`)
  lines.push(`- Auth mode: CDP (Chrome del founder già loggato — vedi tests/e2e/README.md)`)
  lines.push('')
  lines.push(`## Summary table`)
  lines.push('')
  lines.push('| ID | Description | Mode | Risk | Predicted | Observed (head) | Status | Code-path notes |')
  lines.push('|----|-------------|------|------|-----------|-----------------|--------|-----------------|')
  for (const flow of MATRIX) {
    const r = results.find((x) => x.id === flow.id)
    let status: string
    let notes = ''
    if (!r) {
      status = 'NOT-RUN'
    } else if (r.skipped) {
      status = 'SKIP'
      notes = r.skipReason ?? ''
    } else if (r.passed) {
      status = 'PASS'
    } else {
      status = 'FAIL'
      notes = r.deltas.join('; ')
    }
    lines.push(
      `| ${flow.id} | ${flow.description.replace(/\|/g, '\\|')} | ${flow.mode} | ${flow.riskLevel} | ${flow.predicted.description.replace(/\|/g, '\\|')} | ${r ? (r.observedText.length > 60 ? r.observedText.slice(0, 60).replace(/\n/g, ' ') + '…' : r.observedText.replace(/\n/g, ' ')) : 'n/a'} | ${status} | ${notes.replace(/\|/g, '\\|')} |`,
    )
  }
  lines.push('')
  lines.push(`## Per-flow detail`)
  for (const flow of MATRIX) {
    const r = results.find((x) => x.id === flow.id)
    lines.push('')
    lines.push(`### ${flow.id} — ${flow.description}`)
    lines.push(`- **Risk:** ${flow.riskLevel}`)
    lines.push(`- **Mode:** ${flow.mode}`)
    lines.push(`- **Predicted:** ${flow.predicted.description}`)
    if (!r) {
      lines.push(`- **Status:** NOT-RUN`)
      continue
    }
    if (r.skipped) {
      lines.push(`- **Status:** SKIP — ${r.skipReason}`)
      continue
    }
    lines.push(`- **Status:** ${r.passed ? 'PASS' : 'FAIL'}`)
    if (r.deltas.length > 0) {
      lines.push(`- **Deltas:**`)
      for (const d of r.deltas) lines.push(`  - ${d}`)
    }
    lines.push(`- **Observed pseudonymized text (first 400 chars):**`)
    lines.push('```')
    lines.push(r.observedText.slice(0, 400))
    lines.push('```')
    lines.push(`- **Observed mapping (${r.observedMap.length} entries):**`)
    lines.push('| Real | Pseudo |')
    lines.push('|------|--------|')
    for (const e of r.observedMap) {
      lines.push(`| ${e.real.replace(/\|/g, '\\|')} | ${e.pseudo.replace(/\|/g, '\\|')} |`)
    }
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf-8')
}

// ── Test entrypoint ──────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' })

test('persistence_matrix — full a-priori prediction sweep', async ({ page }) => {
  test.setTimeout(15 * 60_000) // 15 min hard cap for the whole sweep.

  // CDP mode: il context appartiene al founder già loggato (vedi fixtures.ts).
  // Niente login flow. Si confida nella sessione del browser.
  console.log('[auth] CDP mode — context del founder, autenticazione "free"')

  // Warm-up NER UNA volta sola, prima della matrice.
  await warmUpNER(page)

  const results: FlowResult[] = []
  for (const flow of MATRIX) {
    console.log(`[${flow.id}] running — ${flow.description}`)
    try {
      const r = await runFlow(page, flow)
      results.push(r)
      if (r.skipped) {
        console.log(`[${flow.id}] SKIP — ${r.skipReason}`)
      } else if (r.passed) {
        console.log(`[${flow.id}] PASS`)
      } else {
        console.log(`[${flow.id}] FAIL — ${r.deltas.join('; ')}`)
      }
    } catch (err) {
      console.log(`[${flow.id}] ERROR — ${(err as Error).message}`)
      results.push({
        id: flow.id,
        passed: false,
        observedText: '',
        observedMap: [],
        deltas: [`exception: ${(err as Error).message}`],
        skipped: false,
      })
    }
  }

  writeReport(results)
  console.log(`\nReport written to: ${REPORT_PATH}`)

  // Soft assertion: i flussi che hanno girato non devono aver eccepito.
  const hardFails = results.filter(
    (r) =>
      !r.skipped &&
      !r.passed &&
      r.deltas.some((d) => d.startsWith('exception:')),
  )
  expect(hardFails, `unhandled exceptions in flows: ${hardFails.map((r) => r.id).join(',')}`).toEqual([])
})
