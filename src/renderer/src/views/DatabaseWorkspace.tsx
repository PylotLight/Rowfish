import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DatabaseBrowserDatabase,
  DatabaseBrowserTable,
  DatabaseConnectionInput,
  DatabaseConnectionSummary,
  DatabaseEvent,
  DatabaseRow,
  SavedConnectionProfile
} from '../../../shared/database'
import { DATABASE_LIMITS, getVirtualRowRange, quotePostgresIdentifier } from '../../../shared/database-helpers'

const ROW_HEIGHT = 36
const DEFAULT_FORM: DatabaseConnectionInput = {
  name: 'Local database',
  kind: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: '',
  tls: false,
  serverMode: false,
  connectionString: ''
}

type RunState = 'idle' | 'running' | 'cancelling'

function connectionSubline(connection: DatabaseConnectionSummary): string {
  if (connection.serverMode) return `PostgreSQL · ${connection.host}:${connection.port} · all databases`
  return `${connection.kind === 'postgres' ? 'PostgreSQL' : 'MongoDB'} · ${connection.database}`
}

export default function DatabaseWorkspace({ search }: { search: string }): React.JSX.Element {
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([])
  const [savedConnections, setSavedConnections] = useState<SavedConnectionProfile[]>([])
  const [activeId, setActiveId] = useState('')
  const [showConnect, setShowConnect] = useState(false)
  const [form, setForm] = useState<DatabaseConnectionInput>(DEFAULT_FORM)
  const [saveProfile, setSaveProfile] = useState(true)
  const [mongoUriMode, setMongoUriMode] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [queryText, setQueryText] = useState('')
  const [collection, setCollection] = useState('documents')
  const [maxRows, setMaxRows] = useState(1_000)
  const [runState, setRunState] = useState<RunState>('idle')
  const [rows, setRows] = useState<DatabaseRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [queryError, setQueryError] = useState('')
  const [querySummary, setQuerySummary] = useState('No query run.')
  const [serverDatabases, setServerDatabases] = useState<Record<string, DatabaseBrowserDatabase[]>>({})
  const [tableLists, setTableLists] = useState<Record<string, DatabaseBrowserTable[]>>({})
  const [browserLoading, setBrowserLoading] = useState<Record<string, boolean>>({})
  const [browserErrors, setBrowserErrors] = useState<Record<string, string>>({})
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

  async function refreshSavedConnections(): Promise<void> {
    setSavedConnections(await window.api.database.saved())
  }

  async function inspectConnection(connection: DatabaseConnectionSummary): Promise<void> {
    if (connection.kind !== 'postgres') return
    setBrowserLoading((current) => ({ ...current, [connection.id]: true }))
    setBrowserErrors((current) => ({ ...current, [connection.id]: '' }))
    try {
      if (connection.serverMode) {
        const databases = await window.api.database.listDatabases(connection.id)
        setServerDatabases((current) => ({ ...current, [connection.id]: databases }))
      } else {
        const tables = await window.api.database.listTables(connection.id)
        setTableLists((current) => ({ ...current, [connection.id]: tables }))
      }
    } catch (error) {
      setBrowserErrors((current) => ({ ...current, [connection.id]: error instanceof Error ? error.message : 'Could not load the PostgreSQL browser.' }))
    } finally {
      setBrowserLoading((current) => ({ ...current, [connection.id]: false }))
    }
  }

  useEffect(() => {
    void refreshSavedConnections().catch((error: unknown) => {
      setConnectionError(error instanceof Error ? error.message : 'Could not load saved connections.')
    })
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.database.onEvent((event) => {
      if (event.type === 'connection:closed') {
        setConnections((current) => current.filter((connection) => connection.id !== event.connectionId && connection.parentConnectionId !== event.connectionId))
        setActiveId((current) => current === event.connectionId ? '' : current)
        setTableLists((current) => {
          const next = { ...current }
          delete next[event.connectionId]
          return next
        })
        setServerDatabases((current) => {
          const next = { ...current }
          delete next[event.connectionId]
          return next
        })
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
      setQueryText('')
      setCollection('documents')
    } else if (activeConnection?.kind === 'postgres') {
      setQueryText('')
    }
    setRows([])
    setColumns([])
    setQueryError('')
    setQuerySummary(activeConnection ? `${activeConnection.kind === 'postgres' ? 'PostgreSQL' : 'MongoDB'} · ${activeConnection.serverMode ? 'server browser' : activeConnection.database}` : 'No query run.')
    if (scrollElement.current) scrollElement.current.scrollTop = 0
  }, [activeConnection?.id, activeConnection?.kind, activeConnection?.database, activeConnection?.serverMode])

  useEffect(() => {
    const element = scrollElement.current
    if (!element) return
    const update = (): void => setViewport({ top: element.scrollTop, height: element.clientHeight || 480 })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [columns.length > 0])

  function addConnectedConnection(connection: DatabaseConnectionSummary): void {
    setConnections((current) => {
      const withoutDuplicate = current.filter((item) => !(item.id === connection.id || (connection.parentConnectionId && item.parentConnectionId === connection.parentConnectionId && item.database === connection.database)))
      return [...withoutDuplicate, connection]
    })
    setActiveId(connection.id)
    if (connection.kind === 'postgres') void inspectConnection(connection)
  }

  async function connect(): Promise<void> {
    setConnecting(true)
    setConnectionError('')
    try {
      const input = { ...form, database: form.serverMode ? '' : form.database }
      const connected = await window.api.database.connect(input, saveProfile)
      addConnectedConnection(connected)
      if (saveProfile) await refreshSavedConnections()
      setForm(DEFAULT_FORM)
      setSaveProfile(true)
      setShowConnect(false)
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not connect to the database.')
    } finally {
      setConnecting(false)
    }
  }

  async function connectSaved(profile: SavedConnectionProfile): Promise<void> {
    setConnectionError('')
    const existing = connections.find((connection) => connection.savedConnectionId === profile.id && !connection.parentConnectionId)
    if (existing) {
      setActiveId(existing.id)
      return
    }
    setBrowserLoading((current) => ({ ...current, [`saved:${profile.id}`]: true }))
    try {
      const connected = await window.api.database.connectSaved(profile.id)
      addConnectedConnection(connected)
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : `Could not connect to ${profile.name}.`)
    } finally {
      setBrowserLoading((current) => ({ ...current, [`saved:${profile.id}`]: false }))
    }
  }

  async function deleteSaved(profile: SavedConnectionProfile): Promise<void> {
    try {
      await window.api.database.deleteSaved(profile.id)
      setSavedConnections((current) => current.filter((item) => item.id !== profile.id))
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not remove the saved connection.')
    }
  }

  async function openDatabase(server: DatabaseConnectionSummary, database: DatabaseBrowserDatabase): Promise<void> {
    if (!database.canConnect || browserLoading[`${server.id}:${database.name}`]) return
    const loadingKey = `${server.id}:${database.name}`
    setBrowserLoading((current) => ({ ...current, [loadingKey]: true }))
    setBrowserErrors((current) => ({ ...current, [loadingKey]: '' }))
    try {
      const connected = await window.api.database.openDatabase(server.id, database.name)
      setConnections((current) => [...current.filter((item) => item.id !== connected.id && !(item.parentConnectionId === connected.parentConnectionId && item.database === connected.database)), connected])
      setActiveId(connected.id)
      await inspectConnection(connected)
    } catch (error) {
      setBrowserErrors((current) => ({ ...current, [loadingKey]: error instanceof Error ? error.message : `Could not open ${database.name}.` }))
    } finally {
      setBrowserLoading((current) => ({ ...current, [loadingKey]: false }))
    }
  }

  async function runQuery(): Promise<void> {
    if (!activeConnection || activeConnection.serverMode || runState !== 'idle' || !queryText.trim()) return
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
      setConnections((current) => current.filter((item) => item.id !== connection.id && item.parentConnectionId !== connection.id))
      if (activeId === connection.id || connections.some((item) => item.id === activeId && item.parentConnectionId === connection.id)) setActiveId('')
      setTableLists((current) => {
        const next = { ...current }
        delete next[connection.id]
        for (const item of connections) if (item.parentConnectionId === connection.id) delete next[item.id]
        return next
      })
      setServerDatabases((current) => {
        const next = { ...current }
        delete next[connection.id]
        return next
      })
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : 'Could not close the connection.')
    }
  }

  function selectTable(connection: DatabaseConnectionSummary, table: DatabaseBrowserTable): void {
    setActiveId(connection.id)
    setQueryText(`SELECT * FROM ${quotePostgresIdentifier(table.schema)}.${quotePostgresIdentifier(table.name)} LIMIT 100;`)
  }

  function updateForm<K extends keyof DatabaseConnectionInput>(key: K, value: DatabaseConnectionInput[K]): void {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function renderTables(connection: DatabaseConnectionSummary): React.JSX.Element {
    const tables = tableLists[connection.id] ?? []
    const grouped = tables.reduce<Record<string, DatabaseBrowserTable[]>>((groups, table) => {
      ;(groups[table.schema] ??= []).push(table)
      return groups
    }, {})
    return (
      <div className="db-browser-objects">
        {browserLoading[connection.id] && <div className="db-browser-hint"><span className="db-spinner small" /> Loading tables…</div>}
        {browserErrors[connection.id] && <div className="db-browser-error">{browserErrors[connection.id]}</div>}
        {Object.entries(grouped).map(([schema, schemaTables]) => (
          <div className="db-browser-schema" key={`${connection.id}:${schema}`}>
            <div className="db-browser-schema-name">{schema}</div>
            {schemaTables.map((table) => (
              <button className={`db-browser-object${activeId === connection.id ? ' active' : ''}`} key={`${table.schema}.${table.name}`} title={`${table.kind}: ${table.schema}.${table.name}`} onClick={() => selectTable(connection, table)}>
                <span aria-hidden="true">▤</span><span>{table.name}</span>
              </button>
            ))}
          </div>
        ))}
        {!browserLoading[connection.id] && !browserErrors[connection.id] && tables.length === 0 && <div className="db-browser-hint">No tables or views found.</div>}
      </div>
    )
  }

  return (
    <section className="db-workspace">
      <aside className="db-rail">
        <div className="db-rail-heading">
          <div><span className="db-overline">CONNECTIONS</span><h2>Connections</h2></div>
          <button className="db-icon-button" aria-label="Add connection" title="Add connection" onClick={() => { setShowConnect(true); setConnectionError('') }}>＋</button>
        </div>
        <button className="db-connect-button" onClick={() => { setShowConnect(true); setConnectionError('') }}><span>＋</span> New connection</button>
        <div className="db-connection-list" aria-label="Database server browser">
          {connections.filter((connection) => !connection.parentConnectionId).map((connection) => (
            <div className="db-browser-server" key={connection.id}>
              <div className={`db-connection${activeId === connection.id ? ' selected' : ''}`}>
                <button className="db-connection-select" onClick={() => setActiveId(connection.id)}>
                  <span className={`db-engine-mark ${connection.kind}`} aria-hidden="true">{connection.kind === 'postgres' ? 'P' : 'M'}</span>
                  <span className="db-connection-copy"><b>{connection.name}</b><small>{connectionSubline(connection)}</small></span>
                  <span className="db-live-dot" aria-label="Connected" />
                </button>
                <button className="db-disconnect" title={`Disconnect ${connection.name}`} aria-label={`Disconnect ${connection.name}`} onClick={() => void disconnect(connection)}>×</button>
              </div>
              {connection.kind === 'postgres' && connection.serverMode && (
                <div className="db-browser-objects db-browser-databases">
                  <div className="db-browser-section-title">SERVER BROWSER</div>
                  {browserLoading[connection.id] && <div className="db-browser-hint"><span className="db-spinner small" /> Loading databases…</div>}
                  {browserErrors[connection.id] && <div className="db-browser-error">{browserErrors[connection.id]}</div>}
                  {(serverDatabases[connection.id] ?? []).map((database) => {
                    const child = connections.find((item) => item.parentConnectionId === connection.id && item.database === database.name)
                    const loadingKey = `${connection.id}:${database.name}`
                    return (
                      <div className="db-browser-database-group" key={database.name}>
                        <button className="db-browser-database" disabled={!database.canConnect || browserLoading[loadingKey]} title={database.canConnect ? `Open ${database.name}` : `No CONNECT permission for ${database.name}`} onClick={() => void openDatabase(connection, database)}>
                          <span aria-hidden="true">{child ? '▾' : '›'}</span><span>{database.name}</span>{browserLoading[loadingKey] && <span className="db-spinner small" />}
                        </button>
                        {child && <button className="db-child-close" title={`Close ${database.name} session`} aria-label={`Close ${database.name} session`} onClick={() => void disconnect(child)}>×</button>}
                        {!database.canConnect && <div className="db-browser-hint db-browser-indent">No CONNECT permission</div>}
                        {child && renderTables(child)}
                        {browserErrors[loadingKey] && <div className="db-browser-error db-browser-indent">{browserErrors[loadingKey]}</div>}
                      </div>
                    )
                  })}
                  {!browserLoading[connection.id] && serverDatabases[connection.id]?.length === 0 && <div className="db-browser-hint">No databases were returned.</div>}
                </div>
              )}
              {connection.kind === 'postgres' && !connection.serverMode && renderTables(connection)}
            </div>
          ))}
          {connections.length === 0 && <div className="db-empty-rail"><b>No connections</b><p>Add a PostgreSQL or MongoDB connection.</p></div>}
          {savedConnections.length > 0 && (
            <div className="db-saved-connections">
              <div className="db-browser-section-title">SAVED SERVERS</div>
              {savedConnections.map((profile) => {
                const active = connections.some((connection) => connection.savedConnectionId === profile.id && !connection.parentConnectionId)
                const loading = browserLoading[`saved:${profile.id}`]
                return (
                  <div className={`db-saved-profile${active ? ' active' : ''}`} key={profile.id}>
                    <button className="db-saved-connect" disabled={loading} onClick={() => void connectSaved(profile)}>
                      <span className={`db-engine-mark ${profile.kind}`} aria-hidden="true">{profile.kind === 'postgres' ? 'P' : 'M'}</span>
                      <span className="db-connection-copy"><b>{profile.name}</b><small>{profile.serverMode ? `${profile.host}:${profile.port} · all databases` : `${profile.kind === 'postgres' ? 'PostgreSQL' : 'MongoDB'} · ${profile.database}`}</small></span>
                      {loading && <span className="db-spinner small" />}
                    </button>
                    <button className="db-disconnect db-delete-saved" title={`Forget ${profile.name}`} aria-label={`Forget ${profile.name}`} onClick={() => void deleteSaved(profile)}>×</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {connectionError && <div className="db-query-error db-rail-error" role="alert">{connectionError}</div>}
        <div className="db-rail-footer"><span className="db-security-mark">⌑</span><span>Saved passwords are encrypted by your operating system.</span></div>
      </aside>

      <div className="db-main">
        <div className="db-workspace-header">
          <div>
            <span className="db-overline">{activeConnection?.serverMode ? 'SERVER BROWSER' : 'QUERY WORKSPACE'}</span>
            <h1>{activeConnection?.name ?? 'No connection selected'}</h1>
            <p>{activeConnection ? `${activeConnection.kind === 'postgres' ? 'PostgreSQL' : 'MongoDB'} · ${activeConnection.host}:${activeConnection.port} · ${activeConnection.serverMode ? 'browse databases available to this user' : activeConnection.database}` : 'Connect a database to run queries.'}</p>
          </div>
          {activeConnection && <button className="db-quiet-button" onClick={() => void disconnect(activeConnection)}>Disconnect</button>}
        </div>

        {activeConnection?.serverMode ? (
          <div className="db-empty-workspace db-server-welcome">
            <span className="db-results-glyph">▦</span><b>Choose a database to browse its tables</b>
            <p>Rowfish shows databases this PostgreSQL user can connect to. It does not grant access the user does not already have.</p>
          </div>
        ) : activeConnection ? (
          <>
            <div className="db-editor-card">
              <div className="db-editor-topline">
                <div className="db-editor-tabs"><span className="db-editor-tab active">{activeConnection.kind === 'postgres' ? 'SQL query' : 'Find filter'}</span><span className="db-editor-language">{activeConnection.kind === 'postgres' ? 'POSTGRESQL' : 'MONGODB JSON'}</span></div>
                <div className="db-editor-controls">
                  {activeConnection.kind === 'mongodb' && <label className="db-collection-field"><span>Collection</span><input value={collection} onChange={(event) => setCollection(event.target.value)} aria-label="MongoDB collection name" maxLength={128} /></label>}
                  <label className="db-limit-field"><span>Max rows</span><select value={maxRows} onChange={(event) => setMaxRows(Number(event.target.value))}><option value={500}>500</option><option value={1000}>1,000</option><option value={5000}>5,000</option><option value={10000}>10,000</option></select></label>
                  {runState === 'idle' ? <button className="db-run-button" onClick={() => void runQuery()} disabled={!queryText.trim()}><span>▶</span> Run query</button> : <button className="db-cancel-button" onClick={() => void cancelQuery()} disabled={runState === 'cancelling'}>{runState === 'cancelling' ? 'Cancelling…' : '■ Cancel'}</button>}
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
                {runState !== 'idle' ? <><span className="db-spinner" /><b>Query running</b></> : queryError ? <><b>Query stopped</b><p>Check the error above.</p></> : <><span className="db-results-glyph">▤</span><b>No results</b><p>Run a query to view rows.</p></>}
              </div>}
              {columns.length > 0 && <div className="db-grid-footer"><span>{rows.length.toLocaleString()} rows</span><span>Search with the top-bar field</span></div>}
            </div>
          </>
        ) : (
          <div className="db-empty-workspace">
            <button className="db-run-button" onClick={() => { setShowConnect(true); setConnectionError('') }}>＋ Connect database</button>
          </div>
        )}
      </div>

      {showConnect && (
        <div className="db-modal-backdrop" onClick={() => { if (!connecting) { setShowConnect(false); setForm(DEFAULT_FORM); setConnectionError('') } }}>
          <div className="db-connect-modal" role="dialog" aria-modal="true" aria-labelledby="db-connect-title" onClick={(event) => event.stopPropagation()}>
            <div className="db-modal-head"><div><span className="db-overline">NEW DATA SOURCE</span><h2 id="db-connect-title">Connect a database</h2></div><button className="db-icon-button" aria-label="Close" disabled={connecting} onClick={() => { setShowConnect(false); setForm(DEFAULT_FORM); setConnectionError('') }}>×</button></div>
            <p className="db-modal-copy">Saved connection details stay on this computer. Passwords are encrypted with the operating system credential store.</p>
            <div className="db-form-grid">
              <label className="db-form-field full"><span>Connection name</span><input value={form.name} onChange={(event) => updateForm('name', event.target.value)} maxLength={80} autoFocus /></label>
              <label className="db-form-field"><span>Database type</span><select value={form.kind} onChange={(event) => { const kind = event.target.value as DatabaseConnectionInput['kind']; setMongoUriMode(false); setForm((current) => ({ ...current, kind, port: kind === 'postgres' ? 5432 : 27017, database: kind === 'postgres' ? 'postgres' : 'admin', serverMode: false, connectionString: '' })) }}><option value="postgres">PostgreSQL</option><option value="mongodb">MongoDB</option></select></label>
              {form.kind === 'mongodb' && <label className="db-tls-toggle db-uri-toggle"><input type="checkbox" checked={mongoUriMode} onChange={(event) => { setMongoUriMode(event.target.checked); setForm((current) => ({ ...current, connectionString: '' })) }} /><span><b>Connect with a connection string</b><small>Paste a mongodb:// or mongodb+srv:// URI</small></span></label>}
              {mongoUriMode ? (
                <label className="db-form-field full"><span>MongoDB connection string</span><input type="password" value={form.connectionString ?? ''} onChange={(event) => updateForm('connectionString', event.target.value)} placeholder="mongodb+srv://user:password@cluster.example/database" autoComplete="off" /></label>
              ) : <>
                <label className="db-form-field"><span>Host</span><input value={form.host} onChange={(event) => updateForm('host', event.target.value)} placeholder="localhost" autoComplete="off" /></label>
                <label className="db-form-field"><span>Port</span><input type="number" min={1} max={65535} value={form.port} onChange={(event) => updateForm('port', Number(event.target.value))} /></label>
                {form.kind === 'postgres' && <label className="db-form-field"><span>Database {form.serverMode && <small>not required for server browser</small>}</span><input value={form.serverMode ? '' : form.database} onChange={(event) => updateForm('database', event.target.value)} placeholder={form.serverMode ? 'Browse all accessible databases' : 'Database name'} disabled={form.serverMode} autoComplete="off" /></label>}
                {form.kind === 'mongodb' && <label className="db-form-field"><span>Database</span><input value={form.database} onChange={(event) => updateForm('database', event.target.value)} autoComplete="off" /></label>}
                {!mongoUriMode && <label className="db-form-field"><span>Username <small>optional</small></span><input value={form.username} onChange={(event) => updateForm('username', event.target.value)} autoComplete="username" /></label>}
                {!mongoUriMode && <label className="db-form-field"><span>Password <small>optional</small></span><input type="password" value={form.password} onChange={(event) => updateForm('password', event.target.value)} autoComplete="new-password" /></label>}
              </>}
            </div>
            {form.kind === 'postgres' && <label className="db-tls-toggle"><input type="checkbox" checked={form.serverMode} onChange={(event) => updateForm('serverMode', event.target.checked)} /><span><b>Browse all databases on this server</b><small>Uses the postgres maintenance database and lists databases this user can connect to. It does not grant additional access.</small></span></label>}
            {!mongoUriMode && <label className="db-tls-toggle"><input type="checkbox" checked={form.tls} onChange={(event) => updateForm('tls', event.target.checked)} /><span><b>Require TLS</b><small>Verify the server certificate</small></span></label>}
            <label className="db-tls-toggle"><input type="checkbox" checked={saveProfile} onChange={(event) => setSaveProfile(event.target.checked)} /><span><b>Save this connection</b><small>Keep it available between app sessions</small></span></label>
            {connectionError && <div className="db-query-error" role="alert">{connectionError}</div>}
            <div className="db-modal-actions"><button className="db-quiet-button" disabled={connecting} onClick={() => { setShowConnect(false); setForm(DEFAULT_FORM); setConnectionError('') }}>Cancel</button><button className="db-run-button" disabled={connecting} onClick={() => void connect()}>{connecting ? <><span className="db-spinner small" /> Connecting…</> : 'Connect'}</button></div>
          </div>
        </div>
      )}
    </section>
  )
}
