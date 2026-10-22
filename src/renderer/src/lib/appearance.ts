export type AppearanceTheme =
  'glass' | 'amoled' | 'deep' | 'forest' | 'plum' | 'paper'
export type TextDensity = 'comfortable' | 'compact'
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const THEME_KEY = 'rowfish.appearance'
const DENSITY_KEY = 'rowfish.textDensity'
const DEFAULT_THEME: AppearanceTheme = 'glass'
const DEFAULT_DENSITY: TextDensity = 'comfortable'

function readPreference<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  storage?: StorageLike
): T {
  try {
    const target =
      storage ??
      (typeof localStorage === 'undefined' ? undefined : localStorage)
    const value = target?.getItem(key)
    return allowed.find((item) => item === value) ?? fallback
  } catch {
    return fallback
  }
}
function writePreference(
  key: string,
  value: string,
  storage?: StorageLike
): boolean {
  try {
    const target =
      storage ??
      (typeof localStorage === 'undefined' ? undefined : localStorage)
    if (!target) return false
    target.setItem(key, value)
    return true
  } catch {
    return false
  }
}
export function loadAppearance(storage?: StorageLike): AppearanceTheme {
  return readPreference(
    THEME_KEY,
    ['glass', 'amoled', 'deep', 'forest', 'plum', 'paper'] as const,
    DEFAULT_THEME,
    storage
  )
}
export function saveAppearance(
  theme: AppearanceTheme,
  storage?: StorageLike
): boolean {
  return writePreference(THEME_KEY, theme, storage)
}
export function loadTextDensity(storage?: StorageLike): TextDensity {
  return readPreference(
    DENSITY_KEY,
    ['comfortable', 'compact'] as const,
    DEFAULT_DENSITY,
    storage
  )
}
export function saveTextDensity(
  density: TextDensity,
  storage?: StorageLike
): boolean {
  return writePreference(DENSITY_KEY, density, storage)
}
