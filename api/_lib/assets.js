/* The only place a download URL is written down. A URL is never taken from
   the query string — that would turn /api/download into an open redirect —
   so an unknown id lands on the releases page instead.
   Asset names are fixed by the release pipeline; see TODO.md. */

const BASE = "https://github.com/SimonGrund/bethaniel/releases/latest/download";

export const RELEASES_PAGE =
  "https://github.com/SimonGrund/bethaniel/releases/latest";

export const ASSETS = Object.freeze({
  "mac-arm64": `${BASE}/Bethaniel-mac-arm64.dmg`,
  "mac-x64": `${BASE}/Bethaniel-mac-x64.dmg`,
  win: `${BASE}/Bethaniel-win.exe`,
  "linux-appimage": `${BASE}/Bethaniel-linux.AppImage`,
  "linux-deb": `${BASE}/Bethaniel-linux.deb`,
});

export function resolveAsset(id) {
  if (typeof id !== "string" || !Object.hasOwn(ASSETS, id)) {
    return { id: null, url: RELEASES_PAGE };
  }
  return { id, url: ASSETS[id] };
}
