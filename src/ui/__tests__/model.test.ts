import { describe, expect, it } from "vitest";
import {
  parsePageKey,
  parseToneList,
  legacyTimestamp,
  pageItems,
} from "../model";

describe("parseToneList", () => {
  it("parses comma-separated positive numbers", () => {
    expect(parseToneList("1000, 2000, 5000")).toEqual([1000, 2000, 5000]);
  });

  it("filters out non-positive values", () => {
    expect(parseToneList("0, -1, 500, abc")).toEqual([500]);
  });

  it("returns empty array for empty string", () => {
    expect(parseToneList("")).toEqual([]);
  });

  it("handles no spaces", () => {
    expect(parseToneList("100,200,300")).toEqual([100, 200, 300]);
  });
});

describe("legacyTimestamp", () => {
  it("returns raw string for non-date input", () => {
    expect(legacyTimestamp("not-a-date")).toBe("not-a-date");
  });

  it("formats valid ISO date string", () => {
    // Use a UTC-fixed date to avoid TZ issues; check shape only
    const result = legacyTimestamp("2024-01-15T10:30:00Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("parsePageKey", () => {
  it("accepts every navigable page key", () => {
    // Guards against the whitelist drifting from the actual page list — the
    // bug where "anc" was navigable but never restored from localStorage.
    for (const { key } of pageItems) {
      expect(parsePageKey(key)).toBe(key);
    }
  });

  it("restores the ANC page", () => {
    expect(parsePageKey("anc")).toBe("anc");
  });

  it("falls back to latency for unknown or non-string input", () => {
    expect(parsePageKey("bogus")).toBe("latency");
    expect(parsePageKey(undefined)).toBe("latency");
    expect(parsePageKey(null)).toBe("latency");
    expect(parsePageKey(42)).toBe("latency");
  });
});
