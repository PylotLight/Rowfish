import { describe, expect, test } from "bun:test";
import { parseWindowState, restorableBounds } from "./window-state";

const min = { width: 1000, height: 640 };
const laptop = { x: 0, y: 0, width: 1512, height: 944 };
const external = { x: 1512, y: -200, width: 2560, height: 1415 };

describe("window state", () => {
  test("parses valid state and rejects junk", () => {
    expect(
      parseWindowState({
        bounds: { x: 10.4, y: 20, width: 1200, height: 800 },
        maximized: true,
      }),
    ).toEqual({
      bounds: { x: 10, y: 20, width: 1200, height: 800 },
      maximized: true,
      fullScreen: false,
    });
    expect(parseWindowState(null)).toBeNull();
    expect(
      parseWindowState({ bounds: { x: 1, y: 2, width: 0, height: 5 } }),
    ).toBeNull();
    expect(parseWindowState({ bounds: { x: "1" } })).toBeNull();
  });

  test("keeps a position that is still on screen", () => {
    const saved = { x: 1700, y: 100, width: 1400, height: 900 };
    expect(restorableBounds(saved, [laptop, external], min)).toEqual(saved);
  });

  test("falls back to a centred size when its display is gone", () => {
    const saved = { x: 1700, y: 100, width: 1400, height: 900 };
    expect(restorableBounds(saved, [laptop], min)).toEqual({
      width: 1400,
      height: 900,
    });
  });

  test("shrinks and nudges oversized windows onto the display", () => {
    expect(
      restorableBounds(
        { x: 900, y: 50, width: 2400, height: 1400 },
        [laptop],
        min,
      ),
    ).toEqual({ x: 0, y: 0, width: 1512, height: 944 });
  });

  test("never goes below the minimum size", () => {
    expect(
      restorableBounds(
        { x: 10, y: 10, width: 200, height: 100 },
        [laptop],
        min,
      ),
    ).toEqual({ x: 10, y: 10, width: 1000, height: 640 });
  });

  test("ignores a title bar dragged off the top", () => {
    expect(
      restorableBounds(
        { x: 100, y: -600, width: 1200, height: 800 },
        [laptop],
        min,
      ),
    ).toEqual({ width: 1200, height: 800 });
  });
});
