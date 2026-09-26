import { describe, expect, it, vi } from "vitest";
import {
  checkForUpdate,
  compareVersions,
  fetchLatestRelease,
  firstParagraph,
  isRemoteNewer,
  normalizeVersion,
  parseReleasePayload,
  RELEASES_PAGE_URL,
} from "../lib/update-check";

describe("version comparison", () => {
  it("splits a tag into numbers and ignores decoration", () => {
    expect(normalizeVersion("v1.6.0")).toEqual([1, 6, 0]);
    expect(normalizeVersion("1.6.0-beta.2")).toEqual([1, 6, 0]);
    expect(compareVersions("v1.6.0-beta.1", "1.6.0")).toBe(0);
    expect(isRemoteNewer("1.6.0", "1.6.0-beta.2")).toBe(false);
    expect(normalizeVersion("nothing")).toEqual([0]);
  });

  it("orders versions by each component", () => {
    expect(compareVersions("1.5.0", "1.6.0")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.5.0", "1.5.0")).toBe(0);
  });

  it("treats a missing component as zero", () => {
    expect(compareVersions("1.5", "1.5.0")).toBe(0);
    expect(compareVersions("1.5", "1.5.1")).toBe(-1);
  });

  it("only reports newer when it really is newer", () => {
    expect(isRemoteNewer("1.5.0", "v1.6.0")).toBe(true);
    expect(isRemoteNewer("1.5.0", "1.5.0")).toBe(false);
    expect(isRemoteNewer("1.6.0", "1.5.0")).toBe(false);
  });
});

describe("parseReleasePayload", () => {
  it("pulls the tag, url and summary out", () => {
    const info = parseReleasePayload({
      tag_name: "v1.6.0",
      html_url: "https://github.com/Fury7425/pawdio-lab/releases/tag/v1.6.0",
      body: "## Notes\n\nAdds wireless capture.\nMore detail.",
    });
    expect(info.latestVersion).toBe("v1.6.0");
    expect(info.summary).toBe("Adds wireless capture.");
  });

  it("falls back to the releases page for a missing or non-https url", () => {
    const info = parseReleasePayload({ tag_name: "1.6.0", html_url: 12 });
    expect(info.releaseUrl).toBe(RELEASES_PAGE_URL);
  });

  it("rejects drafts and payloads with no version", () => {
    expect(() =>
      parseReleasePayload({ tag_name: "1.6.0", draft: true }),
    ).toThrow();
    expect(() => parseReleasePayload({ body: "no tag" })).toThrow();
    expect(() => parseReleasePayload(null)).toThrow();
  });
});

describe("firstParagraph", () => {
  it("skips headings and blank lines", () => {
    expect(firstParagraph("# Title\n\n\nReal text here")).toBe(
      "Real text here",
    );
  });

  it("truncates a long line", () => {
    const long = "x".repeat(400);
    expect(firstParagraph(long, 40)).toHaveLength(40);
  });

  it("returns nothing for an empty body", () => {
    expect(firstParagraph("")).toBe("");
  });
});

describe("checkForUpdate", () => {
  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response;
  }

  it("reports an available update", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ tag_name: "v2.0.0", html_url: "https://example.test" }),
    );
    const state = await checkForUpdate("1.5.0", fetchImpl as typeof fetch);
    expect(state.status).toBe("available");
  });

  it("reports up to date when the remote is not newer", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ tag_name: "v1.5.0" }));
    const state = await checkForUpdate("1.5.0", fetchImpl as typeof fetch);
    expect(state).toEqual({ status: "current", latestVersion: "v1.5.0" });
  });

  it("turns a transport failure into a readable state", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const state = await checkForUpdate("1.5.0", fetchImpl as typeof fetch);
    expect(state).toEqual({ status: "failed", message: "offline" });
  });

  it("surfaces an HTTP error rather than parsing the body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 403));
    await expect(
      fetchLatestRelease(1000, fetchImpl as typeof fetch),
    ).rejects.toThrow("HTTP 403");
  });
});
