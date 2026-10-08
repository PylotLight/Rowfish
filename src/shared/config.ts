// Single source of truth for app identity and window defaults.
// Keep this product-specific when you use Rowfish as a starting point.
/** Display name shown in the UI, tray, and notifications. */
export const APP_NAME = 'Rowfish'
/** One-liner shown under the brand in the sidebar. */
export const APP_TAGLINE = 'PostgreSQL & MongoDB client'
/** Reverse-DNS id used by Electron and macOS bundle metadata. */
export const APP_ID = 'com.pylotlight.rowfish'
/** Default BrowserWindow geometry. */
export const WINDOW = {
  width: 1240,
  height: 820,
  minWidth: 1000,
  minHeight: 640
} as const
/** Tooltip for the system tray icon. */
export const TRAY_TOOLTIP = `${APP_NAME} — click for menu`
