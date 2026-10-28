import type { AppearanceTheme, StorageLike } from "./appearance";
import {
  loadAppearance,
  loadTextDensity,
  saveAppearance,
  saveTextDensity,
} from "./appearance";

export type UiPreferences = {
  theme: AppearanceTheme;
  accent: "mint" | "sky" | "violet" | "amber" | "coral" | "custom";
  customAccent: string;
  density: "comfortable" | "compact";
  motion: "full" | "reduced" | "system";
  blur: boolean;
  interfaceFont: "system" | "Inter" | "Arial" | "Georgia";
  editorFont: "system" | "Menlo" | "Consolas" | "Courier New";
  editorFontSize: number;
  lineNumbers: boolean;
  lineWrapping: boolean;
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  theme: "glass",
  accent: "mint",
  customAccent: "#73e6c2",
  density: "comfortable",
  motion: "system",
  blur: true,
  interfaceFont: "system",
  editorFont: "system",
  editorFontSize: 14,
  lineNumbers: true,
  lineWrapping: false,
};

export const ACCENTS = [
  { id: "mint", name: "Mint", hex: "#73e6c2" },
  { id: "sky", name: "Sky", hex: "#70b8ff" },
  { id: "violet", name: "Violet", hex: "#b49aff" },
  { id: "amber", name: "Amber", hex: "#ffc36b" },
  { id: "coral", name: "Coral", hex: "#ff8d87" },
] as const;
export const THEMES = [
  { id: "glass", name: "Glass", description: "Translucent dark surfaces" },
  {
    id: "amoled",
    name: "AMOLED black",
    description: "Pure black surfaces for OLED displays",
  },
  { id: "deep", name: "Deep", description: "Rich, low-light navy surfaces" },
  { id: "forest", name: "Forest", description: "Muted green surfaces" },
  { id: "plum", name: "Plum", description: "Deep violet surfaces" },
  {
    id: "paper",
    name: "Paper",
    description: "A light, paper-inspired interface",
  },
] as const;

const KEY = "rowfish.ui-preferences.v1";
const themes = ["glass", "amoled", "deep", "forest", "plum", "paper"];
const accents = ["mint", "sky", "violet", "amber", "coral", "custom"];
const densities = ["comfortable", "compact"];
const motions = ["full", "reduced", "system"];
const interfaceFonts = ["system", "Inter", "Arial", "Georgia"];
const editorFonts = ["system", "Menlo", "Consolas", "Courier New"];
const validHex = (s: unknown): s is string =>
  typeof s === "string" && /^#[\da-f]{6}$/i.test(s);
function targetStorage(storage?: StorageLike): StorageLike | undefined {
  try {
    return (
      storage ??
      (typeof localStorage === "undefined" ? undefined : localStorage)
    );
  } catch {
    return undefined;
  }
}

export function loadUiPreferences(storage?: StorageLike): UiPreferences {
  const result = {
    ...DEFAULT_UI_PREFERENCES,
    theme: loadAppearance(storage),
    density: loadTextDensity(storage),
  };
  try {
    const raw = targetStorage(storage)?.getItem(KEY);
    if (!raw) return result;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return result;
    const v = data as Record<string, unknown>;
    if (themes.includes(v.theme as string))
      result.theme = v.theme as AppearanceTheme;
    if (accents.includes(v.accent as string))
      result.accent = v.accent as UiPreferences["accent"];
    if (validHex(v.customAccent)) result.customAccent = v.customAccent;
    if (densities.includes(v.density as string))
      result.density = v.density as UiPreferences["density"];
    if (motions.includes(v.motion as string))
      result.motion = v.motion as UiPreferences["motion"];
    if (typeof v.blur === "boolean") result.blur = v.blur;
    if (interfaceFonts.includes(v.interfaceFont as string))
      result.interfaceFont = v.interfaceFont as UiPreferences["interfaceFont"];
    if (editorFonts.includes(v.editorFont as string))
      result.editorFont = v.editorFont as UiPreferences["editorFont"];
    if (
      typeof v.editorFontSize === "number" &&
      Number.isFinite(v.editorFontSize) &&
      v.editorFontSize >= 11 &&
      v.editorFontSize <= 24
    )
      result.editorFontSize = v.editorFontSize;
    if (typeof v.lineNumbers === "boolean") result.lineNumbers = v.lineNumbers;
    if (typeof v.lineWrapping === "boolean")
      result.lineWrapping = v.lineWrapping;
  } catch {
    /* unavailable or malformed storage: retain defaults and legacy values */
  }
  return result;
}

export function saveUiPreferences(
  prefs: UiPreferences,
  storage?: StorageLike,
): boolean {
  const target = targetStorage(storage);
  if (!target) return false;
  let saved = false;
  try {
    target.setItem(KEY, JSON.stringify(prefs));
    saved = true;
  } catch {
    /* storage blocked */
  }
  const legacyTheme = saveAppearance(prefs.theme, target);
  const legacyDensity = saveTextDensity(prefs.density, target);
  return saved && legacyTheme && legacyDensity;
}

function luminance(hex: string): number {
  const values = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((v) => parseInt(v, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * values[0]! + 0.7152 * values[1]! + 0.0722 * values[2]!;
}
type UiPreferenceTarget = Pick<HTMLElement, "dataset"> & {
  style: Pick<CSSStyleDeclaration, "setProperty">;
};

export function applyUiPreferences(
  prefs: UiPreferences,
  target?: UiPreferenceTarget,
): void {
  const root =
    target ??
    (typeof document === "undefined" ? undefined : document.documentElement);
  if (!root) return;
  let accent: string =
    prefs.accent === "custom"
      ? prefs.customAccent
      : (ACCENTS.find((a) => a.id === prefs.accent)?.hex ??
        DEFAULT_UI_PREFERENCES.customAccent);
  // Light backgrounds need darker accent text, including custom colors.
  if (prefs.theme === "paper") {
    while ((luminance("#f2efe8") + 0.05) / (luminance(accent) + 0.05) < 4.5) {
      accent =
        "#" +
        accent
          .slice(1)
          .match(/.{2}/g)!
          .map((channel) =>
            Math.floor(parseInt(channel, 16) * 0.88)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
    }
  }
  const lightContrast = 1.05 / (luminance(accent) + 0.05);
  const darkContrast =
    (luminance(accent) + 0.05) / (luminance("#101719") + 0.05);
  const ink = darkContrast > lightContrast ? "#101719" : "#ffffff";
  root.dataset.appearance = prefs.theme;
  root.dataset.textDensity = prefs.density;
  root.dataset.motion = prefs.motion;
  root.dataset.blur = String(prefs.blur);
  root.style.setProperty("--mint", accent);
  root.style.setProperty("--mint-dim", `${accent}33`);
  root.style.setProperty("--mint-ink", ink);
  root.style.setProperty(
    "--ui-font",
    prefs.interfaceFont === "system"
      ? "system-ui, sans-serif"
      : `'${prefs.interfaceFont}', sans-serif`,
  );
  root.style.setProperty(
    "--editor-font",
    prefs.editorFont === "system"
      ? "ui-monospace, monospace"
      : `'${prefs.editorFont}', monospace`,
  );
  root.style.setProperty("--editor-font-size", `${prefs.editorFontSize}px`);
}
