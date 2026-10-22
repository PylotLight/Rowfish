import { splitPostgresStatements } from '../../../shared/sql-statements'

export type PlanNode = {
  nodeType: string
  relation?: string
  schema?: string
  alias?: string
  startupCost?: number
  totalCost?: number
  planRows?: number
  planWidth?: number
  children: PlanNode[]
}

export function buildExplainQuery(sql: string): string {
  const statements = splitPostgresStatements(sql).filter(Boolean)
  if (statements.length !== 1)
    throw new Error('Explain requires exactly one SQL statement.')
  const target = statements[0]!.replace(
    /^(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/)|\s)*/,
    ''
  )
  if (
    !target ||
    /^(?:EXPLAIN|BEGIN|START|COMMIT|ROLLBACK|PREPARE|EXECUTE|DEALLOCATE|SET|RESET|SHOW|COPY|VACUUM|ANALYZE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO)\b/i.test(
      target
    )
  )
    throw new Error(
      'Explain is available only for a single SELECT, WITH, VALUES, or TABLE query.'
    )
  if (!/^(?:SELECT|WITH|VALUES|TABLE)\b/i.test(target))
    throw new Error(
      'Unsupported Explain target. Use a SELECT, WITH, VALUES, or TABLE query.'
    )
  return `EXPLAIN (FORMAT JSON) ${statements[0]!.replace(/;\s*$/, '')}`
}

export function parsePlanResult(value: unknown): PlanNode | null {
  let json: unknown = value
  if (typeof json === 'string') {
    try {
      json = JSON.parse(json)
    } catch {
      return null
    }
  }
  if (Array.isArray(json) && json.length === 1) json = json[0]
  if (!json || typeof json !== 'object') return null
  const root = json as Record<string, unknown>
  // Database worker serializes JSON cells to strings before crossing IPC.
  // Unwrap the QUERY PLAN cell before reading the PostgreSQL plan document.
  if ('QUERY PLAN' in root) return parsePlanResult(root['QUERY PLAN'])
  const explain = root
  if (!explain || typeof explain !== 'object') return null
  const plan = (explain as Record<string, unknown>).Plan
  if (!plan || typeof plan !== 'object') return null
  const visit = (raw: Record<string, unknown>): PlanNode => ({
    nodeType:
      typeof raw['Node Type'] === 'string' ? raw['Node Type'] : 'Unknown node',
    ...(typeof raw['Relation Name'] === 'string'
      ? { relation: raw['Relation Name'] }
      : {}),
    ...(typeof raw['Schema'] === 'string' ? { schema: raw['Schema'] } : {}),
    ...(typeof raw['Alias'] === 'string' ? { alias: raw['Alias'] } : {}),
    ...(typeof raw['Startup Cost'] === 'number'
      ? { startupCost: raw['Startup Cost'] }
      : {}),
    ...(typeof raw['Total Cost'] === 'number'
      ? { totalCost: raw['Total Cost'] }
      : {}),
    ...(typeof raw['Plan Rows'] === 'number'
      ? { planRows: raw['Plan Rows'] }
      : {}),
    ...(typeof raw['Plan Width'] === 'number'
      ? { planWidth: raw['Plan Width'] }
      : {}),
    children: Array.isArray(raw['Plans'])
      ? raw['Plans']
          .filter(
            (child): child is Record<string, unknown> =>
              Boolean(child) && typeof child === 'object'
          )
          .map(visit)
      : []
  })
  return visit(plan as Record<string, unknown>)
}

export const postgresDiagnostics = [
  {
    id: 'sessions',
    label: 'Active sessions',
    sql: `SELECT pid, usename, application_name, client_addr, state, wait_event_type, wait_event, now() - query_start AS query_age, left(query, 500) AS query\nFROM pg_stat_activity\nWHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()\nORDER BY query_start NULLS LAST\nLIMIT 100;`
  },
  {
    id: 'sizes',
    label: 'Table and index sizes',
    sql: `SELECT schemaname, relname AS table_name, pg_size_pretty(pg_total_relation_size(relid)) AS total_size, pg_size_pretty(pg_relation_size(relid)) AS table_size, pg_size_pretty(pg_indexes_size(relid)) AS indexes_size\nFROM pg_catalog.pg_statio_user_tables\nORDER BY pg_total_relation_size(relid) DESC\nLIMIT 100;`
  },
  {
    id: 'index-usage',
    label: 'Index usage',
    sql: `SELECT schemaname, relname AS table_name, indexrelname AS index_name, idx_scan, idx_tup_read, idx_tup_fetch, pg_size_pretty(pg_relation_size(indexrelid)) AS index_size\nFROM pg_catalog.pg_stat_user_indexes\nORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC\nLIMIT 200;`
  },
  {
    id: 'blocking',
    label: 'Blocking locks',
    sql: `SELECT blocked.pid AS blocked_pid, blocked.usename AS blocked_user,
       blocker.pid AS blocking_pid, blocker.usename AS blocking_user,
       left(blocked.query, 500) AS blocked_query,
       now() - blocked.query_start AS blocked_for
FROM pg_catalog.pg_stat_activity AS blocked
CROSS JOIN LATERAL unnest(pg_catalog.pg_blocking_pids(blocked.pid)) AS locks(blocking_pid)
LEFT JOIN pg_catalog.pg_stat_activity AS blocker ON blocker.pid = locks.blocking_pid
WHERE blocked.datname = current_database()
ORDER BY blocked.query_start NULLS LAST
LIMIT 100;`
  }
] as const
