import { useEffect, useRef, useState } from 'react'
import { X, KeyRound, Save, RotateCcw, RefreshCw } from 'lucide-react'
import { getRowChanges, getSafeRowKey } from '../lib/row-editor'
import type {
  DatabaseRow,
  PostgresRowDetails,
  PostgresTableDetails
} from '../../../shared/database'

export interface RowSource {
  connectionId: string
  schema: string
  table: string
  details: PostgresTableDetails
}

export default function RowSidePanel({
  row,
  source,
  onClose,
  onSaved,
  onDirtyChange,
  onBusyChange
}: {
  row: DatabaseRow
  source: RowSource | null
  onClose: () => void
  onSaved: (row: DatabaseRow) => void
  onDirtyChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const [details, setDetails] = useState<PostgresRowDetails | null>(null)
  const [draft, setDraft] = useState<DatabaseRow>({})
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef(0)
  const closeButton = useRef<HTMLButtonElement>(null)
  const columns =
    details?.columns ??
    source?.details.columns ??
    Object.keys(row).map((name) => ({
      name,
      dataType: 'result value',
      nullable: true,
      defaultValue: null,
      isPrimaryKey: false
    }))
  const changes = details
    ? getRowChanges(details.row, draft, details.columns)
    : {}
  const dirty = Object.keys(changes).length > 0
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    onBusyChange(loading || saving)
  }, [loading, saving, onBusyChange])
  useEffect(() => {
    closeButton.current?.focus()
    return () => {
      onDirtyChange(false)
      onBusyChange(false)
    }
  }, [])
  useEffect(() => {
    const id = ++request.current
    setDetails(null)
    setDraft({})
    setError('')
    setNotice('')
    if (!source) return
    const primary = source.details.columns.filter(
      (column) => column.isPrimaryKey
    )
    if (
      !primary.length ||
      !['table', 'partitioned table'].includes(source.details.kind)
    )
      return
    let key: DatabaseRow
    try {
      key = getSafeRowKey(source.details, row)
    } catch (cause) {
      setError((cause as Error).message)
      return
    }
    setLoading(true)
    void window.api.database
      .getPostgresRow({
        connectionId: source.connectionId,
        schema: source.schema,
        table: source.table,
        key
      })
      .then((result) => {
        if (request.current !== id) return
        setDetails(result)
        setDraft(result.row)
      })
      .catch((cause) => {
        if (request.current === id)
          setError(
            cause instanceof Error ? cause.message : 'Could not load this row.'
          )
      })
      .finally(() => {
        if (request.current === id) setLoading(false)
      })
    return () => {
      request.current++
    }
  }, [row, source, reload])
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  async function save(): Promise<void> {
    if (!source || !details || !dirty || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await window.api.database.updatePostgresRow({
        connectionId: source.connectionId,
        schema: source.schema,
        table: source.table,
        key: details.key,
        version: details.version,
        changes
      })
      setDetails(result)
      setDraft(result.row)
      onDirtyChange(false)
      onSaved(result.row)
      setNotice('Changes saved to database.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save this row.'
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <aside
      className="row-side-panel"
      role="complementary"
      aria-label="Row details"
      aria-busy={loading || saving}
    >
      <header className="row-panel-header">
        <div>
          <h2>Row details</h2>
          <p>
            {source
              ? `${source.schema}.${source.table}`
              : 'Query result · read only'}
          </p>
        </div>
        <button
          ref={closeButton}
          className="db-icon-button"
          aria-label="Close row details"
          disabled={saving}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="row-panel-body">
        <p className="row-panel-hint">
          {loading
            ? 'Loading full row and schema…'
            : details
              ? 'Edit values below, then save. Primary keys and generated fields are read only.'
              : source
                ? 'Read only: editing requires a table with a primary key and supported column types.'
                : 'Read only: run the unmodified SELECT from a table in the explorer to edit safely.'}
        </p>
        {error && (
          <div className="db-query-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="row-panel-success" role="status">
            {notice}
          </p>
        )}
        {columns.map((column) => {
          const editable = !!details?.columns.find(
            (item) => item.name === column.name
          )?.editable
          const value = details ? draft[column.name] : row[column.name]
          const changed = Object.hasOwn(changes, column.name)
          return (
            <div
              className={`row-field${changed ? ' changed' : ''}`}
              key={column.name}
            >
              <div className="row-field-label">
                <label htmlFor={`row-field-${column.name}`}>
                  {column.isPrimaryKey && <KeyRound size={12} />} {column.name}
                  {changed && <span>Modified</span>}
                </label>
                <code>{column.dataType}</code>
              </div>
              <div className="row-field-schema">
                <span>{column.nullable ? 'Nullable' : 'Not null'}</span>
                {column.isPrimaryKey && <span>Primary key</span>}
                {column.defaultValue && (
                  <span title={column.defaultValue}>
                    Default: {column.defaultValue}
                  </span>
                )}
              </div>
              {editable ? (
                <>
                  {column.dataType === 'boolean' ? (
                    <select
                      id={`row-field-${column.name}`}
                      value={value === null ? '' : String(value)}
                      disabled={saving || value === null}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [column.name]: event.target.value
                        }))
                      }
                    >
                      <option value="">NULL</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <textarea
                      id={`row-field-${column.name}`}
                      aria-label={`Value for ${column.name}`}
                      value={value === null ? '' : String(value ?? '')}
                      placeholder={value === null ? 'NULL' : 'Empty string'}
                      disabled={saving || value === null}
                      rows={
                        column.dataType.includes('json') ||
                        String(value ?? '').includes('\n')
                          ? 4
                          : 2
                      }
                      spellCheck={false}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [column.name]: event.target.value
                        }))
                      }
                    />
                  )}
                  {column.nullable && (
                    <label className="row-null-toggle">
                      <input
                        type="checkbox"
                        checked={value === null}
                        disabled={saving}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [column.name]: event.target.checked
                              ? null
                              : (details?.row[column.name] ?? '')
                          }))
                        }
                      />
                      Set NULL
                    </label>
                  )}
                </>
              ) : (
                <pre
                  id={`row-field-${column.name}`}
                  className={value == null ? 'null-cell' : ''}
                >
                  {value == null ? 'NULL' : String(value)}
                </pre>
              )}
            </div>
          )
        })}
      </div>
      <footer className="row-panel-footer">
        <span>
          {dirty
            ? `${Object.keys(changes).length} unsaved field${Object.keys(changes).length === 1 ? '' : 's'}`
            : details
              ? 'No unsaved changes'
              : 'Read only'}
        </span>
        <div>
          <button
            aria-label="Reload row"
            disabled={!source || loading || saving}
            onClick={() => {
              if (
                !dirty ||
                window.confirm('Discard unsaved changes and reload this row?')
              )
                setReload((current) => current + 1)
            }}
          >
            <RefreshCw size={13} /> Reload
          </button>
          <button
            disabled={!dirty || saving}
            onClick={() => {
              if (details) setDraft(details.row)
              setError('')
              setNotice('')
            }}
          >
            <RotateCcw size={13} /> Discard
          </button>
          <button
            className="db-run-button"
            disabled={!dirty || loading || saving}
            onClick={() => void save()}
          >
            <Save size={13} />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </footer>
    </aside>
  )
}
