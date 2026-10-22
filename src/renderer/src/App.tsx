import { useEffect, useRef, useState } from 'react'
import DatabaseWorkspace from './views/DatabaseWorkspace'
import {
  loadAppearance,
  saveAppearance,
  loadTextDensity,
  saveTextDensity,
  type AppearanceTheme,
  type TextDensity
} from './lib/appearance'

export default function App(): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [theme, setTheme] = useState<AppearanceTheme>(() => loadAppearance())
  const [density, setDensity] = useState<TextDensity>(() => loadTextDensity())
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    document.documentElement.dataset.appearance = theme
    document.documentElement.dataset.textDensity = density
  }, [theme, density])
  useEffect(() => {
    if (!appearanceOpen) return
    controlRef.current?.querySelector('select')?.focus()
    const outside = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !controlRef.current?.contains(event.target)
      )
        setAppearanceOpen(false)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAppearanceOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', keyboard)
    }
  }, [appearanceOpen])
  const chooseTheme = (next: AppearanceTheme) => {
    setTheme(next)
    saveAppearance(next)
  }
  const chooseDensity = (next: TextDensity) => {
    setDensity(next)
    saveTextDensity(next)
  }

  return (
    <div className="shell" data-appearance={theme}>
      <main className="content">
        <header className="topbar">
          <div className="app-brand">
            <span className="brand-mark" aria-hidden="true">
              r
            </span>
            <div>
              <h1>Rowfish</h1>
              <span>PostgreSQL workspace</span>
            </div>
          </div>
          <span className="topbar-hint">
            A little clarity for your databases.
          </span>
          <div className="appearance-control" ref={controlRef}>
            <button
              ref={triggerRef}
              className="appearance-trigger"
              type="button"
              aria-label="Appearance"
              aria-haspopup="dialog"
              aria-expanded={appearanceOpen}
              onClick={() => setAppearanceOpen((open) => !open)}
            >
              <span aria-hidden="true">◐</span>
              <span>Appearance</span>
            </button>
            {appearanceOpen && (
              <section
                className="appearance-menu"
                role="dialog"
                aria-label="Appearance preferences"
              >
                <label htmlFor="color-theme">Color theme</label>
                <select
                  id="color-theme"
                  aria-label="Color theme"
                  value={theme}
                  onChange={(event) =>
                    chooseTheme(event.target.value as AppearanceTheme)
                  }
                >
                  <option value="glass">Glass</option>
                  <option value="amoled">AMOLED black</option>
                </select>
                <label htmlFor="text-density">Text size</label>
                <select
                  id="text-density"
                  aria-label="Text size"
                  value={density}
                  onChange={(event) =>
                    chooseDensity(event.target.value as TextDensity)
                  }
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </section>
            )}
          </div>
          <input
            className="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter result rows…"
            aria-label="Filter result rows"
          />
        </header>
        <div className="view">
          <DatabaseWorkspace search={search} />
        </div>
      </main>
    </div>
  )
}
