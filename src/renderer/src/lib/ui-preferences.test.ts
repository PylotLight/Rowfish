import { describe, expect, test } from 'bun:test'
import {
  ACCENTS,
  applyUiPreferences,
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
  saveUiPreferences
} from './ui-preferences'
import type { StorageLike } from './appearance'

class MemoryStorage implements StorageLike {
  values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}
const brokenStorage: StorageLike = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  }
}

describe('UI preferences', () => {
  test('exposes defaults and accent presets', () => {
    expect(DEFAULT_UI_PREFERENCES.editorFontSize).toBe(14)
    expect(DEFAULT_UI_PREFERENCES.lineNumbers).toBe(true)
    expect(ACCENTS.map((a) => a.id)).toEqual([
      'mint',
      'sky',
      'violet',
      'amber',
      'coral'
    ])
  })
  test('loads valid values and rejects malformed fields independently', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      'rowfish.ui-preferences.v1',
      JSON.stringify({
        theme: 'paper',
        accent: 'custom',
        customAccent: '#123ABC',
        density: 'compact',
        motion: 'reduced',
        blur: false,
        interfaceFont: 'Georgia',
        editorFont: 'Menlo',
        editorFontSize: 22,
        lineNumbers: false,
        lineWrapping: true
      })
    )
    expect(loadUiPreferences(storage)).toMatchObject({
      theme: 'paper',
      accent: 'custom',
      customAccent: '#123ABC',
      density: 'compact',
      motion: 'reduced',
      blur: false,
      interfaceFont: 'Georgia',
      editorFont: 'Menlo',
      editorFontSize: 22,
      lineNumbers: false,
      lineWrapping: true
    })
    storage.setItem(
      'rowfish.ui-preferences.v1',
      JSON.stringify({
        theme: 'unknown',
        density: 'wide',
        editorFontSize: 999,
        customAccent: 'red',
        blur: 'no'
      })
    )
    expect(loadUiPreferences(storage)).toEqual(DEFAULT_UI_PREFERENCES)
  })
  test('falls back to legacy appearance and density when new key is absent or invalid', () => {
    const storage = new MemoryStorage()
    storage.setItem('rowfish.appearance', 'amoled')
    storage.setItem('rowfish.textDensity', 'compact')
    expect(loadUiPreferences(storage)).toMatchObject({
      theme: 'amoled',
      density: 'compact'
    })
    storage.setItem('rowfish.ui-preferences.v1', '{broken')
    expect(loadUiPreferences(storage)).toMatchObject({
      theme: 'amoled',
      density: 'compact'
    })
  })
  test('persists unified and legacy keys', () => {
    const storage = new MemoryStorage()
    const prefs = {
      ...DEFAULT_UI_PREFERENCES,
      theme: 'forest' as const,
      density: 'compact' as const
    }
    expect(saveUiPreferences(prefs, storage)).toBe(true)
    expect(JSON.parse(storage.getItem('rowfish.ui-preferences.v1')!)).toEqual(
      prefs
    )
    expect(storage.getItem('rowfish.appearance')).toBe('forest')
    expect(storage.getItem('rowfish.textDensity')).toBe('compact')
  })
  test('handles blocked storage gracefully', () => {
    expect(loadUiPreferences(brokenStorage)).toEqual(DEFAULT_UI_PREFERENCES)
    expect(saveUiPreferences(DEFAULT_UI_PREFERENCES, brokenStorage)).toBe(false)
  })
  test('applies preference datasets and CSS values when a DOM is present', () => {
    if (typeof document === 'undefined') return
    const prefs = {
      ...DEFAULT_UI_PREFERENCES,
      theme: 'plum' as const,
      accent: 'sky' as const,
      density: 'compact' as const,
      motion: 'reduced' as const,
      blur: false,
      editorFontSize: 17
    }
    applyUiPreferences(prefs)
    expect(document.documentElement.dataset.appearance).toBe('plum')
    expect(document.documentElement.dataset.textDensity).toBe('compact')
    expect(document.documentElement.dataset.motion).toBe('reduced')
    expect(document.documentElement.dataset.blur).toBe('false')
    expect(document.documentElement.style.getPropertyValue('--mint')).toBe(
      '#70b8ff'
    )
    expect(document.documentElement.style.getPropertyValue('--mint-ink')).toBe(
      '#101719'
    )
    expect(
      document.documentElement.style.getPropertyValue('--editor-font-size')
    ).toBe('17px')
  })
})
