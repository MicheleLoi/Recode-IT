/**
 * ModelLoadingState — loading indicator shown while the GLiNER model is being
 * downloaded and initialised.
 *
 * Displays:
 *   - "Inizializzazione runtime..." during WASM boot (phase: wasm)
 *   - "Caricamento modello AI... XX%" during download (phase: download)
 *   - "Preparazione modello..." during session creation (phase: session)
 *
 * Audience: avvocato non-tecnico — no "WASM", no "ONNX", no "model URL".
 */

export type ModelLoadPhase = 'wasm' | 'download' | 'session'

type Props = {
  phase: ModelLoadPhase
  /** Bytes downloaded so far. */
  loaded: number
  /** Total expected bytes (0 if Content-Length was unavailable). */
  total: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

export function ModelLoadingState({ phase, loaded, total }: Props): JSX.Element {
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null

  let headline: string
  let detail: string | null = null

  if (phase === 'wasm') {
    headline = 'Inizializzazione runtime...'
  } else if (phase === 'download') {
    if (pct !== null) {
      headline = `Caricamento modello AI... ${pct}%`
      detail =
        total > 0
          ? `${formatBytes(loaded)} di ${formatBytes(total)} scaricati`
          : `${formatBytes(loaded)} scaricati`
    } else {
      headline = 'Caricamento modello AI...'
    }
  } else {
    headline = 'Preparazione modello...'
  }

  return (
    <div className="model-loading" role="status" aria-live="polite" data-testid="model-loading">
      <span className="model-loading__spinner" aria-hidden="true" />
      <div className="model-loading__text">
        <p className="model-loading__headline">{headline}</p>
        {detail && <p className="model-loading__detail">{detail}</p>}
        {phase === 'download' && pct !== null && (
          <div
            className="model-loading__bar"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Download modello: ${pct}%`}
          >
            <div
              className="model-loading__bar-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <p className="model-loading__hint">
          La prima volta richiede 30–90 secondi; le visite successive sono
          istantanee.
        </p>
      </div>
    </div>
  )
}
