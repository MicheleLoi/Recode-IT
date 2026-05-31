/**
 * fixtures.ts — Playwright `test` esteso con connectOverCDP.
 *
 * Strategia (founder direttiva 2026-05-31, "Opzione C"):
 *   Il harness NON lancia un browser nuovo. Si connette via CDP al Chrome che
 *   il founder ha già aperto e in cui è già loggato su recode.micheleloi.pro.
 *   Niente storage state da gestire, niente credenziali in env, niente flusso
 *   di login automatico (fragile). L'autenticazione è "free" perché il context
 *   è quello del founder.
 *
 *   Prerequisito che il founder fa a mano UNA volta per run:
 *     1. Chiudere TUTTE le finestre Chrome.
 *     2. Lanciare:
 *        & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
 *          --remote-debugging-port=9222 `
 *          --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\User Data"
 *     3. Aprire https://recode.micheleloi.pro/ (loggato di default).
 *   Vedi `tests/e2e/README.md` per la procedura completa.
 *
 *   URL CDP override: env `RECODE_CDP_URL` (default `http://localhost:9222`).
 *
 *   Nota sul `context`: prendiamo quello esistente del founder (browser.contexts()[0])
 *   così sfruttiamo cookie/sessione già presenti. Apriamo una NUOVA tab per i
 *   test in modo da non disturbare le altre tab eventualmente aperte.
 */

import { test as base, chromium, type BrowserContext, type Browser } from '@playwright/test'

const CDP_URL = process.env.RECODE_CDP_URL || 'http://localhost:9222'

type Fixtures = {
  // Override del browser e context per usare CDP del Chrome founder.
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  browser: async ({}, use) => {
    let browser: Browser
    try {
      browser = await chromium.connectOverCDP(CDP_URL)
    } catch (err) {
      throw new Error(
        `[fixtures] connectOverCDP(${CDP_URL}) fallito: ${(err as Error).message}\n` +
          `Probabile causa: Chrome non è stato lanciato con --remote-debugging-port=9222.\n` +
          `Vedi tests/e2e/README.md per la procedura di avvio.`,
      )
    }
    await use(browser)
    // NON chiudere il browser — è del founder.
  },
  context: async ({ browser }, use) => {
    // Riusa il context esistente (sessione loggata del founder). Se non esiste
    // (caso teorico — Chrome appena aperto senza tab), creane uno nuovo.
    const existing = browser.contexts()
    const ctx: BrowserContext =
      existing.length > 0 ? existing[0] : await browser.newContext()
    await use(ctx)
    // NON chiudere il context — appartiene al founder.
  },
  page: async ({ context }, use) => {
    // FIX (run 6): clearLocalStorage('recodeit:autoSaveMapping') deve avvenire
    // PRIMA del bootstrap React (autoSaveEnabled useState legge LS al mount,
    // WireframeWorkArea.tsx:402). addInitScript gira a ogni navigation prima
    // del page script — disabilita autosave da subito. Evita il pattern
    // goto→clear→reload che causa frame detach con beforeunload.
    await context.addInitScript(() => {
      try { window.localStorage.removeItem('recodeit:autoSaveMapping') } catch { /* ignore */ }
    })
    // Sempre una NUOVA tab dedicata al test, così non tocchiamo le altre.
    const page = await context.newPage()
    // Auto-accept JavaScript dialogs (beforeunload, confirm, alert): recode
    // installs a beforeunload "modifiche non salvate?" listener quando ci sono
    // entità — senza handler, page.goto si rompe con ERR_ABORTED + frame detached.
    page.on('dialog', async (dialog) => {
      try { await dialog.accept() } catch { /* dialog may already be handled */ }
    })
    await use(page)
    await page.close().catch(() => {})
  },
})

export const expect = test.expect
