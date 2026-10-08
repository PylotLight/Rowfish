import { useMemo, useState } from 'react'
import { filterStorageEntries, makeCapture, SAMPLE_STORAGE_ENTRIES, type CaptureNote } from '../../../shared/demo'

type Mode = 'explorer' | 'capture'

const STARTER_NOTES: CaptureNote[] = [
  { id: 'note-1', title: 'Mac release checklist', body: 'Test a signed build\nVerify arm64 and x64 packages\nCheck first-launch permissions', createdAt: Date.now() - 60_000 },
  { id: 'note-2', title: 'Ideas for the sidebar', body: 'Keep navigation calm and scannable. Make the current section obvious.', createdAt: Date.now() - 3_600_000 },
  { id: 'note-3', title: 'Follow up with design', body: 'Share the updated glass treatment and ask for feedback on contrast.', createdAt: Date.now() - 86_400_000 }
]

export default function ClientSamples({ mode, query }: { mode: Mode; query: string }): React.JSX.Element {
  return mode === 'explorer' ? <ExplorerSample query={query} /> : <CaptureSample query={query} />
}

function ExplorerSample({ query }: { query: string }): React.JSX.Element {
  const [folder, setFolder] = useState('project-assets')
  const [selected, setSelected] = useState('design-system/')
  const [connected, setConnected] = useState(true)
  const [showConnect, setShowConnect] = useState(false)
  const [notice, setNotice] = useState('')
  const items = useMemo(() => filterStorageEntries(SAMPLE_STORAGE_ENTRIES, query), [query])

  return (
    <section className="client-page">
      <div className="sample-banner">
        <span className="sample-label">BLOBFISH-INSPIRED UI · LOCAL SAMPLE</span>
        <span>Layout study only — the storage rows below are mock data.</span>
      </div>
      <div className="client-window explorer-window">
        <aside className="client-rail">
          <div className="client-rail-title">STORAGE</div>
          <button className="client-rail-action" onClick={() => setShowConnect(true)}><span>＋</span> Connect account</button>
          <div className="client-section-label">QUICK ACCESS</div>
          <button className={`client-tree-row${folder === 'project-assets' ? ' selected' : ''}`} onClick={() => setFolder('project-assets')}><span className="tree-icon">▱</span> project-assets</button>
          <button className={`client-tree-row${folder === 'archive' ? ' selected' : ''}`} onClick={() => setFolder('archive')}><span className="tree-icon">▱</span> archive</button>
          <div className="client-section-label tree-spaced">ACCOUNTS</div>
          {connected ? (
            <button className="client-tree-row" onClick={() => setFolder('project-assets')}><span className="tree-icon">◉</span> Northstar storage</button>
          ) : <p className="client-empty-hint">No accounts connected yet.</p>}
          <div className="client-rail-foot"><span className="status-dot" /> {connected ? 'Sample account ready' : 'Disconnected'}</div>
        </aside>
        <div className="client-stage">
          <div className="client-stage-head">
            <div>
              <div className="client-breadcrumb">Northstar storage <span>›</span> project-assets <span>›</span></div>
              <h2>{folder === 'archive' ? 'archive' : 'project-assets'}</h2>
              <p className="muted">Container · West US 2 · Last synced just now</p>
            </div>
            <div className="client-actions">
              <button className="btn ghost" onClick={() => setNotice('Refresh queued for the sample view.')}>↻ Refresh</button>
              <button className="btn" onClick={() => setNotice('Upload is a UI placeholder in this starter.')}>↑ Upload</button>
            </div>
          </div>
          <div className="client-summary-row">
            <span><b>{items.length}</b> visible items</span>
            <span className="summary-separator" />
            <span><b>2.8 GB</b> used in this sample</span>
          </div>
          <div className="file-list" role="list" aria-label="Sample storage objects">
            <div className="file-list-head"><span>Name</span><span>Details</span><span>Modified</span></div>
            {items.map((item) => (
              <button key={item.name} role="listitem" className={`file-row${selected === item.name ? ' selected' : ''}`} onClick={() => setSelected(item.name)}>
                <span className="file-name"><span className={`file-glyph ${item.kind}`} aria-hidden="true">{item.kind === 'folder' ? '▰' : '▧'}</span>{item.name}</span>
                <span className="file-detail">{item.detail}</span>
                <span className="file-modified">{item.modified}</span>
              </button>
            ))}
            {items.length === 0 && <div className="file-empty">No sample objects match that search.</div>}
          </div>
          <div className="client-footnote">Selected: <b>{selected}</b><span>·</span> ⌘F search <span>·</span> ⌘B collapse sidebar</div>
          {notice && <button className="inline-notice" onClick={() => setNotice('')} aria-label="Dismiss message">{notice} <b>×</b></button>}
        </div>
      </div>
      {showConnect && (
        <div className="modal-backdrop" onClick={() => setShowConnect(false)}>
          <div className="modal glass strong" role="dialog" aria-modal="true" aria-labelledby="connect-heading" onClick={(event) => event.stopPropagation()}>
            <div className="modal-kicker">SAMPLE WORKFLOW</div>
            <h3 id="connect-heading">Connect a storage account</h3>
            <p className="muted">This starter dialog is intentionally local. Add your account form and secure secret handling in the main process when you build a real client.</p>
            <label className="field"><span>Display name</span><input defaultValue="My storage account" /></label>
            <div className="row end"><button className="btn ghost" onClick={() => setShowConnect(false)}>Cancel</button><button className="btn mint" onClick={() => { setConnected(true); setShowConnect(false); setNotice('Sample account connected locally.') }}>Connect sample</button></div>
          </div>
        </div>
      )}
    </section>
  )
}

function CaptureSample({ query }: { query: string }): React.JSX.Element {
  const [notes, setNotes] = useState(STARTER_NOTES)
  const [draft, setDraft] = useState('')
  const [selectedId, setSelectedId] = useState('note-1')
  const [notice, setNotice] = useState('')
  const visibleNotes = notes.filter((note) => `${note.title} ${note.body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selected = notes.find((note) => note.id === selectedId) ?? visibleNotes[0] ?? null

  function saveDraft(): void {
    const capture = makeCapture(draft)
    if (!capture) return
    setNotes((current) => [capture, ...current])
    setSelectedId(capture.id)
    setDraft('')
    setNotice('Saved to this session’s inbox.')
  }

  return (
    <section className="client-page">
      <div className="sample-banner capture-banner">
        <span className="sample-label">INKFISH-INSPIRED UI · LOCAL SAMPLE</span>
        <span>Fast capture, a calm inbox and focused writing — session-only notes.</span>
      </div>
      <div className="client-window capture-window">
        <aside className="capture-rail">
          <div className="capture-profile"><span className="capture-avatar">R</span><span><b>My workspace</b><small>Local notes</small></span><span className="rail-chevron">⌄</span></div>
          <div className="client-section-label">LIBRARY</div>
          <button className="capture-nav selected"><span>▣</span> Inbox <span className="count-badge">{notes.length}</span></button>
          <button className="capture-nav"><span>◷</span> Recent</button>
          <button className="capture-nav"><span>⌑</span> All notes</button>
          <div className="client-section-label tree-spaced">PROJECTS</div>
          <button className="capture-nav"><span className="project-dot mint-dot" /> Product</button>
          <button className="capture-nav"><span className="project-dot blue-dot" /> Personal</button>
          <div className="capture-rail-foot"><span className="sync-mark">✓</span> All changes saved locally</div>
        </aside>
        <div className="capture-content">
          <div className="capture-toolbar"><span>Inbox <span className="subtle-divider">/</span> All captures</span><button className="btn ghost" onClick={() => setNotice('The import flow is a starter placeholder.')}>Import</button></div>
          <div className="capture-body">
            <div className="inbox-list">
              <div className="inbox-list-head"><span>CAPTURES</span><button title="New capture" onClick={() => document.querySelector<HTMLTextAreaElement>('.capture-editor textarea')?.focus()}>＋</button></div>
              {visibleNotes.map((note) => (
                <button key={note.id} className={`inbox-note${selected?.id === note.id ? ' selected' : ''}`} onClick={() => setSelectedId(note.id)}>
                  <b>{note.title}</b><span>{note.body.split('\n')[0]}</span><small>{formatRelative(note.createdAt)}</small>
                </button>
              ))}
              {visibleNotes.length === 0 && <p className="client-empty-hint">No captures match your search.</p>}
            </div>
            <div className="capture-editor">
              {selected ? <>
                <div className="editor-label"><span>NOTE</span><span>Saved locally</span></div>
                <h2>{selected.title}</h2>
                <div className="editor-meta">Inbox <span>·</span> {formatDate(selected.createdAt)}</div>
                <pre className="note-body">{selected.body}</pre>
                <div className="editor-rule" />
                <label className="draft-label" htmlFor="capture-draft">QUICK CAPTURE</label>
              </> : <><h2>Start with a thought</h2><p className="muted">Capture something and it will appear in this inbox.</p></>}
              <div className="draft-composer">
                <textarea id="capture-draft" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveDraft() }} placeholder="Write a thought, reminder, or meeting note…" aria-label="Quick capture draft" />
                <div className="composer-foot"><span>⌘ Enter to save · Demo notes stay in memory</span><button className="btn mint" onClick={saveDraft} disabled={!draft.trim()}>Save capture <span>↗</span></button></div>
              </div>
              {notice && <button className="inline-notice" onClick={() => setNotice('')}>{notice} <b>×</b></button>}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function formatRelative(at: number): string {
  const elapsed = Date.now() - at
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatDate(at: number): string {
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
