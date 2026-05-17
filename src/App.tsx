import { GIT_SHA } from './buildInfo'

export function App(): JSX.Element {
  return (
    <main className="app">
      <header>
        <h1>Recode IT</h1>
        <p className="tagline">Pseudonimizzazione italiana, in pre-uscita</p>
      </header>
      <section className="status">
        <span className="status-badge">Phase 0 scaffold OK</span>
        <span className="status-sha">build: {GIT_SHA}</span>
      </section>
    </main>
  )
}
