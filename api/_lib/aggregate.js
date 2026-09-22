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
  const platforms = new Map();
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

    /* Null means organic — the click carried no ad platform's id — and is
       grouped under its own label rather than dropped or folded into a
       real platform, so the two are never confused in the count. */
    const platform = row.click_platform ?? "organic";
    bump(platforms, platform, { platform }, row.event);

    const date = new Date(row.occurred_at).toISOString().slice(0, 10);
    bump(days, date, { date }, row.event);
  }

  return {
    totals,
    byCampaign: [...campaigns.values()].sort(
      (a, b) => b.downloads + b.enquiries - (a.downloads + a.enquiries),
    ),
    byAsset: [...assets.values()].sort((a, b) => b.downloads - a.downloads),
    byPlatform: [...platforms.values()].sort(
      (a, b) => b.downloads + b.enquiries - (a.downloads + a.enquiries),
    ),
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
