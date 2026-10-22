import { describe, expect, test } from "bun:test";
import {
  loadAppearance,
  saveAppearance,
  loadTextDensity,
  saveTextDensity,
} from "./appearance";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, next: string) => {
      values.set(key, next);
    },
    value: (key: string) => values.get(key) ?? null,
  };
}

describe("appearance preference", () => {
  test("defaults to Glass and round-trips AMOLED selection", () => {
    const store = storage();
    expect(loadAppearance(store)).toBe("glass");
    expect(saveAppearance("amoled", store)).toBe(true);
    expect(loadAppearance(store)).toBe("amoled");
  });
  test("defaults to Comfortable and round-trips Compact selection", () => {
    const store = storage();
    expect(loadTextDensity(store)).toBe("comfortable");
    expect(saveTextDensity("compact", store)).toBe(true);
    expect(loadTextDensity(store)).toBe("compact");
    expect(store.value("rowfish.textDensity")).toBe("compact");
  });
  test("rejects invalid preferences and gracefully handles storage errors", () => {
    expect(loadAppearance(storage({ "rowfish.appearance": "blue" }))).toBe(
      "glass",
    );
    expect(loadTextDensity(storage({ "rowfish.textDensity": "large" }))).toBe(
      "comfortable",
    );
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadAppearance(broken)).toBe("glass");
    expect(loadTextDensity(broken)).toBe("comfortable");
    expect(saveAppearance("glass", broken)).toBe(false);
    expect(saveTextDensity("compact", broken)).toBe(false);
  });
});
