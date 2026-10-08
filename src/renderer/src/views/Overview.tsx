import type { SysInfo } from '../../../shared/types'

type Tab = 'overview' | 'explorer' | 'capture' | 'native' | 'kitchen' | 'agent'

export default function Overview({ sys, onNavigate }: { sys: SysInfo | null; onNavigate: (tab: Tab) => void }): React.JSX.Element {
  const isMac = sys?.platform === 'darwin'
  return (
    <section className="overview-page">
      <div className="overview-hero">
        <div className="hero-copy">
          <span className="hero-eyebrow"><span className="hero-spark" /> POSTGRESQL + MONGODB</span>
          <h1>Connect to data.<br />Keep your flow.</h1>
          <p>Rowfish is a desktop workspace for connecting to PostgreSQL and MongoDB, running queries, and exploring bounded results without blocking the interface.</p>
          <div className="hero-actions">
            <button className="btn mint" onClick={() => onNavigate('explorer')}>Open database client <span>→</span></button>
            <button className="btn ghost" onClick={() => onNavigate('capture')}>Try quick capture</button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="orb orb-a" /><div className="orb orb-b" /><div className="orb-ring" /><div className="hero-fish"><span>r</span></div><div className="hero-glint" /></div>
        <div className="hero-foot"><span>BUILD A REAL APP FROM HERE</span><span>01 <i /> 04</span></div>
      </div>

      <div className="overview-heading"><div><span className="section-overline">WORKSPACE</span><h2>Connect, query, explore.</h2></div><span className="overview-note">Credentials are session-only.</span></div>
      <div className="starter-grid">
        <button className="starter-card explorer-card" onClick={() => onNavigate('explorer')}>
          <span className="starter-card-top"><span className="starter-icon explorer-icon">▤</span><span className="starter-number">01 / DATABASE</span></span>
          <h3>Database client</h3><p>Connect PostgreSQL and MongoDB, stream query results in bounded batches, and cancel work that is taking too long.</p>
          <span className="starter-card-link">Open database workspace <b>→</b></span>
        </button>
        <button className="starter-card capture-card" onClick={() => onNavigate('capture')}>
          <span className="starter-card-top"><span className="starter-icon capture-icon">✎</span><span className="starter-number">02 / CAPTURE</span></span>
          <h3>Inkfish</h3><p>Capture a thought, save it into an inbox, and switch between notes in a focused editor layout.</p>
          <span className="starter-card-link">Open capture pattern <b>→</b></span>
        </button>
      </div>

      <div className="system-strip">
        <div className="system-strip-head"><span className="section-overline">LIVE SYSTEM CHECK</span><span className={`platform-state${isMac ? ' is-mac' : ''}`}><i /> {sys ? isMac ? 'Mac detected' : 'Cross-platform fallback' : 'Checking'}</span></div>
        <div className="system-metrics">
          <div><span>Platform</span><b>{sys?.platform ?? '—'}</b></div>
          <div><span>Architecture</span><b>{sys?.arch ?? '—'}</b></div>
          <div><span>Electron</span><b>{window.api.versions.electron()}</b></div>
          <div><span>CPU cores</span><b>{sys?.cpus ?? '—'}</b></div>
          <button className="native-link" onClick={() => onNavigate('native')}>Test native features <span>↗</span></button>
        </div>
      </div>
    </section>
  )
}
