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

function bump(map, key, seed, row) {
  const entry = map.get(key) ?? { ...seed, visits: 0, downloads: 0, enquiries: 0 };
  if (row.event === "download") entry.downloads += 1;
  else if (row.event === "enquiry") entry.enquiries += 1;
  else if (isVisit(row)) entry.visits += 1;
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
  const totals = { visits: 0, views: 0, downloads: 0, enquiries: 0 };
  const campaigns = new Map();
  const assets = new Map();
  const platforms = new Map();
  const days = new Map();
  const pages = new Map();

  for (const row of rows) {
    if (row.event === "download") totals.downloads += 1;
    else if (row.event === "enquiry") totals.enquiries += 1;
    else if (row.event === "view") {
      totals.views += 1;
      if (isVisit(row)) totals.visits += 1;
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
  const counted = (e) => e.visits + e.downloads + e.enquiries > 0;

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
