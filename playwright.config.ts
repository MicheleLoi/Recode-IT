/**
 * playwright.config.ts — Recode IT end-to-end suite.
 *
 * Separate from vitest (unit/integration in src/__tests__). Playwright tests
 * live in tests/e2e/ and target the live site by default; override via
 * RECODE_URL env.
 *
 * Founder direttiva (SID-20260530, "si prova tutto, niente a mano"):
 * - headless OFF by default for local debug visibility; set RECODE_HEADLESS=1
 *   to flip (CI / batch runs).
 * - single worker, serial — the matrix shares one browser tab to simulate the
 *   real user reopening their window; parallelism would break the IDB-state
 *   assumptions.
 * - long timeouts because the NER pipeline + WASM cold load are slow on first
 *   page render (~60s cold start per il modello ONNX ~64 MB).
 *
 * Founder direttiva 2026-05-31 ("Opzione C"):
 * - Connessione CDP al Chrome del founder già loggato. Il browser launch di
 *   Playwright è bypassato dai fixtures in `tests/e2e/fixtures.ts`. Le opzioni
 *   `headless` / `devices['Desktop Chrome']` qui sotto sono per i test che NON
 *   importano i fixtures (nessuno, in questo momento); restano come fallback.
 * - L'auth è "free" via CDP — niente login programmatico, niente storage state.
 *   I flussi precedentemente marcati `needs-auth` ora sono `ok-via-cdp`.
 */

import { defineConfig, devices } from '@playwright/test'

const headless = process.env.RECODE_HEADLESS === '1'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000, // 15 min per single test (the matrix runs as ONE test)
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.RECODE_URL ?? 'https://recode.micheleloi.pro/',
    headless,
    actionTimeout: 90_000, // 90s for NER cold start + WASM model load (~64 MB)
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
