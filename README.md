# Recode IT

Browser-based pseudonymization tool for Italian legal professionals (lawyers,
accountants, public administrations). Recode IT lets users drag a document,
inspect and correct an Italian-aware pseudonymized preview, copy the result to
their own Claude account, then paste Claude's response and recover the original
names. The pseudonymization engine runs entirely in the browser via WebAssembly;
the server stores only AES-256-GCM ciphertext (zero-knowledge).

The product is a browser repackaging of the validated Python pipeline already in
production in MHC-L — see `DESIGN.md` §2 ("Heritage from MHC-L") for the reuse
inventory.

## Quick start

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Type-check and produce a production bundle in `dist/`. |
| `npm run preview` | Serve the production bundle locally. |
| `npm run typecheck` | TypeScript strict-mode check, no emit. |
| `npm run lint` | ESLint over `src/`. |
| `npm run format` | Prettier rewrite over `src/`. |
| `npm run test` | Vitest run (single pass). |
| `npm run test:watch` | Vitest in watch mode. |

## Project status

**Phase 0 — scaffold — COMPLETE.** Vite + React + TypeScript baseline, ESLint +
Prettier + Vitest configured, the four canonical MHC-L fixture documents copied
into `test-fixtures/mhc-l/documents/`, the Phase 4 goldens-generator script
scaffolded with its R-07 `--check-signatures` mode already functional.

**Phase 1 — engine port + MHC-L regression suite — NEXT.** See
`IMPLEMENTATION_PLAN.md` §Phase 1 for the deliverable spec.

## Design context

- `DESIGN.md` — full architecture (ratified). Read first.
- `IMPLEMENTATION_PLAN.md` — phased roadmap and per-phase gate conditions.
- `TEST_PLAN.md` — testing posture and per-phase test inventory.
- `OPEN_RISKS.md` — risk register; R-01 (port fidelity), R-04 (crypto),
  R-07 (heritage drift) are the load-bearing ones for early phases.
