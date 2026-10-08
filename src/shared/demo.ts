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
