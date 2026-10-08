import { useState } from 'react'
import DatabaseWorkspace from './views/DatabaseWorkspace'

export default function App(): React.JSX.Element {
  const [search, setSearch] = useState('')

  return (
    <div className="shell">
      <main className="content">
        <header className="topbar">
          <div className="app-brand">
            <span className="brand-mark" aria-hidden="true">r</span>
            <div>
              <h1>Rowfish</h1>
              <span>Database client</span>
            </div>
          </div>
          <input
            className="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter result rows…"
            aria-label="Filter result rows"
          />
        </header>

        <div className="view">
          <DatabaseWorkspace search={search} />
        </div>
      </main>
    </div>
  )
}
