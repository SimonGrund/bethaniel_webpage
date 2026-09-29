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

/* A visit is the first page of a browser session; every other view is a
   click between pages. Only visits are counted per campaign, platform and
   day — page views on their own would reward a confusing site. */
const isVisit = (row) => row.event === "view" && row.entry === true;

/* A signup from the phone note is a request for the download link, and —
   if its box was ticked — a newsletter signup too; so one row can count
   under both. */
const isLink = (row) => row.event === "signup" && (row.form === "phone-link" || row.form === "phone-newsletter");
const isSignup = (row) => row.event === "signup" && row.form !== "phone-link";

/* Every metric a row can count toward. */
function metricsOf(row) {
  if (row.event === "download") return ["downloads"];
  if (row.event === "enquiry") return ["enquiries"];
  if (isVisit(row)) return ["visits"];
  const out = [];
  if (isLink(row)) out.push("links");
  if (isSignup(row)) out.push("signups");
  return out;
}

const zero = () => ({ visits: 0, downloads: 0, enquiries: 0, links: 0, signups: 0 });

function bump(map, key, seed, row) {
  const entry = map.get(key) ?? { ...seed, ...zero() };
  for (const m of metricsOf(row)) entry[m] += 1;
  map.set(key, entry);
}

/* Downloads per visit, as a whole percentage. Null when there were no
   visits to divide by — which is every campaign before page views were
   recorded, and must read as "unknown", not as zero. */
function rate(entry) {
  return entry.visits ? Math.round((entry.downloads / entry.visits) * 100) : null;
}

const byConversions = (a, b) =>
  b.downloads + b.enquiries - (a.downloads + a.enquiries) || b.visits - a.visits;

export function aggregate(rows) {
  const totals = { views: 0, ...zero() };
  const campaigns = new Map();
  const assets = new Map();
  const platforms = new Map();
  const days = new Map();
  const pages = new Map();

  for (const row of rows) {
    for (const m of metricsOf(row)) totals[m] += 1;
    if (row.event === "view") {
      totals.views += 1;
      /* A view whose page did not validate is stored with a null page;
         it still counts as a view, under its own label. */
      const page = row.page ?? "(unknown)";
      const entry = pages.get(page) ?? { page, views: 0, landings: 0 };
      entry.views += 1;
      if (isVisit(row)) entry.landings += 1;
      pages.set(page, entry);
    }

    /* Unattributed traffic is shown as direct/none rather than hidden —
       a blank row in the table would read as a bug. These are display
       placeholders only: the raw values (which may be null, and are kept
       alongside the display strings below) are what a delete must match,
       since a real campaign could legitimately be named "none". */
    const source = row.source ?? "direct";
    const medium = row.medium ?? "none";
    const campaign = row.campaign ?? "none";
    const seed = {
      source, medium, campaign,
      raw: { source: row.source ?? null, medium: row.medium ?? null, campaign: row.campaign ?? null },
    };
    /* Grouped by the raw values, not the display strings: a row genuinely
       carrying the source "none" and a row with a null source both display
       as "none", but they are not the same campaign and must not be merged
       into one row. JSON.stringify also keeps null distinct from the
       string "null". */
    const rawKey = JSON.stringify([seed.raw.source, seed.raw.medium, seed.raw.campaign]);
    bump(campaigns, rawKey, seed, row);

    if (row.event === "download" && row.asset) {
      const entry = assets.get(row.asset) ?? { asset: row.asset, downloads: 0 };
      entry.downloads += 1;
      assets.set(row.asset, entry);
    }

    /* Null means organic — the click carried no ad platform's id — and is
       grouped under its own label rather than dropped or folded into a
       real platform, so the two are never confused in the count. */
    const platform = row.click_platform ?? "organic";
    bump(platforms, platform, { platform }, row);

    const date = new Date(row.occurred_at).toISOString().slice(0, 10);
    bump(days, date, { date }, row);
  }

  const withRate = (entry) => ({ ...entry, rate: rate(entry) });
  /* Views after the first page bump nothing, so a group reached only by
     them would be a row of zeroes. */
  const counted = (e) => e.visits + e.downloads + e.enquiries + e.links + e.signups > 0;

  return {
    totals: { ...totals, rate: rate(totals) },
    byCampaign: [...campaigns.values()].filter(counted).sort(byConversions).map(withRate),
    byAsset: [...assets.values()].sort((a, b) => b.downloads - a.downloads),
    byPlatform: [...platforms.values()].filter(counted).sort(byConversions).map(withRate),
    /* Ties by plain code point, not localeCompare: collation of the
       punctuation these paths are made of varies between runtimes. */
    byPage: [...pages.values()].sort(
      (a, b) => b.views - a.views || (a.page < b.page ? -1 : a.page > b.page ? 1 : 0),
    ),
    daily: [...days.values()].filter(counted).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/* ── Growth ──
   The last 7 and 30 days against the 7 and 30 before them, whatever range
   the page is showing: a trend needs a fixed yardstick, and "the range you
   happened to pick" is not one. Days are UTC days ending with today, today
   included — so the current window is still filling up, and says so by
   being a little low until midnight. */
export const TREND_DAYS = 60;

export function trendRange(now = new Date()) {
  const end = new Date(atMidnightUTC(now).getTime() + DAY_MS);
  return { from: new Date(end.getTime() - TREND_DAYS * DAY_MS), to: end };
}

const METRICS = ["visits", "downloads", "enquiries", "links", "signups"];

/* Signed whole-percent change. Null when there is nothing before to
   compare with — "new", not "+∞%", and not a fake 100%. */
function change(current, previous) {
  return previous ? Math.round(((current - previous) / previous) * 100) : null;
}

export function trend(rows, now = new Date()) {
  const end = atMidnightUTC(now).getTime() + DAY_MS;
  const out = {};
  for (const days of [7, 30]) {
    const cur = zero();
    const prev = zero();
    for (const row of rows) {
      const ms = metricsOf(row);
      if (!ms.length) continue;
      const age = end - new Date(row.occurred_at).getTime();
      if (age <= 0) continue;
      for (const m of ms) {
        if (age <= days * DAY_MS) cur[m] += 1;
        else if (age <= 2 * days * DAY_MS) prev[m] += 1;
      }
    }
    out[`d${days}`] = Object.fromEntries(
      METRICS.map((m) => [m, { current: cur[m], previous: prev[m], change: change(cur[m], prev[m]) }]),
    );
  }
  return out;
}

/* ── The campaign doing best ──
   Among real campaigns only — "direct" is not a campaign anyone ran — the
   one with the most downloads, ties broken by download rate. Null until a
   campaign has at least one download: before that there is no winner, and
   naming one would be noise. "thin" marks a rate resting on too few visits
   to mean much. */
export const THIN_VISITS = 20;

export function bestCampaign(byCampaign) {
  const real = byCampaign.filter((c) => c.raw.campaign !== null && c.downloads > 0);
  if (!real.length) return null;
  real.sort((a, b) => b.downloads - a.downloads || (b.rate ?? -1) - (a.rate ?? -1));
  const best = real[0];
  return { ...best, thin: best.visits < THIN_VISITS };
}
