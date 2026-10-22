import { useState } from 'react'
import {
  ACCENTS,
  DEFAULT_UI_PREFERENCES,
  THEMES,
  type UiPreferences
} from '../lib/ui-preferences'
import '../components/settings.css'

type Props = {
  prefs: UiPreferences
  onChange: (prefs: UiPreferences) => void
  onBack: () => void
}
type Section = 'appearance' | 'editor'

export default function Settings({
  prefs,
  onChange,
  onBack
}: Props): React.JSX.Element {
  const [section, setSection] = useState<Section>('appearance')
  const set = (patch: Partial<UiPreferences>) =>
    onChange({ ...prefs, ...patch })
  const radio = <T extends string>(
    label: string,
    value: T,
    options: readonly T[],
    update: (v: T) => void
  ) => (
    <div className="settings-choice" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          role="radio"
          aria-checked={value === option}
          className={`settings-chip${value === option ? ' selected' : ''}`}
          onClick={() => update(option)}
        >
          {option.charAt(0).toUpperCase() + option.slice(1)}
        </button>
      ))}
    </div>
  )
  return (
    <section
      className="settings-page"
      role="region"
      aria-label="Settings"
      onKeyDown={(event) => {
        if (
          ![
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End'
          ].includes(event.key)
        )
          return
        const target = event.target as HTMLElement
        if (target.getAttribute('role') !== 'radio') return
        const items = Array.from(
          target
            .closest('[role="radiogroup"]')
            ?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []
        )
        const index = items.indexOf(target as HTMLButtonElement)
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (index +
                  (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) +
                  items.length) %
                items.length
        event.preventDefault()
        items[next]?.focus()
        items[next]?.click()
      }}
    >
      <header className="settings-header">
        <div>
          <span className="settings-kicker">ROWFISH PREFERENCES</span>
          <h1>Settings</h1>
          <p>Saved locally on this device.</p>
        </div>
        <button type="button" className="settings-back" onClick={onBack}>
          ← Back
        </button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <span className="settings-nav-caption">PREFERENCES</span>
          {(['appearance', 'editor'] as const).map((item) => (
            <button
              type="button"
              key={item}
              className={`settings-nav-button${section === item ? ' active' : ''}`}
              aria-current={section === item ? 'page' : undefined}
              onClick={() => setSection(item)}
            >
              <span aria-hidden="true">
                {item === 'appearance' ? '◐' : '⌘'}
              </span>
              {item === 'appearance' ? 'Appearance' : 'Editor'}
            </button>
          ))}
          <button
            type="button"
            className="settings-reset"
            onClick={() => onChange({ ...DEFAULT_UI_PREFERENCES })}
          >
            Restore defaults
          </button>
        </nav>
        <div className="settings-content">
          {section === 'appearance' ? (
            <>
              <section className="settings-section">
                <h2>Appearance</h2>
                <p className="settings-description">
                  Make Rowfish feel like your workspace.
                </p>
                <div className="settings-field">
                  <h3>Theme</h3>
                  <div
                    className="settings-theme-grid"
                    role="radiogroup"
                    aria-label="Theme"
                  >
                    {THEMES.map((theme) => (
                      <button
                        type="button"
                        key={theme.id}
                        role="radio"
                        aria-label={theme.name}
                        aria-checked={prefs.theme === theme.id}
                        className={`settings-theme-card${prefs.theme === theme.id ? ' selected' : ''}`}
                        onClick={() => set({ theme: theme.id })}
                      >
                        <span
                          className={`settings-theme-sample theme-${theme.id}`}
                          aria-hidden="true"
                        >
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="settings-theme-name">
                          {theme.name}
                        </span>
                        <span className="settings-theme-description">
                          {theme.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-field">
                  <h3>Accent color</h3>
                  <div
                    className="settings-accent-list"
                    role="radiogroup"
                    aria-label="Accent color"
                  >
                    {ACCENTS.map((accent) => (
                      <button
                        type="button"
                        key={accent.id}
                        role="radio"
                        aria-checked={prefs.accent === accent.id}
                        className={`settings-accent${prefs.accent === accent.id ? ' selected' : ''}`}
                        onClick={() => set({ accent: accent.id })}
                      >
                        <span
                          style={{ background: accent.hex }}
                          aria-hidden="true"
                        />
                        <span>{accent.name}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={prefs.accent === 'custom'}
                      className={`settings-accent${prefs.accent === 'custom' ? ' selected' : ''}`}
                      onClick={() => set({ accent: 'custom' })}
                    >
                      <span
                        style={{ background: prefs.customAccent }}
                        aria-hidden="true"
                      />
                      <span>Custom</span>
                    </button>
                  </div>
                  {prefs.accent === 'custom' && (
                    <label className="settings-color-label">
                      Custom accent color
                      <input
                        type="color"
                        value={prefs.customAccent}
                        onChange={(e) =>
                          set({
                            customAccent: e.target.value,
                            accent: 'custom'
                          })
                        }
                      />
                    </label>
                  )}
                </div>
                <div className="settings-field settings-field-inline">
                  <div>
                    <h3>Text size</h3>
                    <p>Choose the density that suits your workspace.</p>
                  </div>
                  {radio(
                    'Text size',
                    prefs.density,
                    ['comfortable', 'compact'] as const,
                    (density) => set({ density })
                  )}
                </div>
                <div className="settings-field settings-field-inline">
                  <div>
                    <h3>Interface font</h3>
                    <p>Font used for controls and interface text.</p>
                  </div>
                  <label className="settings-select-label">
                    <span className="visually-hidden">Interface font</span>
                    <select
                      aria-label="Interface font"
                      value={prefs.interfaceFont}
                      onChange={(e) =>
                        set({
                          interfaceFont: e.target
                            .value as UiPreferences['interfaceFont']
                        })
                      }
                    >
                      <option value="system">System default</option>
                      <option>Inter</option>
                      <option>Arial</option>
                      <option>Georgia</option>
                    </select>
                  </label>
                </div>
                <div className="settings-field settings-field-inline">
                  <div>
                    <h3>Background blur</h3>
                    <p>Native window vibrancy is available on macOS only.</p>
                  </div>
                  <label className="settings-toggle">
                    <span className="visually-hidden">Background blur</span>
                    <input
                      aria-label="Background blur"
                      type="checkbox"
                      checked={prefs.blur}
                      onChange={(e) => set({ blur: e.target.checked })}
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                <div className="settings-field settings-field-inline">
                  <div>
                    <h3>Motion</h3>
                    <p>System follows your operating-system preference.</p>
                  </div>
                  {radio(
                    'Motion',
                    prefs.motion,
                    ['full', 'reduced', 'system'] as const,
                    (motion) => set({ motion })
                  )}
                </div>
              </section>
            </>
          ) : (
            <section className="settings-section">
              <h2>Editor</h2>
              <p className="settings-description">
                Tune the SQL editor and preview your changes.
              </p>
              <div className="settings-field settings-field-inline">
                <div>
                  <h3>Editor font</h3>
                  <p>Monospaced typeface for query text.</p>
                </div>
                <label className="settings-select-label">
                  <span className="visually-hidden">Editor font</span>
                  <select
                    aria-label="Editor font"
                    value={prefs.editorFont}
                    onChange={(e) =>
                      set({
                        editorFont: e.target
                          .value as UiPreferences['editorFont']
                      })
                    }
                  >
                    <option value="system">System default</option>
                    <option>Menlo</option>
                    <option>Consolas</option>
                    <option>Courier New</option>
                  </select>
                </label>
              </div>
              <div className="settings-field settings-field-inline">
                <div>
                  <h3>Font size</h3>
                  <p>Editor text size in pixels.</p>
                </div>
                <label className="settings-number-label">
                  <span className="visually-hidden">Editor font size</span>
                  <input
                    aria-label="Editor font size"
                    type="number"
                    min={11}
                    max={24}
                    value={prefs.editorFontSize}
                    onChange={(e) =>
                      set({
                        editorFontSize: Math.max(
                          11,
                          Math.min(24, Number(e.target.value))
                        )
                      })
                    }
                  />
                  <span>px</span>
                </label>
              </div>
              <div className="settings-field settings-field-inline">
                <div>
                  <h3>Line numbers</h3>
                  <p>Show a number beside each editor line.</p>
                </div>
                <label className="settings-toggle">
                  <span className="visually-hidden">Line numbers</span>
                  <input
                    aria-label="Line numbers"
                    type="checkbox"
                    checked={prefs.lineNumbers}
                    onChange={(e) => set({ lineNumbers: e.target.checked })}
                  />
                  <span aria-hidden="true" />
                </label>
              </div>
              <div className="settings-field settings-field-inline">
                <div>
                  <h3>Line wrapping</h3>
                  <p>Wrap long lines instead of scrolling horizontally.</p>
                </div>
                <label className="settings-toggle">
                  <span className="visually-hidden">Line wrapping</span>
                  <input
                    aria-label="Line wrapping"
                    type="checkbox"
                    checked={prefs.lineWrapping}
                    onChange={(e) => set({ lineWrapping: e.target.checked })}
                  />
                  <span aria-hidden="true" />
                </label>
              </div>
              <div className="settings-field">
                <h3>Live preview</h3>
                <div
                  className="settings-code-preview"
                  style={{
                    fontFamily:
                      prefs.editorFont === 'system'
                        ? 'ui-monospace, monospace'
                        : `'${prefs.editorFont}', monospace`,
                    fontSize: `${prefs.editorFontSize}px`,
                    whiteSpace: prefs.lineWrapping ? 'pre-wrap' : 'pre'
                  }}
                >
                  <span className="settings-code-line">
                    {prefs.lineNumbers && (
                      <span className="settings-line-number">1</span>
                    )}
                    <span>
                      <b>SELECT</b> id, name
                    </span>
                  </span>
                  <span className="settings-code-line">
                    {prefs.lineNumbers && (
                      <span className="settings-line-number">2</span>
                    )}
                    <span>
                      <b>FROM</b> customers
                    </span>
                  </span>
                  <span className="settings-code-line">
                    {prefs.lineNumbers && (
                      <span className="settings-line-number">3</span>
                    )}
                    <span>
                      <b>WHERE</b> active = <em>true</em>;
                    </span>
                  </span>
                  <span className="settings-code-line">
                    {prefs.lineNumbers && (
                      <span className="settings-line-number">4</span>
                    )}
                    <span>
                      <i>-- Your SQL, comfortably readable</i>
                    </span>
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  )
}
