# Recode IT — End-to-end harness (matrice persistenza)

Test browser-driven che esegue la matrice 15-flussi a-priori (predizione vs
osservato) contro la live site `https://recode.micheleloi.pro/` e produce
`tests/e2e/persistence_matrix_results.md`.

## Come lanciare la matrice (procedura per Michele)

> Questa è la procedura **manuale UNA volta** prima di ogni run. La matrice
> usa `connectOverCDP` per agganciarsi al **tuo** Chrome già loggato — niente
> credenziali nel codice, niente storage state, niente login automatico.

### 1. Chiudi TUTTE le finestre Chrome

Importante. Se ne resta anche solo una aperta senza il flag CDP, il flag
`--remote-debugging-port` viene ignorato (Chrome riusa l'istanza esistente).

> **Suggerimento veloce:** PowerShell, `Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force`
> (chiude tutte le istanze Chrome senza prompt).

### 2. Apri PowerShell e lancia Chrome con CDP abilitato

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\User Data"
```

Il flag `--user-data-dir` punta al tuo profilo abituale → cookie, sessione
recode, password manager, tutto intatto.

> Se Chrome è installato in un path diverso, sostituisci. Path tipici:
> - `C:\Program Files\Google\Chrome\Application\chrome.exe` (install per macchina)
> - `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe` (legacy 32-bit)
> - `$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe` (install per utente)

### 3. Vai su `https://recode.micheleloi.pro/`

Sei già loggato (cookie persistente). Lascia la tab aperta — il harness aprirà
una **nuova tab** dedicata al test e non disturberà questa.

### 4. Dimmi "vai"

Io lancio:

```powershell
npm run test:e2e
```

Tu osservi lo schermo (la nuova tab fa tutto in automatico). Il report finale
viene scritto in `tests/e2e/persistence_matrix_results.md`.

## Tempi attesi

- **Warm-up NER** (prima volta): 30-60s (carica modello ONNX ~64 MB).
- **Per-flow** (escluso warm-up): ~20-40s a flusso, due `PSEUDONIMIZZA` ciascuno.
- **Matrice completa** (13 flussi attivi, 2 TODO skip): ~8-12 minuti.
- **Hard cap totale**: 15 minuti (configurato in `playwright.config.ts`).

## Override opzionali (env vars)

| Var | Default | Effetto |
|---|---|---|
| `RECODE_URL` | `https://recode.micheleloi.pro/` | Target site (utile per `http://localhost:5173` su dev locale) |
| `RECODE_CDP_URL` | `http://localhost:9222` | Endpoint CDP del Chrome del founder |
| `RECODE_HEADLESS` | (off) | `=1` per headless — **NON usare in modalità CDP**, il Chrome del founder è già visibile |

## Cosa fa il harness

Per ogni flusso:
1. Pulisce IndexedDB della tab di test.
2. Carica un doc (`A`, `B`, o `mixed`).
3. Setta toggle "Luoghi" come da predizione.
4. Preme PSEUDONIMIZZA (se richiesto dal flusso).
5. Salva (manuale / autosave / nessuno).
6. **Reload** della pagina (simula utente che riapre il browser).
7. Carica doc S2, setta Luoghi S2, esegue azione S2.
8. Legge testo pseudonimizzato + tabella mappa.
9. Confronta con predicted → PASS / FAIL.

Output in `persistence_matrix_results.md` con tabella riepilogo +
sezione dettaglio per-flusso (testo osservato + mappa).

## Troubleshooting

- **"connectOverCDP fallito"**: Chrome non è stato lanciato col flag, oppure
  ne è restata aperta un'altra istanza prima. Chiudi tutto e ripeti step 2.
- **F1-F2-F4-F8-F11 escono SKIP "save-btn not rendered"**: il context CDP
  non è loggato sulla tab (cookie scaduto? Hai cambiato profilo?). Apri
  `recode.micheleloi.pro` manualmente, verifica di vedere il pulsante
  "Conserva pseudonimi", poi rilancia.
- **Warm-up timeout**: connessione lenta o WASM lento, aumenta in
  `persistence_matrix.spec.ts` il timeout `pressPseudonimizza(page, 90_000)`
  dentro `warmUpNER`.

## Flussi marcati TODO

- **F12** "Sostituisci comunque": interazione UI multi-step troppo complessa
  per il harness corrente.
- **F15** Race autosave debounced 600ms: timing-based, eseguito a mano per
  ora.

Entrambi marcati `mode: 'todo-complex'` → skip automatico, registrato in
report come "SKIP — marked TODO".
