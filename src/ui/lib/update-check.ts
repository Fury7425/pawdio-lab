/**
 * Release check against the project's GitHub releases feed.
 *
 * The check is opt-in and manual by default: nothing is contacted until the
 * user asks, and the only thing sent is an unauthenticated GET. The result is a
 * version string and a page to open, never a download.
 */

export const UPDATE_CHECK_KEY = "pawdio-lab-update-check-v1";

export const RELEASES_API_URL =
  "https://api.github.com/repos/Fury7425/pawdio-lab/releases/latest";

export const RELEASES_PAGE_URL =
  "https://github.com/Fury7425/pawdio-lab/releases/latest";

export type UpdateInfo = {
  latestVersion: string;
  releaseUrl: string;
  summary: string;
};

export type UpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current"; latestVersion: string }
  | { status: "available"; info: UpdateInfo }
  | { status: "failed"; message: string };

/**
 * Split a version into comparable numbers. Any leading `v` and any suffix such
 * as `-beta.2` are ignored, so `v1.6.0-beta.1` and `1.6.0` compare equal.
 */
export function normalizeVersion(value: string): number[] {
  const matches = value.match(/\d+/g);
  if (!matches) return [0];
  return matches.map((part) => Number(part));
}

export function compareVersions(left: string, right: string): number {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const first = a[index] ?? 0;
    const second = b[index] ?? 0;
    if (first !== second) return first < second ? -1 : 1;
  }
  return 0;
}

export function isRemoteNewer(current: string, remote: string): boolean {
  return compareVersions(remote, current) > 0;
}

type GithubRelease = {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
};

/** Pull the fields we use out of a releases payload, rejecting drafts. */
export function parseReleasePayload(payload: unknown): UpdateInfo {
  if (!payload || typeof payload !== "object") {
    throw new Error("Release feed returned an unexpected shape.");
  }
  const release = payload as GithubRelease;
  if (release.draft === true) {
    throw new Error("Latest release is still a draft.");
  }
  const tag =
    typeof release.tag_name === "string" && release.tag_name.trim().length > 0
      ? release.tag_name.trim()
      : typeof release.name === "string"
        ? release.name.trim()
        : "";
  if (!tag) {
    throw new Error("Release feed did not include a version tag.");
  }
  const releaseUrl =
    typeof release.html_url === "string" && release.html_url.startsWith("https")
      ? release.html_url
      : RELEASES_PAGE_URL;
  const body = typeof release.body === "string" ? release.body.trim() : "";
  return {
    latestVersion: tag,
    releaseUrl,
    summary: firstParagraph(body),
  };
}

/** First non-empty, non-heading line of a release body, trimmed for display. */
export function firstParagraph(body: string, maxLength = 240): string {
  const line = body
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && !entry.startsWith("#"));
  if (!line) return "";
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

/**
 * Fetch the latest release. `timeoutMs` guards against a hung request keeping
 * the button in its checking state forever.
 */
export async function fetchLatestRelease(
  timeoutMs = 6000,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(RELEASES_API_URL, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new Error(`Release feed returned HTTP ${response.status}.`);
    }
    return parseReleasePayload(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

/** Run one check and fold the outcome into a state value for the UI. */
export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheckState> {
  try {
    const info = await fetchLatestRelease(6000, fetchImpl);
    if (isRemoteNewer(currentVersion, info.latestVersion)) {
      return { status: "available", info };
    }
    return { status: "current", latestVersion: info.latestVersion };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Update check failed.";
    return { status: "failed", message };
  }
}
