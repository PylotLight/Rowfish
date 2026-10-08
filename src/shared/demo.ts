export interface StorageEntry {
  name: string
  kind: 'folder' | 'file'
  detail: string
  modified: string
}

export const SAMPLE_STORAGE_ENTRIES: StorageEntry[] = [
  { name: 'design-system/', kind: 'folder', detail: '12 items', modified: 'Today, 10:42 AM' },
  { name: 'field-notes/', kind: 'folder', detail: '8 items', modified: 'Yesterday' },
  { name: 'brand-guidelines.pdf', kind: 'file', detail: '2.4 MB · PDF', modified: 'Today, 9:18 AM' },
  { name: 'release-checklist.md', kind: 'file', detail: '14 KB · Markdown', modified: 'Mon, 4:36 PM' },
  { name: 'usage-sample.csv', kind: 'file', detail: '680 KB · CSV', modified: 'Mon, 11:02 AM' },
  { name: 'preview-image.png', kind: 'file', detail: '1.1 MB · PNG', modified: 'Fri, 2:15 PM' }
]

export function filterStorageEntries(entries: StorageEntry[], query: string): StorageEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return entries
  return entries.filter((entry) =>
    `${entry.name} ${entry.kind} ${entry.detail} ${entry.modified}`.toLocaleLowerCase().includes(needle)
  )
}

export interface CaptureNote {
  id: string
  title: string
  body: string
  createdAt: number
}

export function makeCapture(body: string, now = Date.now()): CaptureNote | null {
  const trimmed = body.trim()
  if (!trimmed) return null
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? 'Quick capture'
  const title = firstLine.replace(/^#+\s*/, '').trim().slice(0, 72) || 'Quick capture'
  return { id: `capture-${now}`, title, body: trimmed, createdAt: now }
}
