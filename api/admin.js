/* Everything /admin does, behind Google sign-in: the newsletter pages and
   the visits-and-conversions numbers that used to sit behind the shared
   /stats password. One function with ?action=, like /api/newsletter, to
   stay inside Hobby's function limit. GET reads; POST changes things and
   must come from our own origin. */

import {
  startLogin, finishLogin, logout, currentAdmin, sameOrigin,
} from "./_lib/session.js";
import {
  subscriberCounts, listSubscribers, allSubscribers, deleteSubscriber, importEmails,
  listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  scheduleCampaign, unscheduleCampaign, audienceSize,
  getSetting, setSetting, recordPromoCode, listPromoCodes, getPromoCode, welcomeCodeCount,
} from "./_lib/newsletter-store.js";
import {
  PRODUCTS, WELCOME, MANUAL_CAMPAIGN, makeCode, validCustomCode, describeTerms,
  mintCodes, voidCodes, lookupCodes,
} from "./_lib/promo.js";
import { THEMES, LANGS, renderNewsletter } from "./_lib/email-render.js";
import { extractEmails } from "./_lib/signup.js";
import { sendOne } from "./_lib/mail.js";
import { sendStep } from "./_lib/send-campaign.js";
import { queryEvents, deleteEvents } from "./_lib/db.js";
import { aggregate, parseRange, trend, trendRange, bestCampaign } from "./_lib/aggregate.js";

const STATUSES = ["pending", "confirmed", "unsubscribed", "bounced", "complained"];
/* Guardrails on minting by hand; see the spec's "Codes minted from /admin". */
const MAX_MINT = 50;
const MAX_USES = 1000;
/* One step from the browser; the page calls again until the send is done. */
const STEP_BUDGET_MS = 40_000;

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body ?? {};
}

function id(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/* A campaign as the editor sends it, capped and allowlisted. */
function campaignFields(b) {
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    subject: str(b.subject, 200).trim(),
    preheader: str(b.preheader, 300).trim(),
    body_md: str(b.body_md, 100_000),
    theme: Object.hasOwn(THEMES, b.theme) ? b.theme : "parchment",
    lang: LANGS.includes(b.lang) ? b.lang : null,
  };
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  /* A leading = + - @ turns a cell into a formula in a spreadsheet. */
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const GET = {
  /* Who is signed in, and nothing else — the stats page needs only this, and
     must work before the newsletter's tables exist. */
  async whoami(req, res, admin) {
    return res.json({ email: admin });
  },

  /* The range on screen, and the fixed last 60 days the growth figures
     compare within — independent of the range picked. */
  async stats(req, res) {
    const range = parseRange(req.query.from, req.query.to);
    if (!range.ok) return res.status(400).json({ error: range.error });
    const tr = trendRange();
    const [rows, trendRows] = await Promise.all([
      queryEvents(range.from, range.to),
      queryEvents(tr.from, tr.to),
    ]);
    const agg = aggregate(rows);
    return res.json({
      from: range.from.toISOString().slice(0, 10),
      to: new Date(range.to.getTime() - 86_400_000).toISOString().slice(0, 10),
      ...agg,
      trend: trend(trendRows),
      best: bestCampaign(agg.byCampaign),
    });
  },

  async me(req, res, admin) {
    return res.json({
      email: admin,
      counts: await subscriberCounts(),
      themes: Object.entries(THEMES).map(([key, t]) => ({ id: key, label: t.label })),
      langs: LANGS,
    });
  },

  async subscribers(req, res) {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
    const offset = Math.max(0, Number(req.query.offset) || 0);
    return res.json({ rows: await listSubscribers({ q, status, limit: 100, offset }) });
  },

  async export(req, res) {
    const rows = await allSubscribers();
    const cols = ["email", "lang", "source", "status", "discount_code", "created_at", "confirmed_at", "unsubscribed_at"];
    const csv = [cols.join(",")]
      .concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")))
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csv + "\n");
  },

  async campaigns(req, res) {
    return res.json({ rows: await listCampaigns() });
  },

  async campaign(req, res) {
    const c = await getCampaign(id(req.query.id));
    if (!c) return res.status(404).json({ error: "no such newsletter" });
    return res.json({ campaign: c, audience: await audienceSize(c.lang) });
  },

  /* The switch, the welcome offer's terms, and the codes minted by hand. */
  async discounts(req, res) {
    return res.json({
      welcomeOn: (await getSetting("welcome_discount")) === true,
      welcomeTerms: describeTerms(WELCOME),
      welcomeCodes: await welcomeCodeCount(),
      products: PRODUCTS,
      codes: await listPromoCodes(100),
    });
  },

  /* Live usage for the codes on screen, from the app's own table — the
     only place it is true. The cloud service being unreachable must not
     hide the rest of the page, so its failure is reported, not thrown. */
  async "code-usage"(req, res) {
    const rows = await listPromoCodes(100);
    let found;
    try {
      found = await lookupCodes(rows.map((r) => r.code));
    } catch (err) {
      return res.json({ usage: {}, error: err.message });
    }
    const now = Date.now();
    const usage = {};
    for (const r of rows) {
      const c = found[r.code];
      usage[r.id] = c
        ? {
            used: c.uses,
            max: c.max_uses,
            active: c.status === "active" && !(c.expires_at && new Date(c.expires_at).getTime() < now),
          }
        : null;
    }
    return res.json({ usage });
  },

  async audience(req, res) {
    const lang = LANGS.includes(req.query.lang) ? req.query.lang : null;
    return res.json({ audience: await audienceSize(lang) });
  },
};

const POST = {
  async logout(req, res) {
    return logout(res);
  },

  /* Scoped and bounded: one source/medium/campaign combination, within an
     explicit date range. Unlike the stats read there is no default range —
     that would make an unbounded delete reachable by omitting a field. */
  async "delete-events"(req, res, admin, b) {
    if (b.from === undefined || b.to === undefined) {
      return res.status(400).json({ error: "a date range is required" });
    }
    const range = parseRange(b.from, b.to);
    if (!range.ok) return res.status(400).json({ error: range.error });
    const deleted = await deleteEvents({
      from: range.from,
      to: range.to,
      source: b.source ?? null,
      medium: b.medium ?? null,
      campaign: b.campaign ?? null,
    });
    return res.json({ deleted });
  },

  async "welcome-discount"(req, res, admin, b) {
    if (typeof b.on !== "boolean") return res.status(400).json({ error: "on must be true or false" });
    await setSetting("welcome_discount", b.on);
    return res.json({ welcomeOn: b.on });
  },

  /* Codes by hand, in the app's own table under "site-manual". What a code
     is worth is set here now — there is no Stripe coupon standing behind it
     — so the checks are the guardrails: at most 50 at a time, a 100% code
     asked for twice, every code recorded with who minted it. */
  async "mint-codes"(req, res, admin, b) {
    const count = Number(b.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_MINT) {
      return res.status(400).json({ error: `mint between 1 and ${MAX_MINT} codes at a time` });
    }
    const pct = Number(b.discount_pct);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      return res.status(400).json({ error: "the discount is a whole percentage from 1 to 100" });
    }
    const uses = Number(b.uses);
    if (!Number.isInteger(uses) || uses < 1 || uses > MAX_USES) {
      return res.status(400).json({ error: `uses per code must be between 1 and ${MAX_USES}` });
    }
    const products = Array.isArray(b.products) ? [...new Set(b.products)] : [];
    if (!products.length || products.some((p) => !Object.hasOwn(PRODUCTS, p))) {
      return res.status(400).json({ error: "pick at least one job the code is good for" });
    }
    let maxWords = null;
    if (b.max_words !== "" && b.max_words != null) {
      maxWords = Number(b.max_words);
      if (!Number.isInteger(maxWords) || maxWords < 1) {
        return res.status(400).json({ error: "the word limit is a positive whole number, or blank" });
      }
    }
    const code = typeof b.code === "string" && b.code.trim() ? b.code.trim().toUpperCase() : null;
    if (code && count !== 1) return res.status(400).json({ error: "a code you choose can only be minted once" });
    if (code && !validCustomCode(code)) {
      return res.status(400).json({ error: "a code is 3–40 letters, digits and dashes" });
    }
    let expiresAt = null;
    if (b.expires_at) {
      expiresAt = new Date(b.expires_at);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now() + 3600_000) {
        return res.status(400).json({ error: "the expiry must be at least an hour from now" });
      }
    }
    /* A free code costs a whole job; the page must have asked twice. */
    if (pct === 100 && b.confirm_free !== true) {
      return res.status(400).json({ error: "confirm that these codes make a job free" });
    }
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";

    const codes = code ? [code] : [...new Set(Array.from({ length: count }, () => makeCode()))];
    const terms = { discount_pct: pct, max_uses: uses, products, max_words: maxWords };
    let result;
    try {
      result = await mintCodes({
        ...terms,
        codes,
        campaign: MANUAL_CAMPAIGN,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
      });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
    if (code && result.clashed.includes(code)) {
      return res.status(409).json({ error: `${code} already exists in the cloud service` });
    }
    for (const c of result.minted) {
      await recordPromoCode({
        code: c,
        terms: describeTerms(terms),
        max_redemptions: uses,
        expires_at: expiresAt,
        note: note || null,
        created_by: admin,
      });
    }
    return res.json({ minted: result.minted });
  },

  /* Voided in the app's table, which is reversible there by hand. */
  async "deactivate-code"(req, res, admin, b) {
    const row = await getPromoCode(id(b.id));
    if (!row) return res.status(404).json({ error: "no such code" });
    try {
      await voidCodes([row.code]);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
    return res.json({ deactivated: row.code });
  },

  async "delete-subscriber"(req, res, admin, b) {
    return res.json({ deleted: await deleteSubscriber(id(b.id)) });
  },

  async import(req, res, admin, b) {
    const emails = extractEmails(b.text);
    if (emails.length === 0) return res.status(400).json({ error: "no email addresses found" });
    const lang = LANGS.includes(b.lang) ? b.lang : "en";
    const added = await importEmails(emails, lang);
    return res.json({ found: emails.length, added, skipped: emails.length - added });
  },

  async "save-campaign"(req, res, admin, b) {
    const f = campaignFields(b);
    const existing = id(b.id);
    const c = existing ? await updateCampaign(existing, f) : await createCampaign(f);
    if (!c) return res.status(409).json({ error: "this newsletter has already been sent and can't be edited" });
    return res.json({ campaign: c });
  },

  async "delete-campaign"(req, res, admin, b) {
    const n = await deleteCampaign(id(b.id));
    if (!n) return res.status(409).json({ error: "only drafts and scheduled newsletters can be deleted" });
    return res.json({ deleted: n });
  },

  async preview(req, res, admin, b) {
    const { html } = renderNewsletter(campaignFields(b), { unsubscribeUrl: "#" });
    return res.json({ html });
  },

  async test(req, res, admin, b) {
    const f = campaignFields(b);
    if (!f.subject) return res.status(400).json({ error: "give it a subject first" });
    const mail = renderNewsletter(f, { unsubscribeUrl: "#" });
    await sendOne({ to: admin, ...mail, subject: `[Test] ${mail.subject}` });
    return res.json({ sentTo: admin });
  },

  async schedule(req, res, admin, b) {
    const c = await getCampaign(id(b.id));
    if (!c) return res.status(404).json({ error: "no such newsletter" });
    if (!c.subject || !c.body_md.trim()) return res.status(400).json({ error: "a newsletter needs a subject and a body" });
    const when = new Date(b.send_at);
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: "pick a date and time" });
    if (when.getTime() < Date.now() - 60_000) return res.status(400).json({ error: "that time has passed" });
    const s = await scheduleCampaign(c.id, when);
    if (!s) return res.status(409).json({ error: "this newsletter has already been sent" });
    return res.json({ campaign: s });
  },

  async unschedule(req, res, admin, b) {
    const c = await unscheduleCampaign(id(b.id));
    if (!c) return res.status(409).json({ error: "only a scheduled newsletter can be unscheduled" });
    return res.json({ campaign: c });
  },

  /* Starts a send immediately: scheduled for now, then the first step.
     The page keeps calling "send-step" until done. */
  async "send-now"(req, res, admin, b) {
    const c = await getCampaign(id(b.id));
    if (!c) return res.status(404).json({ error: "no such newsletter" });
    if (!c.subject || !c.body_md.trim()) return res.status(400).json({ error: "a newsletter needs a subject and a body" });
    if (c.status === "draft" || c.status === "scheduled") await scheduleCampaign(c.id, new Date());
    return res.json(await sendStep(c.id, STEP_BUDGET_MS));
  },

  async "send-step"(req, res, admin, b) {
    return res.json(await sendStep(id(b.id), STEP_BUDGET_MS));
  },
};

export default async function handler(req, res) {
  /* Google returns to /api/admin/callback with only ?code=&state= (or
     ?error=); the rewrite in vercel.json may or may not carry action along,
     so a return from Google is recognised by its own parameters too. */
  const fromGoogle = !req.query.action && req.query.state && (req.query.code || req.query.error);
  const action = String(fromGoogle ? "callback" : req.query.action ?? "");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET" && action === "login") return startLogin(req, res);
  if (req.method === "GET" && action === "callback") return finishLogin(req, res);

  const table = req.method === "GET" ? GET : req.method === "POST" ? POST : null;
  if (!table) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  }
  if (!Object.hasOwn(table, action)) return res.status(404).json({ error: "unknown action" });

  const admin = currentAdmin(req);
  if (!admin) return res.status(401).json({ error: "signed out" });
  if (req.method === "POST" && !sameOrigin(req)) return res.status(403).json({ error: "wrong origin" });

  try {
    return await table[action](req, res, admin, req.method === "POST" ? parseBody(req) : null);
  } catch (err) {
    console.error(`admin ${action} failed:`, err.message);
    return res.status(500).json({ error: "that failed — see the function logs" });
  }
}
