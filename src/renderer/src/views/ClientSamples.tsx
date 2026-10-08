import { useState } from 'react'
import { makeCapture, type CaptureNote } from '../../../shared/demo'

const STARTER_NOTES: CaptureNote[] = [
  { id: 'note-1', title: 'Mac release checklist', body: 'Test a signed build\nVerify arm64 and x64 packages\nCheck first-launch permissions', createdAt: Date.now() - 60_000 },
  { id: 'note-2', title: 'Ideas for the sidebar', body: 'Keep navigation calm and scannable. Make the current section obvious.', createdAt: Date.now() - 3_600_000 },
  { id: 'note-3', title: 'Follow up with design', body: 'Share the updated glass treatment and ask for feedback on contrast.', createdAt: Date.now() - 86_400_000 }
]

export default function ClientSamples({ query }: { query: string }): React.JSX.Element {
  return <CaptureSample query={query} />
}

function CaptureSample({ query }: { query: string }): React.JSX.Element {
  const [notes, setNotes] = useState(STARTER_NOTES)
  const [draft, setDraft] = useState('')
  const [selectedId, setSelectedId] = useState('note-1')
  const [notice, setNotice] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const visibleNotes = notes.filter((note) => `${note.title} ${note.body}`.toLocaleLowerCase().includes(needle))
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
