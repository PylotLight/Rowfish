import { useEffect, useState } from 'react'
import { APP_NAME, APP_TAGLINE } from '../../shared/config'
import type { GlassState, SysInfo } from '../../shared/types'
import Agent from './views/Agent'
import ClientSamples from './views/ClientSamples'
import Kitchen from './views/Kitchen'
import NativeLab from './views/NativeLab'
import Overview from './views/Overview'

type Tab = 'overview' | 'explorer' | 'capture' | 'native' | 'kitchen' | 'agent'
const TABS: Array<{ id: Tab; label: string; mark: string }> = [
  { id: 'overview', label: 'Overview', mark: '⌂' },
  { id: 'explorer', label: 'Storage explorer', mark: '▤' },
  { id: 'capture', label: 'Quick capture', mark: '✎' },
  { id: 'native', label: 'macOS & tray', mark: '◉' },
  { id: 'kitchen', label: 'UI components', mark: '▦' },
  { id: 'agent', label: 'Workflow example', mark: '↗' }
]

export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview')
  const [sys, setSys] = useState<SysInfo | null>(null)
  const [glass, setGlass] = useState<GlassState | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    window.api.sys.info().then(setSys).catch(console.error)
    window.api.glass.get().then(setGlass).catch(console.error)
  }, [])

  const selected = TABS.find((item) => item.id === tab) ?? TABS[0]!
  const isVibrant = glass !== null && glass.vibrancy !== null

  return (
    <div className="shell" data-platform={sys?.platform ?? 'unknown'}>
      <aside className="sidebar">
        <div className="traffic-spacer" aria-hidden="true" />
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><span>r</span></span>
          <div className="brand-copy">
            <h1>{APP_NAME}</h1>
            <p>{APP_TAGLINE}</p>
          </div>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="nav" role="tablist" aria-label="Starter sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => {
                setTab(item.id)
                setQuery('')
              }}
            >
              <span className="nav-mark" aria-hidden="true">{item.mark}</span>
              <span>{item.label}</span>
              {item.id === 'native' && <span className="nav-indicator" aria-label="Native tests" />}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className={`status-pill${isVibrant ? ' on' : ''}`}>
            <span className="status-dot" aria-hidden="true" />
            {glass === null ? 'Checking native window…' : isVibrant ? 'Native glass active' : 'Glass disabled'}
          </span>
          <span className="status-sub">
            {sys ? `${sys.platform} · ${sys.arch} · Electron ${window.api.versions.electron()}` : 'Reading system details…'}
          </span>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div className="page-context">
            <span className="page-kicker">ROWFISH / STARTER</span>
            <span className="page-title">{selected.label}</span>
          </div>
          <input
            className="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === 'explorer' ? 'Search sample storage…' : tab === 'capture' ? 'Search captures…' : 'Search this view…'}
            aria-label="Search this view"
          />
          <button className="btn ghost hide-button" title="Hide the app (⌘H on macOS)" onClick={() => void window.api.app.hide()}>
            Hide
          </button>
        </header>

        <main className="view" key={tab}>
          {tab === 'overview' && <Overview sys={sys} onNavigate={setTab} />}
          {(tab === 'explorer' || tab === 'capture') && <ClientSamples mode={tab} query={query} />}
          {tab === 'native' && <NativeLab platform={sys?.platform} glass={glass} onGlassChange={setGlass} query={query} />}
          {tab === 'kitchen' && <Kitchen />}
          {tab === 'agent' && <Agent />}
        </main>
      </div>
    </div>
  )
}
