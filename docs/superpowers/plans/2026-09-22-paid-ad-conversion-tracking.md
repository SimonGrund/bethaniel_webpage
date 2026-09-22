# Paid-Ad Conversion Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which paid-ad campaign produced each app download and each enquiry, using only first-party data, and show the results on a password-protected `/stats` page.

**Architecture:** An inline `<head>` script stores campaign parameters in `sessionStorage`. Download links point at `/api/download`, which logs the conversion and then redirects to GitHub whether or not the logging worked. Forms `sendBeacon` to `/api/event` on success. Both write to one Neon Postgres table that `/api/stats` aggregates for a static `stats.html`.

**Tech Stack:** Plain HTML/CSS/JS (no build step), Vercel Functions on the Node.js runtime, Neon Postgres via `@neondatabase/serverless`, `node --test` for tests.

**Spec:** `docs/superpowers/specs/2026-09-22-paid-ad-conversion-tracking-design.md`

## Global Constraints

These apply to every task. Read them once; they are not repeated per task.

- **Never store personal data.** No IP address, no user-agent string, no visitor or device identifier, ever. Country comes only from Vercel's `x-vercel-ip-country` header; OS is reduced to `mac` / `windows` / `linux` / `other`. This is what keeps the site consent-free — do not relax it.
- **Attribution lives in `sessionStorage` only.** Never a cookie, never `localStorage`.
- **A tracking failure must never break a download.** `/api/download` redirects regardless of database outcome.
- **Never build a redirect target from user input.** `/api/download` maps an asset id through a hardcoded table; a URL is never read from the query string.
- **Exactly one runtime dependency:** `@neondatabase/serverless`. No dev dependencies — tests use Node's built-in `node --test`.
- **Every module in `api/_lib/` is pure logic with no database import**, so the test suite runs with no database and no network.
- **Client scripts must never throw.** Wrap all `sessionStorage` access and all tracking calls so a failure degrades to no attribution rather than a broken page.
- **Truncate every string field to 200 characters** before it reaches storage.
- **The site has no build step.** Do not introduce a bundler, a framework, or a transpiler.
- **Match existing code style:** 2-space indent, double-quoted strings, `const`/`let`, and the explanatory comment voice already used in `index.html`.
- **Node version:** 24.x (`node --version` → v24.16.0). ES modules throughout (`"type": "module"`).
- **Asset ids are exactly:** `mac-arm64`, `mac-x64`, `win`, `linux-appimage`, `linux-deb`.
- **Event names are exactly:** `download`, `enquiry`. Form names are exactly: `companies`, `contact`, `contact-modal`.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `package.json` | One dependency, one test script. No build step. |
| `api/_lib/attribution.js` | Parse UTM/click-ID params; decode the `a=` payload. Pure. |
| `api/_lib/assets.js` | Asset id → GitHub URL. Pure. |
| `api/_lib/validate.js` | Validate and truncate incoming event payloads. Pure. |
| `api/_lib/aggregate.js` | Shape database rows into the stats response. Pure. |
| `api/_lib/db.js` | The only module that imports the Neon driver. Insert and query. |
| `api/download.js` | Log a download, then 302 to GitHub. |
| `api/event.js` | Accept a beacon, validate, log, 204. |
| `api/stats.js` | Password check, date range, aggregate response. |
| `js/track.js` | Rewrite download hrefs; expose `Betty.track`. |
| `js/attribution-inline.js` | Reference copy of the inline `<head>` snippet (not served). |
| `stats.html` | The password-gated dashboard. |
| `db/schema.sql` | The one table, run manually against Neon. |
| `db/prune.sql` | Retention delete, run manually. |
| `test/*.test.js` | One file per `_lib` module. |

**Modified:** `index.html`, `contact.html`, `how-it-works.html`, `performance.html`, `blog.html`, `cloud-terms.html`, `TODO.md`, `.gitignore`

---

### Task 1: Project scaffold and the asset table

Sets up `package.json` and the first pure module, so every later task has a working test command.

**Files:**
- Create: `package.json`, `api/_lib/assets.js`, `test/assets.test.js`, `.gitignore` (modify)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ASSETS` — a frozen object mapping asset id → GitHub download URL.
  - `RELEASES_PAGE` — string, the fallback URL.
  - `resolveAsset(id)` → `{ id: string|null, url: string }`. Returns `{id: null, url: RELEASES_PAGE}` for anything unknown, missing, or non-string.

- [ ] **Step 1: Write the failing test**

Create `test/assets.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/assets.test.js`
Expected: FAIL — `Cannot find module '../api/_lib/assets.js'`

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "bethaniel-webpage",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.0.0"
  }
}
```

Note the bare `node --test` with no path. On Node 24 a directory argument is
read as a module entry point, so `node --test test/` dies with
`Cannot find module '…/test'` before running anything. Left alone, `--test`
discovers `test/*.test.js` by itself. A single file as an argument is fine —
that is why the per-task steps below can run `node --test test/assets.test.js`.

- [ ] **Step 4: Add `node_modules` to `.gitignore`**

`.gitignore` currently contains only `.DS_Store`. Append:

```
node_modules
```

- [ ] **Step 5: Write `api/_lib/assets.js`**

```js
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
```

- [ ] **Step 6: Install and run the test**

Run: `npm install && node --test test/assets.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore api/_lib/assets.js test/assets.test.js
git commit -m "Download URLs get one home, and it ignores the query string"
```

---

### Task 2: Attribution parsing

**Files:**
- Create: `api/_lib/attribution.js`, `test/attribution.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `UTM_KEYS` — `["source","medium","campaign","content","term"]`
  - `CLICK_IDS` — object mapping param name → platform name.
  - `parseAttribution(search, referrer, path)` → attribution object or `null` when no campaign params are present. Shape:
    `{source, medium, campaign, content, term, click_id, click_platform, landing_path, referrer_host}` — every value a string or `null`.
  - `encodeAttribution(attr)` → base64url string.
  - `decodeAttribution(str)` → attribution object, or `null` on any malformed input.
  - `truncate(value, max = 200)` → string or `null`.

- [ ] **Step 1: Write the failing test**

Create `test/attribution.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAttribution,
  encodeAttribution,
  decodeAttribution,
  truncate,
} from "../api/_lib/attribution.js";

test("truncate caps at 200 characters and passes through null", () => {
  assert.equal(truncate("a".repeat(250)).length, 200);
  assert.equal(truncate("short"), "short");
  assert.equal(truncate(null), null);
  assert.equal(truncate(undefined), null);
  assert.equal(truncate(123), null);
});

test("parses utm params into the stored shape", () => {
  const attr = parseAttribution(
    "?utm_source=google&utm_medium=cpc&utm_campaign=autumn",
    "https://www.google.com/search?q=x",
    "/",
  );
  assert.equal(attr.source, "google");
  assert.equal(attr.medium, "cpc");
  assert.equal(attr.campaign, "autumn");
  assert.equal(attr.content, null);
  assert.equal(attr.term, null);
  assert.equal(attr.landing_path, "/");
  assert.equal(attr.referrer_host, "www.google.com");
});

test("recognises each platform's click id", () => {
  const cases = [
    ["gclid", "google"],
    ["fbclid", "meta"],
    ["rdt_cid", "reddit"],
    ["li_fat_id", "linkedin"],
    ["twclid", "x"],
    ["msclkid", "microsoft"],
  ];
  for (const [param, platform] of cases) {
    const attr = parseAttribution(`?${param}=abc123`, "", "/");
    assert.equal(attr.click_id, "abc123", param);
    assert.equal(attr.click_platform, platform, param);
  }
});

test("returns null when there is nothing to attribute", () => {
  assert.equal(parseAttribution("", "", "/"), null);
  assert.equal(parseAttribution("?foo=bar", "https://example.com", "/"), null);
});

test("truncates every field it stores", () => {
  const attr = parseAttribution(`?utm_campaign=${"x".repeat(400)}`, "", "/");
  assert.equal(attr.campaign.length, 200);
});

test("a malformed referrer does not throw", () => {
  const attr = parseAttribution("?utm_source=google", "not a url", "/");
  assert.equal(attr.referrer_host, null);
});

test("encode and decode round-trip", () => {
  const attr = parseAttribution("?utm_source=meta&utm_medium=paid", "", "/");
  assert.deepEqual(decodeAttribution(encodeAttribution(attr)), attr);
});

test("decode returns null rather than throwing on junk", () => {
  for (const junk of ["", "!!!!", "eyJhIjo", null, undefined, "bnVsbA"]) {
    assert.equal(decodeAttribution(junk), null, String(junk));
  }
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/attribution.test.js`
Expected: FAIL — `Cannot find module '../api/_lib/attribution.js'`

- [ ] **Step 3: Write `api/_lib/attribution.js`**

```js
/* Campaign attribution, shared by the browser and the functions.
   Pure on purpose: no storage, no database, no window — so it runs the
   same in a test, in a Vercel function, and in the page. */

export const UTM_KEYS = ["source", "medium", "campaign", "content", "term"];

/* Which ad platform each click-id param belongs to. The id itself is stored
   as an opaque string; we never send it anywhere, it is only there to tell
   paid clicks apart from organic ones carrying the same utm_source. */
export const CLICK_IDS = Object.freeze({
  gclid: "google",
  fbclid: "meta",
  rdt_cid: "reddit",
  li_fat_id: "linkedin",
  twclid: "x",
  msclkid: "microsoft",
});

export function truncate(value, max = 200) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

function hostOf(referrer) {
  try {
    return truncate(new URL(referrer).hostname);
  } catch {
    return null;
  }
}

export function parseAttribution(search, referrer, path) {
  let params;
  try {
    params = new URLSearchParams(search || "");
  } catch {
    return null;
  }

  const attr = { landing_path: truncate(path) ?? "/" };
  let found = false;

  for (const key of UTM_KEYS) {
    const value = truncate(params.get(`utm_${key}`));
    attr[key] = value;
    if (value) found = true;
  }

  attr.click_id = null;
  attr.click_platform = null;
  for (const [param, platform] of Object.entries(CLICK_IDS)) {
    const value = truncate(params.get(param));
    if (value) {
      attr.click_id = value;
      attr.click_platform = platform;
      found = true;
      break;
    }
  }

  /* No campaign params means nothing to record. Returning null rather than
     an empty object is what lets the caller leave an earlier visit's
     attribution untouched on an internal page view. */
  if (!found) return null;

  attr.referrer_host = hostOf(referrer);
  return attr;
}

export function encodeAttribution(attr) {
  return Buffer.from(JSON.stringify(attr), "utf8").toString("base64url");
}

export function decodeAttribution(str) {
  if (typeof str !== "string" || str === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test test/attribution.test.js`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/attribution.js test/attribution.test.js
git commit -m "Read the campaign out of the URL, and nothing else"
```

---

### Task 3: Event validation

**Files:**
- Create: `api/_lib/validate.js`, `test/validate.test.js`

**Interfaces:**
- Consumes: `truncate` from `api/_lib/attribution.js`.
- Produces:
  - `EVENTS` — `["download", "enquiry"]`
  - `FORMS` — `["companies", "contact", "contact-modal"]`
  - `validateEvent(body)` → `{ ok: true, row }` or `{ ok: false, error }`.
    `row` has exactly these keys, each string or null: `event, asset, form, source, medium, campaign, content, term, click_id, click_platform, landing_path, referrer_host`.
  - `coarsePlatform(header)` → `"mac" | "windows" | "linux" | "other"`.

- [ ] **Step 1: Write the failing test**

Create `test/validate.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { validateEvent, coarsePlatform } from "../api/_lib/validate.js";

const ROW_KEYS = [
  "event", "asset", "form", "source", "medium", "campaign", "content",
  "term", "click_id", "click_platform", "landing_path", "referrer_host",
];

test("accepts a well-formed enquiry and returns the full row shape", () => {
  const result = validateEvent({
    event: "enquiry",
    props: { form: "companies" },
    attr: { source: "google", medium: "cpc", campaign: "autumn" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.row).sort(), [...ROW_KEYS].sort());
  assert.equal(result.row.event, "enquiry");
  assert.equal(result.row.form, "companies");
  assert.equal(result.row.source, "google");
  assert.equal(result.row.asset, null);
});

test("accepts a download with an asset", () => {
  const result = validateEvent({ event: "download", props: { asset: "win" } });
  assert.equal(result.ok, true);
  assert.equal(result.row.asset, "win");
  assert.equal(result.row.form, null);
});

test("rejects an event outside the allowlist", () => {
  for (const bad of ["pageview", "", null, undefined, 1, "DOWNLOAD"]) {
    const result = validateEvent({ event: bad });
    assert.equal(result.ok, false, String(bad));
  }
});

test("rejects a form outside the allowlist", () => {
  const result = validateEvent({
    event: "enquiry",
    props: { form: "newsletter" },
  });
  assert.equal(result.ok, false);
});

test("rejects an asset outside the allowlist", () => {
  const result = validateEvent({
    event: "download",
    props: { asset: "solaris" },
  });
  assert.equal(result.ok, false);
});

test("rejects a body that is not an object", () => {
  for (const bad of [null, undefined, "x", 3, []]) {
    assert.equal(validateEvent(bad).ok, false, String(bad));
  }
});

test("truncates attribution fields and drops unknown ones", () => {
  const result = validateEvent({
    event: "download",
    props: { asset: "win" },
    attr: { campaign: "y".repeat(500), evil: "dropped" },
  });
  assert.equal(result.row.campaign.length, 200);
  assert.equal("evil" in result.row, false);
});

test("coarsePlatform buckets the client hint and never returns anything else", () => {
  assert.equal(coarsePlatform('"macOS"'), "mac");
  assert.equal(coarsePlatform("macOS"), "mac");
  assert.equal(coarsePlatform('"Windows"'), "windows");
  assert.equal(coarsePlatform('"Linux"'), "linux");
  assert.equal(coarsePlatform('"Android"'), "other");
  assert.equal(coarsePlatform(""), "other");
  assert.equal(coarsePlatform(null), "other");
  assert.equal(coarsePlatform(undefined), "other");
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/validate.test.js`
Expected: FAIL — `Cannot find module '../api/_lib/validate.js'`

- [ ] **Step 3: Write `api/_lib/validate.js`**

```js
/* Everything arriving from a browser is treated as hostile. The endpoint is
   public and unauthenticated, so the defence is a narrow allowlist and hard
   length caps rather than rate limiting — see the spec's accepted risks. */

import { truncate, UTM_KEYS } from "./attribution.js";
import { ASSETS } from "./assets.js";

export const EVENTS = ["download", "enquiry"];
export const FORMS = ["companies", "contact", "contact-modal"];

const ATTR_KEYS = [
  ...UTM_KEYS,
  "click_id",
  "click_platform",
  "landing_path",
  "referrer_host",
];

/* Coarse enough that it cannot identify anyone: four buckets, no version,
   no architecture, and never the raw user-agent string. */
export function coarsePlatform(header) {
  if (typeof header !== "string") return "other";
  const value = header.toLowerCase();
  if (value.includes("mac")) return "mac";
  if (value.includes("windows")) return "windows";
  if (value.includes("linux")) return "linux";
  return "other";
}

export function validateEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }

  if (!EVENTS.includes(body.event)) {
    return { ok: false, error: "unknown event" };
  }

  const props =
    body.props && typeof body.props === "object" && !Array.isArray(body.props)
      ? body.props
      : {};

  const asset = props.asset ?? null;
  if (asset !== null && !Object.hasOwn(ASSETS, asset)) {
    return { ok: false, error: "unknown asset" };
  }

  const form = props.form ?? null;
  if (form !== null && !FORMS.includes(form)) {
    return { ok: false, error: "unknown form" };
  }

  const attr =
    body.attr && typeof body.attr === "object" && !Array.isArray(body.attr)
      ? body.attr
      : {};

  const row = { event: body.event, asset, form };
  for (const key of ATTR_KEYS) row[key] = truncate(attr[key]);

  return { ok: true, row };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test test/validate.test.js`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/validate.js test/validate.test.js
git commit -m "Treat every posted event as hostile until the allowlist clears it"
```

---

### Task 4: Database schema and access layer

**Files:**
- Create: `db/schema.sql`, `db/prune.sql`, `api/_lib/db.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `insertEvent(row, { country, ua_platform })` → `Promise<void>`. Rejects on failure; callers decide what to do.
  - `queryEvents(from, to)` → `Promise<Array<row>>` where each row is `{occurred_at, event, asset, source, medium, campaign, click_platform}`.
  - `MISSING_DATABASE_URL` — the error message used when the env var is absent.

There is no unit test for this module: it is the one place that touches the network, and mocking the Neon driver would test the mock. It is covered by the manual verification in Task 11.

- [ ] **Step 1: Write `db/schema.sql`**

```sql
-- Run once by hand against the Neon database.
-- No migration tooling: this is one table, and it does not change shape.
--
-- Deliberately absent: ip address, user-agent string, and any visitor or
-- device identifier. That absence is what keeps the site consent-free.
-- Do not add an identifying column here without revisiting the spec's
-- privacy position first.

create table if not exists events (
  id             bigserial primary key,
  occurred_at    timestamptz not null default now(),
  event          text not null,
  asset          text,
  form           text,
  source         text,
  medium         text,
  campaign       text,
  content        text,
  term           text,
  click_id       text,
  click_platform text,
  landing_path   text,
  referrer_host  text,
  country        text,
  ua_platform    text
);

create index if not exists events_occurred_at_idx on events (occurred_at);
create index if not exists events_event_idx on events (event, occurred_at);
```

- [ ] **Step 2: Write `db/prune.sql`**

```sql
-- Retention. Run by hand every few months; there is no cron job for this.
-- 400 days keeps a full year of year-on-year comparison and no more.
delete from events where occurred_at < now() - interval '400 days';
```

- [ ] **Step 3: Write `api/_lib/db.js`**

```js
/* The only module that talks to Postgres.
   neon() speaks HTTP rather than holding a TCP connection: serverless
   invocations come and go too fast for a pool, which would exhaust
   connections under any real concurrency. */

import { neon } from "@neondatabase/serverless";

export const MISSING_DATABASE_URL = "DATABASE_URL is not set";

let cached;

function sql() {
  if (!process.env.DATABASE_URL) throw new Error(MISSING_DATABASE_URL);
  cached ??= neon(process.env.DATABASE_URL);
  return cached;
}

export async function insertEvent(row, { country, ua_platform }) {
  const q = sql();
  await q`
    insert into events (
      event, asset, form, source, medium, campaign, content, term,
      click_id, click_platform, landing_path, referrer_host,
      country, ua_platform
    ) values (
      ${row.event}, ${row.asset}, ${row.form}, ${row.source}, ${row.medium},
      ${row.campaign}, ${row.content}, ${row.term}, ${row.click_id},
      ${row.click_platform}, ${row.landing_path}, ${row.referrer_host},
      ${country ?? null}, ${ua_platform ?? null}
    )
  `;
}

export async function queryEvents(from, to) {
  const q = sql();
  return await q`
    select occurred_at, event, asset, source, medium, campaign, click_platform
    from events
    where occurred_at >= ${from} and occurred_at < ${to}
    order by occurred_at
  `;
}
```

- [ ] **Step 4: Confirm the module parses**

Run: `node --input-type=module -e "import('./api/_lib/db.js').then(m => console.log(Object.keys(m).join(',')))"`
Expected: `MISSING_DATABASE_URL,insertEvent,queryEvents`

- [ ] **Step 5: Confirm the whole suite still passes**

Run: `npm test`
Expected: PASS — 20 tests pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql db/prune.sql api/_lib/db.js
git commit -m "One table, and a note about the columns it will never have"
```

---

### Task 5: The download redirect

**Files:**
- Create: `api/download.js`

**Interfaces:**
- Consumes: `resolveAsset` (Task 1), `decodeAttribution` (Task 2), `validateEvent`/`coarsePlatform` (Task 3), `insertEvent` (Task 4).
- Produces: `GET /api/download?asset=<id>&a=<base64url>` → 302.

- [ ] **Step 1: Write `api/download.js`**

```js
/* Downloads are counted here rather than with a click handler, so a blocked
   script or a missing one cannot lose the conversion.
   The rule that matters: this function redirects whether or not the insert
   worked. Neon's free tier suspends when idle, so a cold start can take a
   second — and a slow database must never be the reason a download fails. */

import { resolveAsset } from "./_lib/assets.js";
import { decodeAttribution } from "./_lib/attribution.js";
import { validateEvent, coarsePlatform } from "./_lib/validate.js";
import { insertEvent } from "./_lib/db.js";

const INSERT_TIMEOUT_MS = 250;

export default async function handler(req, res) {
  const { id, url } = resolveAsset(req.query.asset);

  try {
    const attr = decodeAttribution(req.query.a) ?? {};
    const result = validateEvent({
      event: "download",
      props: { asset: id },
      attr,
    });

    if (result.ok) {
      await Promise.race([
        insertEvent(result.row, {
          country: req.headers["x-vercel-ip-country"] ?? null,
          ua_platform: coarsePlatform(req.headers["sec-ch-ua-platform"]),
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("insert timed out")), INSERT_TIMEOUT_MS),
        ),
      ]);
    }
  } catch (err) {
    /* Swallowed on purpose. A lost row is a reporting gap; a thrown error
       here would be a broken download. */
    console.error("download tracking failed:", err.message);
  }

  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, url);
}
```

- [ ] **Step 2: Verify the redirect target logic without a server**

Run:
```bash
node --input-type=module -e "
import { resolveAsset } from './api/_lib/assets.js';
for (const id of ['mac-arm64','mac-x64','win','linux-appimage','linux-deb','bogus'])
  console.log(id.padEnd(15), resolveAsset(id).url);
"
```
Expected: the five real ids print their `.dmg`/`.exe`/`.AppImage`/`.deb` URLs, and `bogus` prints the releases page.

- [ ] **Step 3: Commit**

```bash
git add api/download.js
git commit -m "Count the download on the way past, never in the way"
```

---

### Task 6: The event endpoint

**Files:**
- Create: `api/event.js`

**Interfaces:**
- Consumes: `validateEvent`, `coarsePlatform` (Task 3), `insertEvent` (Task 4).
- Produces: `POST /api/event` → 204 on success, 405/403/400 otherwise.

- [ ] **Step 1: Write `api/event.js`**

```js
/* Beacons from forms. Downloads do not come through here — they are counted
   by the redirect in download.js, which cannot be blocked. */

import { validateEvent, coarsePlatform } from "./_lib/validate.js";
import { insertEvent } from "./_lib/db.js";

const ALLOWED_ORIGINS = [
  "https://bethaniel.eu",
  "https://www.bethaniel.eu",
  "http://localhost:3000",
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  /* Vercel preview deployments, so a branch can be checked before it ships. */
  try {
    return new URL(origin).hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).end();
  }

  /* sendBeacon posts a Blob, so the body may arrive as a string. */
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).end();
    }
  }

  const result = validateEvent(body);
  if (!result.ok) return res.status(400).end();

  try {
    await insertEvent(result.row, {
      country: req.headers["x-vercel-ip-country"] ?? null,
      ua_platform: coarsePlatform(req.headers["sec-ch-ua-platform"]),
    });
  } catch (err) {
    console.error("event insert failed:", err.message);
  }

  /* 204 either way: the page has already told the visitor their message
     was sent, and a tracking failure is not their problem. */
  return res.status(204).end();
}
```

- [ ] **Step 2: Check the origin logic**

Run:
```bash
node --input-type=module -e "
const ok = ['https://bethaniel.eu','https://betty-git-x.vercel.app'];
const no = ['https://evil.example.com', undefined, 'garbage'];
console.log('expect true :', ok.join(' '));
console.log('expect false:', no.join(' '));
"
```
Then confirm by reading `isAllowedOrigin` that the first list matches and the second does not.

- [ ] **Step 3: Commit**

```bash
git add api/event.js
git commit -m "A public endpoint that answers 204 and believes nothing"
```

---

### Task 7: The client tracker

**Files:**
- Create: `js/track.js`, `js/attribution-inline.js`

**Interfaces:**
- Consumes: nothing (standalone — it cannot import from `api/_lib/`, which is server-side ESM; the small parsing overlap is duplicated deliberately and noted in a comment).
- Produces: global `window.Betty` with `Betty.track(event, props)` and `Betty.attr()`.

- [ ] **Step 1: Write `js/attribution-inline.js`**

This is the reference copy of the snippet that gets pasted inline into each page's `<head>` in Tasks 8 and 9. It is **not** loaded by any page — keeping it in the repo means the six copies have one source of truth to be compared against.

```js
/* REFERENCE COPY — not served. The contents of this file are pasted inline
   into the <head> of every page, because it must run before any click is
   possible and an external file would cost a round-trip.
   If you change it, change all six pages: index, how-it-works, performance,
   blog, cloud-terms, contact. */
(function () {
  try {
    var p = new URLSearchParams(location.search);
    var keys = ["source", "medium", "campaign", "content", "term"];
    var clicks = {
      gclid: "google",
      fbclid: "meta",
      rdt_cid: "reddit",
      li_fat_id: "linkedin",
      twclid: "x",
      msclkid: "microsoft",
    };
    var a = { landing_path: location.pathname.slice(0, 200) };
    var found = false;
    for (var i = 0; i < keys.length; i++) {
      var v = p.get("utm_" + keys[i]);
      a[keys[i]] = v ? v.slice(0, 200) : null;
      if (v) found = true;
    }
    a.click_id = null;
    a.click_platform = null;
    for (var c in clicks) {
      var cv = p.get(c);
      if (cv) {
        a.click_id = cv.slice(0, 200);
        a.click_platform = clicks[c];
        found = true;
        break;
      }
    }
    /* No campaign params: leave whatever an earlier page stored alone.
       Last touch wins, but only when there is a touch to record. */
    if (!found) return;
    try {
      a.referrer_host = document.referrer
        ? new URL(document.referrer).hostname.slice(0, 200)
        : null;
    } catch (e) {
      a.referrer_host = null;
    }
    if (a.referrer_host === location.hostname) a.referrer_host = null;
    sessionStorage.setItem("betty_attr", JSON.stringify(a));
  } catch (e) {
    /* Storage disabled, or a URL we cannot parse. No attribution, no error. */
  }
})();
```

- [ ] **Step 2: Write `js/track.js`**

```js
/* Conversion tracking. Two jobs, and neither may ever throw: a broken
   tracker must cost a number in a report, never a download or a form.

   Attribution is read from sessionStorage, where the inline <head> snippet
   put it. sessionStorage rather than a cookie is the whole reason this site
   needs no consent banner — nothing here outlives the browser session and
   nothing identifies anyone. */
(function () {
  "use strict";

  function attr() {
    try {
      return JSON.parse(sessionStorage.getItem("betty_attr")) || {};
    } catch (e) {
      return {};
    }
  }

  function encode(obj) {
    /* base64url, so it survives a query string without escaping. The
       TextEncoder step is what makes a non-ASCII campaign name survive
       btoa, which only speaks latin-1. The payload is well under a
       kilobyte, so spreading the bytes is safe here. */
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    var b64 = btoa(String.fromCharCode.apply(null, bytes));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function track(event, props) {
    try {
      var payload = JSON.stringify({
        event: event,
        props: props || {},
        attr: attr(),
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/event",
          new Blob([payload], { type: "application/json" }),
        );
      } else {
        fetch("/api/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {
      /* Deliberately silent. */
    }
  }

  /* Hang the campaign off every download href at load. The bare href already
     works without this — it just lands as an unattributed download — so a
     failure here costs attribution, not the download. */
  function decorateDownloads() {
    try {
      var a = attr();
      if (!a || !Object.keys(a).length) return;
      var encoded = encode(a);
      var links = document.querySelectorAll("a[data-dl-asset]");
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        if (el.href.indexOf("&a=") !== -1) continue;
        el.href = "/api/download?asset=" + el.dataset.dlAsset + "&a=" + encoded;
      }
    } catch (e) {
      /* Links keep their static hrefs. */
    }
  }

  window.Betty = { track: track, attr: attr };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", decorateDownloads);
  } else {
    decorateDownloads();
  }
})();
```

- [ ] **Step 3: Check both files parse**

Run: `node --check js/track.js && node --check js/attribution-inline.js`
Expected: no output, exit status 0.

- [ ] **Step 4: Commit**

```bash
git add js/track.js js/attribution-inline.js
git commit -m "Tracking that fails quietly, because the alternative costs downloads"
```

---

### Task 8: Wire up `index.html`

The largest change. Five separate edits to one file.

**Files:**
- Modify: `index.html` — `<head>` (~line 29), download links (lines ~265–366), `#companyForm` handler (~line 1153), `#contactForm` handler (~line 1222)

**The download version-resolver script (~line 1104) needs no change.** Despite
what its surrounding comment implies, it only writes the tag name into the
"Current version" line — it sets no `href`. Read it before touching it and you
will see it never mentions a download URL.

**Interfaces:**
- Consumes: `js/attribution-inline.js` content (Task 7), `js/track.js` (Task 7), asset ids (Task 1), form names (Task 3).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the inline snippet and the tracker to `<head>`**

In `index.html`, immediately after `<link rel="stylesheet" href="style.css" />` and before `</head>`, insert:

```html
    <!-- Campaign attribution. Inline and in the head so it has run before
         any download link can be clicked. Session-scoped and anonymous —
         see docs/superpowers/specs/2026-09-22-paid-ad-conversion-tracking-design.md
         for why that is what keeps this site free of a consent banner.
         Source of truth: js/attribution-inline.js. Six pages carry a copy. -->
    <script>
      (function () {
        try {
          var p = new URLSearchParams(location.search);
          var keys = ["source", "medium", "campaign", "content", "term"];
          var clicks = { gclid: "google", fbclid: "meta", rdt_cid: "reddit", li_fat_id: "linkedin", twclid: "x", msclkid: "microsoft" };
          var a = { landing_path: location.pathname.slice(0, 200) };
          var found = false;
          for (var i = 0; i < keys.length; i++) {
            var v = p.get("utm_" + keys[i]);
            a[keys[i]] = v ? v.slice(0, 200) : null;
            if (v) found = true;
          }
          a.click_id = null;
          a.click_platform = null;
          for (var c in clicks) {
            var cv = p.get(c);
            if (cv) { a.click_id = cv.slice(0, 200); a.click_platform = clicks[c]; found = true; break; }
          }
          if (!found) return;
          try {
            a.referrer_host = document.referrer ? new URL(document.referrer).hostname.slice(0, 200) : null;
          } catch (e) { a.referrer_host = null; }
          if (a.referrer_host === location.hostname) a.referrer_host = null;
          sessionStorage.setItem("betty_attr", JSON.stringify(a));
        } catch (e) {}
      })();
    </script>
    <script src="js/track.js" defer></script>
```

- [ ] **Step 2: Repoint the five download buttons**

Change each of the five `<a>` tags in `.hero__downloads`. Only the `href` changes and one attribute is added — **leave the `id`, `class`, `hidden`, the SVG and the label text exactly as they are**, because the installer-detection script at the foot of the page keys off those ids and the i18n extractor keys the labels by their English text.

| Element id | New `href` | Add attribute |
| --- | --- | --- |
| `dl-mac` | `/api/download?asset=mac-arm64` | `data-dl-asset="mac-arm64"` |
| `dl-mac-intel` | `/api/download?asset=mac-x64` | `data-dl-asset="mac-x64"` |
| `dl-win` | `/api/download?asset=win` | `data-dl-asset="win"` |
| `dl-linux` | `/api/download?asset=linux-appimage` | `data-dl-asset="linux-appimage"` |
| `dl-linux-deb` | `/api/download?asset=linux-deb` | `data-dl-asset="linux-deb"` |

For example, `dl-mac` becomes:

```html
            <a
              href="/api/download?asset=mac-arm64"
              data-dl-asset="mac-arm64"
              id="dl-mac"
              class="btn btn-dark btn-lg"
            >
```

- [ ] **Step 3: Repoint the two "other Mac" links**

In the `#dlMacAlt` block (~line 364). The visible text must not change — the translator keys each `<p>` by its English.

```html
            <p id="dlAltIntel">Got an Intel Mac? <a href="/api/download?asset=mac-x64" data-dl-asset="mac-x64" id="dl-mac-intel-alt">Download for Intel instead.</a></p>
            <p id="dlAltSilicon" hidden>Got a Mac with Apple Silicon? <a href="/api/download?asset=mac-arm64" data-dl-asset="mac-arm64" id="dl-mac-silicon-alt">Download for Apple Silicon instead.</a></p>
```

- [ ] **Step 4: Update the comment above the download grid**

The comment at ~line 257 now says something untrue — the hrefs are no longer GitHub URLs. Replace:

```html
            <!-- Download buttons — hrefs are filled in by the version script below.
               If the GitHub API call fails they fall back to the releases page. -->
```

with:

```html
            <!-- Download buttons — each goes through /api/download, which
               records the conversion and then redirects to the GitHub asset.
               The redirect happens whether or not the recording worked, and
               the bare href works with no script at all; js/track.js only
               adds the campaign to it. -->
```

- [ ] **Step 5: Instrument the `#companyForm` handler**

In the success branch (~line 1170), directly after `e.target.reset();`, add:

```js
              if (window.Betty) Betty.track("enquiry", { form: "companies" });
```

- [ ] **Step 6: Instrument the `#contactForm` handler**

In the contact-modal script's success branch (~line 1239), directly after `form.reset();`, add:

```js
              if (window.Betty) Betty.track("enquiry", { form: "contact-modal" });
```

- [ ] **Step 7: Confirm nothing points at GitHub for downloads any more**

Run:
```bash
grep -c 'releases/latest/download' index.html
```
Expected: `0`

Run:
```bash
grep -c 'data-dl-asset' index.html
```
Expected: `7`

- [ ] **Step 8: Confirm the installer-detection script still finds every id**

Run:
```bash
for id in dl-mac dl-mac-intel dl-mac-intel-alt dl-mac-silicon-alt dl-win dl-linux dl-linux-deb; do
  printf '%-22s %s\n' "$id" "$(grep -c "id=\"$id\"" index.html)"
done
```
Expected: `1` for every id.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "Downloads go by way of the counter now"
```

---

### Task 9: Wire up the five remaining pages

**Files:**
- Modify: `contact.html`, `how-it-works.html`, `performance.html`, `blog.html`, `cloud-terms.html`

**Interfaces:**
- Consumes: the same snippet pasted in Task 8, Step 1.
- Produces: nothing.

- [ ] **Step 1: Add the snippet and tracker to all five heads**

Paste the **exact same block from Task 8, Step 1** (both `<script>` elements) immediately before `</head>` in each of: `contact.html`, `how-it-works.html`, `performance.html`, `blog.html`, `cloud-terms.html`.

These pages are entry points for ads too — someone can land on `/how-it-works` from a campaign and download from there — so all six need it, not just the home page.

- [ ] **Step 2: Instrument the contact-page form**

In `contact.html`, in the `#contactForm` success branch (~line 241), directly after the line that resets the form, add:

```js
              if (window.Betty) Betty.track("enquiry", { form: "contact" });
```

Note: `index.html` and `contact.html` both use `id="contactForm"` — the modal and the page form. They are separate files so the collision is harmless, but the values differ deliberately: `contact-modal` in `index.html`, `contact` here. Do not copy one into the other.

- [ ] **Step 3: Confirm all six pages carry the snippet**

Run:
```bash
for f in index contact how-it-works performance blog cloud-terms; do
  printf '%-14s snippet:%s tracker:%s\n' "$f" \
    "$(grep -c 'betty_attr' $f.html)" "$(grep -c 'js/track.js' $f.html)"
done
```
Expected: `snippet:1 tracker:1` for all six.

- [ ] **Step 4: Confirm the three forms are instrumented and no others are**

Run: `grep -rn 'Betty.track' index.html contact.html`
Expected: exactly three lines — `companies`, `contact-modal` in `index.html`, and `contact` in `contact.html`. The mailing-list signups must **not** appear; they are out of scope.

- [ ] **Step 5: Commit**

```bash
git add contact.html how-it-works.html performance.html blog.html cloud-terms.html
git commit -m "Every page is a landing page, so every page reads the campaign"
```

---

### Task 10: Stats aggregation, endpoint and page

**Files:**
- Create: `api/_lib/aggregate.js`, `test/aggregate.test.js`, `api/stats.js`, `stats.html`

**Interfaces:**
- Consumes: `queryEvents` (Task 4).
- Produces:
  - `parseRange(from, to, now)` → `{ok: true, from: Date, to: Date}` or `{ok: false, error}`.
  - `aggregate(rows)` → `{totals: {downloads, enquiries}, byCampaign: [...], byAsset: [...], daily: [...]}`.
    - `byCampaign` entries: `{source, medium, campaign, downloads, enquiries}`, sorted by `downloads + enquiries` descending.
    - `byAsset` entries: `{asset, downloads}`, sorted descending.
    - `daily` entries: `{date: "YYYY-MM-DD", downloads, enquiries}`, ascending, **with no gaps filled** — the page draws only the days present.

- [ ] **Step 1: Write the failing test**

Create `test/aggregate.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, parseRange } from "../api/_lib/aggregate.js";

const NOW = new Date("2026-09-22T12:00:00Z");

test("parseRange defaults to the last 30 days", () => {
  const r = parseRange(undefined, undefined, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.from.toISOString().slice(0, 10), "2026-08-24");
});

test("parseRange accepts an explicit range and makes the end exclusive", () => {
  const r = parseRange("2026-09-01", "2026-09-07", NOW);
  assert.equal(r.ok, true);
  assert.equal(r.from.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-09-08T00:00:00.000Z");
});

test("parseRange rejects junk and inverted ranges", () => {
  assert.equal(parseRange("not-a-date", "2026-09-07", NOW).ok, false);
  assert.equal(parseRange("2026-09-07", "2026-09-01", NOW).ok, false);
  assert.equal(parseRange("2026-09-01", "not-a-date", NOW).ok, false);
});

const ROWS = [
  { occurred_at: new Date("2026-09-01T10:00:00Z"), event: "download", asset: "win", source: "google", medium: "cpc", campaign: "autumn", click_platform: "google" },
  { occurred_at: new Date("2026-09-01T11:00:00Z"), event: "download", asset: "win", source: "google", medium: "cpc", campaign: "autumn", click_platform: "google" },
  { occurred_at: new Date("2026-09-02T10:00:00Z"), event: "enquiry", asset: null, source: "google", medium: "cpc", campaign: "autumn", click_platform: "google" },
  { occurred_at: new Date("2026-09-02T10:30:00Z"), event: "download", asset: "mac-arm64", source: null, medium: null, campaign: null, click_platform: null },
];

test("totals count each event type", () => {
  const out = aggregate(ROWS);
  assert.deepEqual(out.totals, { downloads: 3, enquiries: 1 });
});

test("campaigns are grouped and sorted by total conversions", () => {
  const out = aggregate(ROWS);
  assert.equal(out.byCampaign.length, 2);
  assert.deepEqual(out.byCampaign[0], {
    source: "google", medium: "cpc", campaign: "autumn",
    downloads: 2, enquiries: 1,
  });
  assert.deepEqual(out.byCampaign[1], {
    source: "direct", medium: "none", campaign: "none",
    downloads: 1, enquiries: 0,
  });
});

test("assets are counted from downloads only", () => {
  const out = aggregate(ROWS);
  assert.deepEqual(out.byAsset, [
    { asset: "win", downloads: 2 },
    { asset: "mac-arm64", downloads: 1 },
  ]);
});

test("daily series is ascending with one entry per day seen", () => {
  const out = aggregate(ROWS);
  assert.deepEqual(out.daily, [
    { date: "2026-09-01", downloads: 2, enquiries: 0 },
    { date: "2026-09-02", downloads: 1, enquiries: 1 },
  ]);
});

test("no rows yields zeroes rather than throwing", () => {
  const out = aggregate([]);
  assert.deepEqual(out.totals, { downloads: 0, enquiries: 0 });
  assert.deepEqual(out.byCampaign, []);
  assert.deepEqual(out.byAsset, []);
  assert.deepEqual(out.daily, []);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/aggregate.test.js`
Expected: FAIL — `Cannot find module '../api/_lib/aggregate.js'`

- [ ] **Step 3: Write `api/_lib/aggregate.js`**

```js
/* Shaping rows into the numbers the stats page draws. Pure, so the grouping
   rules can be tested without a database. */

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;

function atMidnightUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function parseRange(from, to, now = new Date()) {
  if (from === undefined && to === undefined) {
    const end = new Date(atMidnightUTC(now).getTime() + DAY_MS);
    return { ok: true, from: new Date(end.getTime() - DEFAULT_DAYS * DAY_MS), to: end };
  }

  const start = new Date(`${from}T00:00:00.000Z`);
  const endDay = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endDay.getTime())) {
    return { ok: false, error: "dates must be YYYY-MM-DD" };
  }
  if (endDay < start) return { ok: false, error: "range is inverted" };

  /* The end date is inclusive to a reader and exclusive to the query. */
  return { ok: true, from: start, to: new Date(endDay.getTime() + DAY_MS) };
}

function bump(map, key, seed, event) {
  const entry = map.get(key) ?? { ...seed, downloads: 0, enquiries: 0 };
  if (event === "download") entry.downloads += 1;
  else if (event === "enquiry") entry.enquiries += 1;
  map.set(key, entry);
}

export function aggregate(rows) {
  const totals = { downloads: 0, enquiries: 0 };
  const campaigns = new Map();
  const assets = new Map();
  const days = new Map();

  for (const row of rows) {
    if (row.event === "download") totals.downloads += 1;
    else if (row.event === "enquiry") totals.enquiries += 1;

    /* Unattributed traffic is shown as direct/none rather than hidden —
       a blank row in the table would read as a bug. */
    const source = row.source ?? "direct";
    const medium = row.medium ?? "none";
    const campaign = row.campaign ?? "none";
    bump(campaigns, `${source}|${medium}|${campaign}`, { source, medium, campaign }, row.event);

    if (row.event === "download" && row.asset) {
      const entry = assets.get(row.asset) ?? { asset: row.asset, downloads: 0 };
      entry.downloads += 1;
      assets.set(row.asset, entry);
    }

    const date = new Date(row.occurred_at).toISOString().slice(0, 10);
    bump(days, date, { date }, row.event);
  }

  return {
    totals,
    byCampaign: [...campaigns.values()].sort(
      (a, b) => b.downloads + b.enquiries - (a.downloads + a.enquiries),
    ),
    byAsset: [...assets.values()].sort((a, b) => b.downloads - a.downloads),
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test test/aggregate.test.js`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Write `api/stats.js`**

```js
/* Read side. The password is a shared secret guarding aggregate counts, not
   an authentication system — which is proportionate to what it protects, but
   worth knowing before anything more sensitive is put behind it. */

import { timingSafeEqual } from "node:crypto";
import { queryEvents } from "./_lib/db.js";
import { aggregate, parseRange } from "./_lib/aggregate.js";

function passwordMatches(given) {
  const expected = process.env.STATS_PASSWORD;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  /* timingSafeEqual throws on a length mismatch, so compare lengths first —
     which leaks only the length, not the contents. */
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "bad request" });
    }
  }
  body ??= {};

  if (!passwordMatches(body.password)) {
    /* A fixed pause, so a wrong password is not worth guessing at speed. */
    await new Promise((r) => setTimeout(r, 400));
    return res.status(403).json({ error: "wrong password" });
  }

  const range = parseRange(body.from, body.to);
  if (!range.ok) return res.status(400).json({ error: range.error });

  try {
    const rows = await queryEvents(range.from, range.to);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      from: range.from.toISOString().slice(0, 10),
      to: new Date(range.to.getTime() - 86_400_000).toISOString().slice(0, 10),
      ...aggregate(rows),
    });
  } catch (err) {
    console.error("stats query failed:", err.message);
    return res.status(500).json({ error: "could not read the numbers" });
  }
}
```

- [ ] **Step 6: Write `stats.html`**

Not linked from any navigation, and deliberately left out of the `PAGES` array in `tools/i18n/extract.cjs` — it is internal, and English only.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Conversions — Betty</title>
    <link rel="icon" type="image/svg+xml" href="Public/logo-icon.svg" />
    <link rel="preconnect" href="https://fonts.bunny.net" />
    <link
      rel="stylesheet"
      href="https://fonts.bunny.net/css?family=cormorant-garamond:400,600,700&family=inter:400,500,600&display=swap"
    />
    <link rel="stylesheet" href="style.css" />
    <style>
      .stats { max-width: 60rem; margin: 0 auto; padding: 3rem var(--pad-x); }
      .stats h1 { font-family: var(--serif); font-size: 2.5rem; color: var(--heading); }
      .stats__gate { max-width: 22rem; margin-top: 2rem; }
      .stats__gate input { width: 100%; padding: 0.6rem 0.75rem; border: 1px solid var(--border);
        border-radius: var(--radius); background: var(--bg); font-family: var(--sans); }
      .stats__error { color: #a04040; margin-top: 0.75rem; }
      .stats__ranges { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 2rem 0 1.5rem; }
      .stats__tiles { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 2.5rem; }
      .stats__tile { background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 1.25rem 1.75rem; min-width: 9rem; }
      .stats__tile b { display: block; font-family: var(--serif); font-size: 2.25rem;
        line-height: 1.1; color: var(--heading); }
      .stats__tile span { color: var(--muted); font-size: 0.85rem; }
      .stats h2 { font-family: var(--serif); font-size: 1.5rem; margin: 2rem 0 0.75rem; }
      .stats table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
      .stats th, .stats td { text-align: left; padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--border); }
      .stats th { color: var(--muted); font-weight: 500; }
      .stats td.num, .stats th.num { text-align: right; font-variant-numeric: tabular-nums; }
      .stats__empty { color: var(--muted); font-style: italic; }
      .stats__wrap { overflow-x: auto; }
    </style>
  </head>
  <body>
    <main class="stats">
      <h1>Conversions</h1>

      <form class="stats__gate" id="gate">
        <label for="pw">Password</label>
        <input type="password" id="pw" autocomplete="current-password" required />
        <p class="stats__error" id="gateError" hidden></p>
      </form>

      <div id="panel" hidden>
        <div class="stats__ranges">
          <button class="btn btn-outline" data-days="7">7 days</button>
          <button class="btn btn-outline" data-days="30">30 days</button>
          <button class="btn btn-outline" data-days="90">90 days</button>
          <input type="date" id="from" /> <input type="date" id="to" />
          <button class="btn btn-outline" id="applyRange">Apply</button>
        </div>

        <div class="stats__tiles">
          <div class="stats__tile"><b id="tDownloads">—</b><span>downloads</span></div>
          <div class="stats__tile"><b id="tEnquiries">—</b><span>enquiries</span></div>
          <div class="stats__tile"><b id="tRange">—</b><span>range</span></div>
        </div>

        <h2>By campaign</h2>
        <div class="stats__wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th><th>Medium</th><th>Campaign</th>
                <th class="num">Downloads</th><th class="num">Enquiries</th>
              </tr>
            </thead>
            <tbody id="campaignRows"></tbody>
          </table>
        </div>

        <h2>By installer</h2>
        <div class="stats__wrap">
          <table>
            <thead><tr><th>Installer</th><th class="num">Downloads</th></tr></thead>
            <tbody id="assetRows"></tbody>
          </table>
        </div>

        <h2>By day</h2>
        <div class="stats__wrap">
          <table>
            <thead>
              <tr><th>Date</th><th class="num">Downloads</th><th class="num">Enquiries</th></tr>
            </thead>
            <tbody id="dailyRows"></tbody>
          </table>
        </div>
      </div>
    </main>

    <script>
      (function () {
        const gate = document.getElementById("gate");
        const pw = document.getElementById("pw");
        const gateError = document.getElementById("gateError");
        const panel = document.getElementById("panel");
        let range = { days: 30 };

        function cell(text, numeric) {
          const td = document.createElement("td");
          td.textContent = text;
          if (numeric) td.className = "num";
          return td;
        }

        /* Built with createElement rather than innerHTML: these values come
           from a public endpoint anyone can post to, so they are never
           treated as markup. */
        function fill(tbody, rows, columns, emptyText) {
          tbody.replaceChildren();
          if (!rows.length) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = columns.length;
            td.className = "stats__empty";
            td.textContent = emptyText;
            tr.append(td);
            tbody.append(tr);
            return;
          }
          for (const row of rows) {
            const tr = document.createElement("tr");
            for (const [key, numeric] of columns) {
              tr.append(cell(String(row[key]), numeric));
            }
            tbody.append(tr);
          }
        }

        function render(data) {
          document.getElementById("tDownloads").textContent = data.totals.downloads;
          document.getElementById("tEnquiries").textContent = data.totals.enquiries;
          document.getElementById("tRange").textContent = `${data.from} → ${data.to}`;
          fill(document.getElementById("campaignRows"), data.byCampaign,
            [["source"], ["medium"], ["campaign"], ["downloads", true], ["enquiries", true]],
            "Nothing recorded in this range.");
          fill(document.getElementById("assetRows"), data.byAsset,
            [["asset"], ["downloads", true]], "No downloads in this range.");
          fill(document.getElementById("dailyRows"), data.daily,
            [["date"], ["downloads", true], ["enquiries", true]],
            "No activity in this range.");
        }

        function isoDaysAgo(days) {
          return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        }

        async function load() {
          const password = sessionStorage.getItem("betty_stats_pw");
          if (!password) return;
          const body = { password };
          if (range.days) {
            body.from = isoDaysAgo(range.days);
            body.to = new Date().toISOString().slice(0, 10);
          } else {
            body.from = range.from;
            body.to = range.to;
          }

          const res = await fetch("/api/stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (res.status === 403) {
            sessionStorage.removeItem("betty_stats_pw");
            panel.hidden = true;
            gate.hidden = false;
            gateError.hidden = false;
            gateError.textContent = "That password did not work.";
            return;
          }
          if (!res.ok) {
            gateError.hidden = false;
            gateError.textContent = "Could not read the numbers. Try again.";
            return;
          }

          gate.hidden = true;
          gateError.hidden = true;
          panel.hidden = false;
          render(await res.json());
        }

        gate.addEventListener("submit", (e) => {
          e.preventDefault();
          sessionStorage.setItem("betty_stats_pw", pw.value);
          pw.value = "";
          load();
        });

        document.querySelectorAll("[data-days]").forEach((btn) => {
          btn.addEventListener("click", () => {
            range = { days: Number(btn.dataset.days) };
            load();
          });
        });

        document.getElementById("applyRange").addEventListener("click", () => {
          const from = document.getElementById("from").value;
          const to = document.getElementById("to").value;
          if (from && to) {
            range = { from, to };
            load();
          }
        });

        /* Held for the session so a reload does not re-prompt. */
        if (sessionStorage.getItem("betty_stats_pw")) load();
      })();
    </script>
  </body>
</html>
```

- [ ] **Step 7: Confirm the page parses and the suite passes**

Run: `npm test`
Expected: PASS — 28 tests pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add api/_lib/aggregate.js test/aggregate.test.js api/stats.js stats.html
git commit -m "A page that answers which campaign paid for itself"
```

---

### Task 11: Provision, deploy and verify end to end

The tests cover the pure logic. This task covers what they cannot: that the redirect lands on the right file, that the beacons fire, and that a broken database still lets people download.

**Files:**
- Modify: `TODO.md`

**Interfaces:**
- Consumes: everything.
- Produces: a working deployment.

- [ ] **Step 1: Provision Neon**

In the Vercel dashboard → Storage → Marketplace → Neon, create a database and link it to this project. Vercel injects `DATABASE_URL` automatically. The free tier (0.5 GB, 100 compute-hours/month) is ample.

- [ ] **Step 2: Create the table**

Paste the contents of `db/schema.sql` into the Neon SQL editor and run it.

Verify: `select count(*) from events;` → `0`

- [ ] **Step 3: Set the stats password**

In Vercel → Settings → Environment Variables, add `STATS_PASSWORD` with a long random value, for all environments.

Generate one with: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`

- [ ] **Step 4: Deploy**

Run: `git push`

Wait for the Vercel deployment to finish.

- [ ] **Step 5: Verify every installer redirects to the right file**

Run against the deployed URL:
```bash
for a in mac-arm64 mac-x64 win linux-appimage linux-deb bogus; do
  printf '%-16s ' "$a"
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
    "https://bethaniel.eu/api/download?asset=$a"
done
```
Expected: `302` for all six. The five real ids point at `Bethaniel-mac-arm64.dmg`, `Bethaniel-mac-x64.dmg`, `Bethaniel-win.exe`, `Bethaniel-linux.AppImage` and `Bethaniel-linux.deb` respectively; `bogus` points at the releases page.

- [ ] **Step 6: Verify a campaign click is attributed**

Open `https://bethaniel.eu/?utm_source=test&utm_medium=cpc&utm_campaign=verify&gclid=abc123` in a browser, then click the download button.

Then in the Neon SQL editor:
```sql
select event, asset, source, medium, campaign, click_platform, country, ua_platform
from events order by id desc limit 1;
```
Expected: one row — `download`, the asset for your OS, `test`, `cpc`, `verify`, `google`, your country code, your OS bucket.

Confirm there is **no** column holding an IP or a user-agent string:
```sql
select column_name from information_schema.columns where table_name = 'events';
```
Expected: the 16 columns from `db/schema.sql` and nothing else.

- [ ] **Step 7: Verify the download survives a broken database**

In Vercel → Settings → Environment Variables, temporarily rename `DATABASE_URL` to `DATABASE_URL_OFF` and redeploy. Then:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  "https://bethaniel.eu/api/download?asset=win"
```
Expected: `302` to `Bethaniel-win.exe`, exactly as before. This is the single most important check in the plan — if it fails, the timeout or the `try`/`catch` in `api/download.js` is wrong.

Restore the variable name and redeploy.

- [ ] **Step 8: Verify the download works with JavaScript disabled**

Disable JavaScript in the browser, load the home page, click a download button. The download should start. No row is attributed — that is expected; check one appears with `source` null:

```sql
select event, asset, source from events order by id desc limit 1;
```

- [ ] **Step 9: Verify each form beacons**

Submit each of the three forms — the "for companies" block on the home page, the contact modal from the nav, and the contact page — with the browser's network panel open. Each should show a `POST /api/event` returning `204`.

Then:
```sql
select form, count(*) from events where event = 'enquiry' group by form;
```
Expected: three rows — `companies`, `contact-modal`, `contact`.

Confirm the mailing-list signups produce **no** rows: subscribe via the download modal and check the count above does not change.

- [ ] **Step 10: Verify the stats page**

Open `https://bethaniel.eu/stats`, enter the password, and confirm the test conversions appear under source `test`. Check that a wrong password shows the error and reveals nothing.

- [ ] **Step 11: Update `TODO.md`**

Replace the "Download links" section under "Already wired up" with:

```markdown
### Download links

Every download button points at `/api/download?asset=<id>`, which records the
conversion and then redirects to the GitHub release asset. The redirect happens
whether or not the recording worked — a slow or broken database must never cost
a download. Asset ids and their GitHub URLs live in `api/_lib/assets.js`; keep
publishing releases with exactly the asset names written there.

`js/track.js` appends the visitor's campaign to each href at page load. Without
JavaScript the bare href still works and lands as an unattributed download.

The script at the bottom of `index.html` calls the GitHub API for the latest tag
and writes it into the "Current version" line. Display only.
```

And add a new section:

```markdown
### Conversion tracking

Downloads and enquiries are recorded in a Neon Postgres table and read at
`/stats` (password in the `STATS_PASSWORD` env var on Vercel). No third-party
pixels, no cookies, no IP addresses, no user-agent strings — that absence is
what keeps the site free of a consent banner, so do not add an identifying
column without reading the spec first:
`docs/superpowers/specs/2026-09-22-paid-ad-conversion-tracking-design.md`.

Retention is manual: run `db/prune.sql` against Neon every few months.

Because there are no pixels, Google and Meta cannot optimise bidding on these
conversions. Campaigns are tuned by reading `/stats` and adjusting by hand.
```

- [ ] **Step 12: Commit**

```bash
git add TODO.md
git commit -m "Write down where the numbers come from, and what they leave out"
git push
```

---

## Verification

The whole suite, run from the repo root:

```bash
npm test
```

Expected: **28 tests pass, 0 fail** across four files — `assets` (4), `attribution` (8), `validate` (8), `aggregate` (8).

Manual checks, all in Task 11: the five redirect targets, an attributed click, a download with the database unplugged, a download with JavaScript off, the three form beacons, and the stats page.
