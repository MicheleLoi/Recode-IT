import { GIT_SHA } from './buildInfo'
import { ClipboardWidget } from './ui/ClipboardWidget'

export function App(): JSX.Element {
  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-inner">
          <h1>Recode IT</h1>
          <p className="tagline">Pseudonimizzazione italiana, locale.</p>
        </div>
      </header>

      <main className="app__main">
        <ClipboardWidget />
      </main>

      <footer className="app__footer">
        <span>
          Recode IT — pseudonimizzazione e recoding in locale, senza upload del
          documento originale.
        </span>
        <span className="app__footer-links">
          <a href="/privacy">Privacy</a>
          <span className="app__build">build {GIT_SHA}</span>
        </span>
      </footer>
    </div>
  )
}
