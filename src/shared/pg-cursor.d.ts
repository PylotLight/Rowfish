declare module 'pg-cursor' {
  interface CursorField {
    name: string
  }

  interface CursorResult {
    fields: CursorField[]
  }

  type CursorCallback = (error: Error | null, rows: unknown[][], result: CursorResult) => void

  class Cursor {
    constructor(query: string, values?: unknown[], config?: { rowMode?: 'array' })
    read(rowCount: number, callback: CursorCallback): void
    close(): Promise<void>
  }

  export default Cursor
}
