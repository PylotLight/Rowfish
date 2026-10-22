import { useEffect, useRef, useState } from 'react'
import { Power, Settings as SettingsIcon } from 'lucide-react'
import DatabaseWorkspace from './views/DatabaseWorkspace'
import Settings from './views/Settings'
import {
  applyUiPreferences,
  loadUiPreferences,
  saveUiPreferences,
  type UiPreferences
} from './lib/ui-preferences'

export default function App(): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [prefs, setPrefs] = useState(loadUiPreferences)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    applyUiPreferences(prefs)
    void window.api.app
      .setBlur(prefs.blur && prefs.theme === 'glass')
      .catch(() => undefined)
  }, [prefs])
  const closeSettings = () => {
    setSettingsOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }
  useEffect(() => {
    if (settingsOpen)
      document.querySelector<HTMLButtonElement>('.settings-back')?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setSettingsOpen((open) => !open)
      } else if (event.key === 'Escape' && settingsOpen) closeSettings()
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [settingsOpen])
  const changePreferences = (next: UiPreferences) => {
    setPrefs(next)
    setSaveError(!saveUiPreferences(next))
  }
  const actions = (
    <div className="app-sidebar-actions" aria-label="Application actions">
      <span>Rowfish</span>
      <button
        ref={triggerRef}
        className={`app-foot-button${settingsOpen ? ' active' : ''}`}
        type="button"
        title="Settings"
        aria-label="Settings"
        aria-pressed={settingsOpen}
        onClick={() => setSettingsOpen((open) => !open)}
      >
        <SettingsIcon size={16} aria-hidden="true" />
      </button>
      <button
        className="app-foot-button quit"
        type="button"
        title="Quit Rowfish"
        aria-label="Quit Rowfish"
        onClick={() => void window.api.app.quit()}
      >
        <Power size={16} aria-hidden="true" />
      </button>
    </div>
  )
  return (
    <div className="shell" data-appearance={prefs.theme}>
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
          {!settingsOpen && (
            <input
              className="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter result rows…"
              aria-label="Filter result rows"
            />
          )}
        </header>
        {saveError && (
          <p className="preferences-save-error" role="alert">
            Preferences apply now, but could not be saved on this device.
          </p>
        )}
        <div className="view">
          <DatabaseWorkspace
            search={search}
            preferences={prefs}
            sidebarActions={actions}
            settingsView={
              settingsOpen ? (
                <Settings
                  prefs={prefs}
                  onChange={changePreferences}
                  onBack={closeSettings}
                />
              ) : undefined
            }
          />
        </div>
      </main>
    </div>
  )
}
