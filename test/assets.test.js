import test from "node:test";
import assert from "node:assert/strict";
import { ASSETS, RELEASES_PAGE, resolveAsset } from "../api/_lib/assets.js";

test("every asset id maps to a GitHub release download URL", () => {
  const ids = ["mac-arm64", "mac-x64", "win", "linux-appimage", "linux-deb"];
  assert.deepEqual(Object.keys(ASSETS).sort(), [...ids].sort());
  for (const id of ids) {
    assert.match(
      ASSETS[id],
      /^https:\/\/github\.com\/SimonGrund\/bethaniel\/releases\/latest\/download\//,
    );
  }
});

test("resolveAsset returns the id and url for a known asset", () => {
  assert.deepEqual(resolveAsset("win"), {
    id: "win",
    url: "https://github.com/SimonGrund/bethaniel/releases/latest/download/Bethaniel-win.exe",
  });
});

test("unknown, missing and non-string ids fall back to the releases page", () => {
  for (const bad of ["nope", "", null, undefined, 42, {}, []]) {
    assert.deepEqual(resolveAsset(bad), { id: null, url: RELEASES_PAGE });
  }
});

test("a url in the input is never honoured, so this cannot open-redirect", () => {
  assert.deepEqual(resolveAsset("https://evil.example.com"), {
    id: null,
    url: RELEASES_PAGE,
  });
  assert.deepEqual(resolveAsset("//evil.example.com"), {
    id: null,
    url: RELEASES_PAGE,
  });
});
