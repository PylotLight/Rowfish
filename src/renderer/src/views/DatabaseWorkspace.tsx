import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseEvent,
  DatabaseRow
} from '../../../shared/database'
import { DATABASE_LIMITS, getVirtualRowRange } from '../../../shared/database-helpers'

const ROW_HEIGHT = 36
const DEFAULT_FORM: DatabaseConnectionInput = {
  name: 'Local database',
  kind: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: '',
  tls: false
}

type RunState = 'idle' | 'running' | 'cancelling'

export default function DatabaseWorkspace({ search }: { search: string }): React.JSX.Element {
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([])
  const [activeId, setActiveId] = useState('')
  const [showConnect, setShowConnect] = useState(false)
  const [form, setForm] = useState<DatabaseConnectionInput>(DEFAULT_FORM)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [queryText, setQueryText] = useState('SELECT now() AS server_time;')
  const [collection, setCollection] = useState('documents')
  const [maxRows, setMaxRows] = useState(1_000)
  const [runState, setRunState] = useState<RunState>('idle')
  const [rows, setRows] = useState<DatabaseRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [queryError, setQueryError] = useState('')
  const [querySummary, setQuerySummary] = useState('Connect to a database to begin.')
  const [viewport, setViewport] = useState({ top: 0, height: 480 })
  const scrollElement = useRef<HTMLDivElement>(null)
  const activeQuery = useRef<{ id: string; connectionId: string } | null>(null)
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase())
  const deferredRows = useDeferredValue(rows)

  const activeConnection = connections.find((connection) => connection.id === activeId) ?? null
  const visibleRows = useMemo(() => {
    if (!deferredSearch) return deferredRows
    return deferredRows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLocaleLowerCase().includes(deferredSearch)))
  }, [deferredRows, deferredSearch])
  const { start: firstVisible, end: lastVisible } = getVirtualRowRange(visibleRows.length, viewport.top, viewport.height, ROW_HEIGHT)
  const windowedRows = visibleRows.slice(firstVisible, lastVisible)
  const deferredQuery = runState !== 'idle'

  useEffect(() => {
    const unsubscribe = window.api.database.onEvent((event) => {
      if (event.type === 'connection:closed') {
        setConnections((current) => current.filter((connection) => connection.id !== event.connectionId))
        setActiveId((current) => current === event.connectionId ? '' : current)
        if (activeQuery.current?.connectionId === event.connectionId) {
          activeQuery.current = null
          setRunState('idle')
        }
        if (event.message) setQuerySummary(event.message)
        return
      }

      if (event.type === 'query:cancelled') {
        if (activeQuery.current?.id !== event.queryId) return
        activeQuery.current = null
        setRunState('idle')
        setQuerySummary('Query cancelled. The connection was closed to stop server-side work.')
        return
      }

      if (activeQuery.current?.id !== event.queryId) return
      if (event.type === 'query:rows') {
        startTransition(() => {
          setRows((current) => current.length >= DATABASE_LIMITS.maxRows ? current : [...current, ...event.rows].slice(0, DATABASE_LIMITS.maxRows))
          setColumns((current) => [...new Set([...current, ...event.columns])].slice(0, DATABASE_LIMITS.maxColumns))
        })
        return
      }
      if (event.type === 'query:complete') {
        activeQuery.current = null
        setRunState('idle')
        setQueryError('')
        setQuerySummary(`${event.receivedRows.toLocaleString()} rows · ${(event.elapsedMs / 1_000).toFixed(2)} s${event.truncated ? ' · result capped (row or 16 MB limit)' : ''}`)
        return
      }
      if (event.type === 'query:error') {
        activeQuery.current = null
        setRunState('idle')
        setQueryError(event.message)
        setQuerySummary('Query failed.')
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (activeConnection?.kind === 'mongodb') {
      setQueryText('{}')
      setCollection('documents')
    } else if (activeConnection?.kind === 'postgres') {
      setQueryText('SELECT now() AS server_time;')
    }
    setRows([])
    setColumns([])
    setQueryError('')
    setQuerySummary(activeConnection ? `${activeConnection.kind === 'postgres' ? 'PostgreSQL' : 'MongoDB'} · ${activeConnection.database}` : 'Connect to a database to begin.')
    if (scrollElement.current) scrollElement.current.scrollTop = 0
  }, [activeConnection?.id, activeConnection?.kind, activeConnection?.database])

  useEffect(() => {
    const element = scrollElement.current
    if (!element) return
    const update = (): void => setViewport({ top: element.scrollTop, height: element.clientHeight || 480 })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [columns.length > 0])

  async function connect(): Promise<void> {
    setConnecting(true)
    setConnectionError('')
    try {
      const connected = await window.api.database.connect(form)
      setConnections((current) => [...current.filter((item) => item.id !== connected.id), connected])
      setActiveId(connected.id)
      setForm(DEFAULT_FORM)
      setShowConnect(false)
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not connect to the database.')
    } finally {
      setConnecting(false)
    }
  }

  async function runQuery(): Promise<void> {
    if (!activeConnection || runState !== 'idle') return
    const queryId = window.crypto.randomUUID()
    activeQuery.current = { id: queryId, connectionId: activeConnection.id }
    setRows([])
    setColumns([])
    setQueryError('')
    setQuerySummary('Starting query…')
    setRunState('running')
    if (scrollElement.current) scrollElement.current.scrollTop = 0
    try {
      await window.api.database.run({
        connectionId: activeConnection.id,
        queryId,
        query: queryText,
        maxRows,
        ...(activeConnection.kind === 'mongodb' ? { collection } : {})
      })
    } catch (error) {
      if (activeQuery.current?.id === queryId) activeQuery.current = null
      setRunState('idle')
      setQueryError(error instanceof Error ? error.message : 'Could not start the query.')
      setQuerySummary('Query was not started.')
    }
  }

  async function cancelQuery(): Promise<void> {
    const current = activeQuery.current
    if (!current) return
    setRunState('cancelling')
    try {
      await window.api.database.cancel(current.connectionId, current.id)
    } catch (error) {
      setRunState('idle')
      setQueryError(error instanceof Error ? error.message : 'Could not cancel the query.')
    }
  }

  async function disconnect(connection: DatabaseConnectionSummary): Promise<void> {
    try {
      await window.api.database.disconnect(connection.id)
      setConnections((current) => current.filter((item) => item.id !== connection.id))
      if (activeId === connection.id) setActiveId('')
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : 'Could not close the connection.')
    }
  }

  function updateForm<K extends keyof DatabaseConnectionInput>(key: K, value: DatabaseConnectionInput[K]): void {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <section className="db-workspace">
      <aside className="db-rail">
        <div className="db-rail-heading">
          <div><span className="db-overline">CONNECTIONS</span><h2>Data sources</h2></div>
          <button className="db-icon-button" aria-label="Add connection" title="Add connection" onClick={() => { setShowConnect(true); setConnectionError('') }}>＋</button>
        </div>
        <button className="db-connect-button" onClick={() => { setShowConnect(true); setConnectionError('') }}><span>＋</span> New connection</button>
        <div className="db-connection-list" aria-label="Connected databases">
          {connections.map((connection) => (
            <div key={connection.id} className={`db-connection${activeId === connection.id ? ' selected' : ''}`}>
              <button className="db-connection-select" onClick={() => setActiveId(connection.id)}>
                <span className={`db-engine-mark ${connection.kind}`} aria-hidden="true">{connection.kind === 'postgres' ? 'P' : 'M'}</span>
                <span className="db-connection-copy"><b>{connection.name}</b><small>{connection.kind === 'postgres' ? 'PostgreSQL' : 'MongoDB'} · {connection.database}</small></span>
                <span className="db-live-dot" aria-label="Connected" />
              </button>
              <button className="db-disconnect" title={`Disconnect ${connection.name}`} aria-label={`Disconnect ${connection.name}`} onClick={() => void disconnect(connection)}>×</button>
            </div>
          ))}
          {connections.length === 0 && <div className="db-empty-rail"><span className="db-empty-symbol">◌</span><b>No connections yet</b><p>Add a PostgreSQL or MongoDB server to get started.</p></div>}
        </div>
        <div className="db-rail-footer"><span className="db-security-mark">⌑</span><span>Credentials stay in memory<br />and are never saved to disk.</span></div>
      </aside>

      <div className="db-main">
        <div className="db-workspace-header">
          <div>
            <span className="db-overline">QUERY WORKSPACE</span>
            <h1>{activeConnection?.name ?? 'Connect to your data'}</h1>
            <p>{activeConnection ? `${activeConnection.kind === 'postgres' ? 'PostgreSQL' : 'MongoDB'} · ${activeConnection.host}:${activeConnection.port} · ${activeConnection.database}` : 'Run queries in an isolated worker with bounded results.'}</p>
          </div>
          {activeConnection && <button className="db-quiet-button" onClick={() => void disconnect(activeConnection)}>Disconnect</button>}
        </div>

        {activeConnection ? (
          <>
            <div className="db-editor-card">
              <div className="db-editor-topline">
                <div className="db-editor-tabs"><span className="db-editor-tab active">{activeConnection.kind === 'postgres' ? 'SQL query' : 'Find filter'}</span><span className="db-editor-language">{activeConnection.kind === 'postgres' ? 'POSTGRESQL' : 'MONGODB JSON'}</span></div>
                <div className="db-editor-controls">
                  {activeConnection.kind === 'mongodb' && <label className="db-collection-field"><span>Collection</span><input value={collection} onChange={(event) => setCollection(event.target.value)} aria-label="MongoDB collection name" maxLength={128} /></label>}
                  <label className="db-limit-field"><span>Max rows</span><select value={maxRows} onChange={(event) => setMaxRows(Number(event.target.value))}><option value={500}>500</option><option value={1000}>1,000</option><option value={5000}>5,000</option><option value={10000}>10,000</option></select></label>
                  {runState === 'idle' ? <button className="db-run-button" onClick={() => void runQuery()}><span>▶</span> Run query</button> : <button className="db-cancel-button" onClick={() => void cancelQuery()} disabled={runState === 'cancelling'}>{runState === 'cancelling' ? 'Cancelling…' : '■ Cancel'}</button>}
                </div>
              </div>
              <label className="db-query-label" htmlFor="db-query-editor">{activeConnection.kind === 'postgres' ? 'SQL' : 'Filter document'}</label>
              <textarea
                id="db-query-editor"
                className="db-query-editor"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void runQuery() } }}
                spellCheck={false}
                aria-label={activeConnection.kind === 'postgres' ? 'SQL query editor' : 'MongoDB JSON filter editor'}
                placeholder={activeConnection.kind === 'postgres' ? 'SELECT * FROM your_table LIMIT 100;' : '{"status":"active"}'}
              />
              <div className="db-editor-footer"><span>{activeConnection.kind === 'postgres' ? '⌘ Enter to run · statement timeout 120 seconds' : '⌘ Enter to run · $where is disabled · maxTimeMS 120 seconds'}</span><span>Results capped at {maxRows.toLocaleString()} rows / 16 MB</span></div>
            </div>

            <div className="db-results-card">
              <div className="db-results-header">
                <div><span className="db-overline">RESULTS</span><p className="db-results-summary" aria-live="polite">{runState !== 'idle' ? `${runState === 'cancelling' ? 'Cancelling query' : 'Query running'} · ${rows.length.toLocaleString()} rows received` : querySummary}</p></div>
                <span className="db-row-count">{visibleRows.length.toLocaleString()}{deferredSearch ? ` / ${rows.length.toLocaleString()}` : ''} rows</span>
              </div>
              {queryError && <div className="db-query-error" role="alert">{queryError}</div>}
              {deferredQuery && <div className="db-progress-track"><span /></div>}
              {columns.length > 0 ? (
                <div className="db-table-scroll" ref={scrollElement} onScroll={(event) => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
                  <table className="db-result-table">
                    <thead><tr><th className="db-row-index-head">#</th>{columns.map((column) => <th key={column} title={column}>{column}</th>)}</tr></thead>
                    <tbody>
                      {firstVisible > 0 && <tr aria-hidden="true" className="db-spacer-row"><td colSpan={columns.length + 1} style={{ height: firstVisible * ROW_HEIGHT }} /></tr>}
                      {windowedRows.map((row, offset) => {
                        const index = firstVisible + offset
                        return <tr key={index}><td className="db-row-index">{index + 1}</td>{columns.map((column) => <td key={column} title={String(row[column] ?? '')}>{String(row[column] ?? 'NULL')}</td>)}</tr>
                      })}
                      {lastVisible < visibleRows.length && <tr aria-hidden="true" className="db-spacer-row"><td colSpan={columns.length + 1} style={{ height: (visibleRows.length - lastVisible) * ROW_HEIGHT }} /></tr>}
                    </tbody>
                  </table>
                </div>
              ) : <div className={`db-results-empty${runState !== 'idle' ? ' loading' : ''}`}>
                {runState !== 'idle' ? <><span className="db-spinner" /><b>Query is running in the background</b><p>You can keep using the rest of the app while rows stream in.</p></> : queryError ? <><b>Query stopped</b><p>Check the message above, then adjust your query and try again.</p></> : <><span className="db-results-glyph">▤</span><b>No results yet</b><p>Run a query to stream a bounded result set into this grid.</p></>}
              </div>}
              {columns.length > 0 && <div className="db-grid-footer"><span>Virtualized grid · {rows.length.toLocaleString()} rows held in memory</span><span>Search results with the top-bar field</span></div>}
            </div>
          </>
        ) : (
          <div className="db-welcome-card">
            <div className="db-welcome-art"><span className="db-welcome-ring ring-one" /><span className="db-welcome-ring ring-two" /><span className="db-welcome-core">r</span></div>
            <span className="db-overline">POSTGRESQL + MONGODB</span>
            <h2>Connect, query, stay responsive.</h2>
            <p>Database work runs outside the UI thread. Results stream in small batches, stay within a memory budget, and render only the rows you can see.</p>
            <button className="db-run-button welcome-button" onClick={() => { setShowConnect(true); setConnectionError('') }}>＋ Add a connection</button>
            <div className="db-safety-points"><span>Worker-isolated</span><span>Cancel any query</span><span>Credentials not persisted</span></div>
          </div>
        )}
      </div>

      {showConnect && (
        <div className="db-modal-backdrop" onClick={() => { if (!connecting) { setShowConnect(false); setForm(DEFAULT_FORM); setConnectionError('') } }}>
          <div className="db-connect-modal" role="dialog" aria-modal="true" aria-labelledby="db-connect-title" onClick={(event) => event.stopPropagation()}>
            <div className="db-modal-head"><div><span className="db-overline">NEW DATA SOURCE</span><h2 id="db-connect-title">Connect a database</h2></div><button className="db-icon-button" aria-label="Close" disabled={connecting} onClick={() => { setShowConnect(false); setForm(DEFAULT_FORM); setConnectionError('') }}>×</button></div>
            <p className="db-modal-copy">Connection details are used in memory for this session only. They are not saved to disk.</p>
            <div className="db-form-grid">
              <label className="db-form-field full"><span>Connection name</span><input value={form.name} onChange={(event) => updateForm('name', event.target.value)} maxLength={80} autoFocus /></label>
              <label className="db-form-field"><span>Database type</span><select value={form.kind} onChange={(event) => { const kind = event.target.value as DatabaseConnectionInput['kind']; setForm((current) => ({ ...current, kind, port: kind === 'postgres' ? 5432 : 27017, database: kind === 'postgres' ? 'postgres' : 'admin' })) }}><option value="postgres">PostgreSQL</option><option value="mongodb">MongoDB</option></select></label>
              <label className="db-form-field"><span>Host</span><input value={form.host} onChange={(event) => updateForm('host', event.target.value)} placeholder="localhost" autoComplete="off" /></label>
              <label className="db-form-field"><span>Port</span><input type="number" min={1} max={65535} value={form.port} onChange={(event) => updateForm('port', Number(event.target.value))} /></label>
              <label className="db-form-field"><span>Database</span><input value={form.database} onChange={(event) => updateForm('database', event.target.value)} autoComplete="off" /></label>
              <label className="db-form-field"><span>Username <small>optional</small></span><input value={form.username} onChange={(event) => updateForm('username', event.target.value)} autoComplete="username" /></label>
              <label className="db-form-field"><span>Password <small>optional</small></span><input type="password" value={form.password} onChange={(event) => updateForm('password', event.target.value)} autoComplete="new-password" /></label>
            </div>
            <label className="db-tls-toggle"><input type="checkbox" checked={form.tls} onChange={(event) => updateForm('tls', event.target.checked)} /><span><b>Require TLS</b><small>Verify the server certificate</small></span></label>
            {connectionError && <div className="db-query-error" role="alert">{connectionError}</div>}
            <div className="db-modal-actions"><button className="db-quiet-button" disabled={connecting} onClick={() => { setShowConnect(false); setForm(DEFAULT_FORM); setConnectionError('') }}>Cancel</button><button className="db-run-button" disabled={connecting} onClick={() => void connect()}>{connecting ? <><span className="db-spinner small" /> Connecting…</> : 'Connect'}</button></div>
          </div>
        </div>
      )}
    </section>
  )
}
