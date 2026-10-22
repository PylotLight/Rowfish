import { describe, expect, test } from "bun:test";
import {
  clampLayout,
  LAYOUT_DEFAULTS,
  loadLayout,
  saveLayout,
} from "./layout-preferences";
function memory(initial?: string): Storage {
  const data = new Map<string, string>(
    initial ? [["rowfish.layout.v1", initial]] : [],
  );
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: (n) => [...data.keys()][n] ?? null,
    get length() {
      return data.size;
    },
  };
}
describe("layout preferences", () => {
  test("uses safe defaults and clamps corrupt/out-of-range dimensions", () => {
    expect(
      loadLayout(memory('{"sidebar":999999,"split":-1,"rowPanel":"oops"}')),
    ).toEqual({ sidebar: 520, split: 20, rowPanel: 390 });
    expect(loadLayout(memory("{bad")).sidebar).toBe(LAYOUT_DEFAULTS.sidebar);
    expect(clampLayout(490, "sidebar", 800)).toBe(440);
  });
  test("persists and restores dimensions", () => {
    const storage = memory();
    expect(
      saveLayout({ sidebar: 401, split: 55, rowPanel: 420 }, storage),
    ).toBe(true);
    expect(loadLayout(storage)).toEqual({
      sidebar: 401,
      split: 55,
      rowPanel: 420,
    });
  });
});
