/**
 * Fixture-loading helper for the MHC-L regression suite.
 *
 * Reads the four canonical documents from `test-fixtures/mhc-l/documents/`.
 * Path is resolved against the repo root via `import.meta.url` so it works
 * regardless of the cwd Vitest is run from.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(HERE, '../../..', 'test-fixtures/mhc-l/documents')

export type FixtureName =
  | 'doc_A_fendipista'
  | 'doc_B_eredita'
  | 'doc_C_il_leak'
  | 'doc_00_appalto_edilizio'

export function loadFixture(name: FixtureName): string {
  return readFileSync(resolve(FIXTURES_DIR, `${name}.md`), 'utf-8')
}
