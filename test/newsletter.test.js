import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { validateSignup, normaliseEmail, extractEmails } from "../api/_lib/signup.js";
import { signSession, verifySession, parseCookies } from "../api/_lib/session.js";
import { verifyWebhook } from "../api/_lib/mail.js";
import {
  markdownToEmailHtml, markdownToText, renderWelcome, renderNewsletter, renderCodeEmail, renderReminder,
  THEMES, STRINGS,
} from "../api/_lib/email-render.js";
import { makeCode, describeTerms, validCustomCode, WELCOME } from "../api/_lib/promo.js";

/* ── Signup ─────────────────────────────────────────────────────────── */

test("normaliseEmail lower-cases, trims, and refuses what cannot be an address", () => {
  assert.equal(normaliseEmail("  Ann@Example.COM "), "ann@example.com");
  assert.equal(normaliseEmail("ann@example"), null);
  assert.equal(normaliseEmail("ann example@x.com"), null);
  assert.equal(normaliseEmail("a<b>@x.com"), null);
  assert.equal(normaliseEmail("a@x.com\r\nBcc: z@y.com"), null);
  assert.equal(normaliseEmail("x".repeat(250) + "@x.com"), null);
  assert.equal(normaliseEmail(42), null);
});

test("the phone note may ask for the link alone", () => {
  const v = validateSignup({ email: "a@b.co", source: "phone", newsletter: false, lang: "da" });
  assert.deepEqual(v, { ok: true, email: "a@b.co", lang: "da", source: "phone", newsletter: false });
});

test("every other form is a newsletter signup and nothing else", () => {
  assert.equal(validateSignup({ email: "a@b.co", source: "footer", newsletter: false }).ok, false);
  assert.equal(validateSignup({ email: "a@b.co", source: "download", newsletter: true }).newsletter, true);
});

test("unknown sources and languages fall back rather than being stored", () => {
  const v = validateSignup({ email: "a@b.co", source: "evil", newsletter: true, lang: "xx" });
  assert.equal(v.source, "footer");
  assert.equal(v.lang, "en");
});

test("a filled honeypot is told it succeeded, and nothing more", () => {
  assert.deepEqual(validateSignup({ email: "a@b.co", website: "spam" }), { ok: true, bot: true });
});

test("extractEmails finds each address in a CSV once", () => {
  const csv = 'email,name\n"Ann@Example.com",Ann\nbob@x.org,Bob\nann@example.com,Again\nnot-an-address,\n';
  assert.deepEqual(extractEmails(csv), ["ann@example.com", "bob@x.org"]);
});

/* ── Admin session ──────────────────────────────────────────────────── */

test("a signed session round-trips for an allowlisted address", () => {
  process.env.ADMIN_EMAILS = "simon@bethaniel.eu, other@x.com";
  const v = signSession("simon@bethaniel.eu", "s3cret");
  assert.equal(verifySession(v, "s3cret"), "simon@bethaniel.eu");
});

test("a session is refused when tampered with, expired, or no longer allowlisted", () => {
  process.env.ADMIN_EMAILS = "simon@bethaniel.eu";
  const v = signSession("simon@bethaniel.eu", "s3cret", Date.now());
  assert.equal(verifySession(v, "wrong"), null);
  const [payload, sig] = v.split(".");
  const forged = Buffer.from(JSON.stringify({ email: "simon@bethaniel.eu", exp: 9e9 })).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`, "s3cret"), null);
  assert.equal(verifySession(v, "s3cret", Date.now() + 13 * 3600 * 1000), null);
  process.env.ADMIN_EMAILS = "someone-else@x.com";
  assert.equal(verifySession(`${payload}.${sig}`, "s3cret"), null);
});

test("a session is refused when no secret is configured", () => {
  process.env.ADMIN_EMAILS = "simon@bethaniel.eu";
  assert.equal(verifySession(signSession("simon@bethaniel.eu", "s3cret"), undefined), null);
});

test("parseCookies reads a Cookie header", () => {
  assert.deepEqual(parseCookies("a=1; betty_admin=x.y%3D"), { a: "1", betty_admin: "x.y=" });
});

/* ── Webhook signatures ─────────────────────────────────────────────── */

function sign(secret, id, ts, body) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

test("a correctly signed Resend webhook verifies", () => {
  const secret = "whsec_" + Buffer.from("key material").toString("base64");
  const body = '{"type":"email.bounced"}';
  const now = 1_800_000_000;
  const headers = { "svix-id": "msg_1", "svix-timestamp": String(now), "svix-signature": "v1,bogus " + sign(secret, "msg_1", now, body) };
  assert.equal(verifyWebhook(body, headers, secret, now), true);
});

test("a webhook is refused if the body, the time, or the secret is wrong", () => {
  const secret = "whsec_" + Buffer.from("key material").toString("base64");
  const body = '{"type":"email.bounced"}';
  const now = 1_800_000_000;
  const headers = { "svix-id": "msg_1", "svix-timestamp": String(now), "svix-signature": sign(secret, "msg_1", now, body) };
  assert.equal(verifyWebhook(body + " ", headers, secret, now), false);
  assert.equal(verifyWebhook(body, headers, secret, now + 600), false);
  assert.equal(verifyWebhook(body, headers, "whsec_" + Buffer.from("other").toString("base64"), now), false);
  assert.equal(verifyWebhook(body, headers, undefined, now), false);
});

/* ── Rendering ──────────────────────────────────────────────────────── */

test("Markdown is styled inline, and '=> [x](url)' becomes a button", () => {
  const html = markdownToEmailHtml("## Hello\n\nSome **bold** text.\n\n=> [Get Betty](https://www.bethaniel.eu/?a=1&b=2)\n", THEMES.parchment);
  assert.match(html, /<h2 style="[^"]*font-family/);
  assert.match(html, /<p style="[^"]*">Some <strong style=/);
  assert.match(html, /<table role="presentation"[^>]*>.*<a style="[^"]*" href="https:\/\/www.bethaniel.eu\/\?a=1&amp;b=2">Get Betty<\/a>/s);
  /* One style attribute per link: a second is ignored, or worse. */
  assert.doesNotMatch(html, /<a [^>]*style="[^"]*"[^>]*style=/);
  assert.doesNotMatch(html, /=&gt;/);
});

test("the plain-text version unwinds buttons and links", () => {
  assert.equal(
    markdownToText("## Hi\n\n=> [Get Betty](https://x.eu)\n\nSee [the site](https://y.eu)."),
    "Hi\n\nGet Betty: https://x.eu\n\nSee the site (https://y.eu).",
  );
});

test("a newsletter carries its subject, theme kicker and unsubscribe link, escaped", () => {
  const { subject, html, text } = renderNewsletter(
    { subject: "Autumn <release>", preheader: "", body_md: "Hi.", theme: "midnight", lang: "de" },
    { unsubscribeUrl: "https://www.bethaniel.eu/api/newsletter?action=unsubscribe&t=TOK" },
  );
  assert.equal(subject, "Autumn <release>");
  assert.match(html, /Autumn &lt;release&gt;/);
  assert.match(html, /Was ist neu/);
  assert.match(html, /action=unsubscribe&amp;t=TOK/);
  assert.match(html, /background:#1c1651/);
  assert.match(text, /Abbestellen: https:\/\/www.bethaniel.eu\/api\/newsletter\?action=unsubscribe&t=TOK/);
});

test("an unknown theme falls back to parchment", () => {
  const { html } = renderNewsletter({ subject: "x", body_md: "", theme: "nope" }, { unsubscribeUrl: "#" });
  assert.match(html, new RegExp(`background:${THEMES.parchment.outer}`));
});

test("the link-only email has no code, no confirm button, and says the address was not kept", () => {
  const m = renderWelcome({ lang: "en", source: "phone" });
  assert.equal(m.subject, STRINGS.en.subjectLink);
  assert.doesNotMatch(m.html, /BETTY-/);
  assert.doesNotMatch(m.html, /Yes, send me the newsletter/);
  assert.match(m.html, /has not been kept/);
  assert.match(m.text, /https:\/\/www.bethaniel.eu\/#download/);
});

test("a pending signup's welcome has the link and the button that earns the code — never the code", () => {
  const m = renderWelcome({
    lang: "fr",
    source: "phone",
    code: "BETTY-ABCD-EFGH",
    confirmUrl: "https://c.example/confirm",
    unsubscribeUrl: "https://c.example/unsub",
    offer: true,
  });
  assert.equal(m.subject, STRINGS.fr.subjectConfirmPhoneOffer);
  assert.doesNotMatch(m.html, /BETTY-ABCD-EFGH/);
  assert.match(m.html, new RegExp(STRINGS.fr.confirmButtonOffer));
  assert.match(m.html, /href="https:\/\/c.example\/confirm"/);
  assert.match(m.html, /href="https:\/\/c.example\/unsub"/);
  assert.match(m.html, /https:\/\/www.bethaniel.eu\/fr\/#download/);
  assert.match(m.html, /lang="fr"/);
  /* On a phone the link leads: it is what they asked for. */
  assert.ok(m.html.indexOf("#download") < m.html.indexOf("c.example/confirm"));
});

test("a newsletter signup leads with the button, and the email says a reminder may follow", () => {
  const m = renderWelcome({ lang: "en", source: "footer", confirmUrl: "https://c.example/confirm", unsubscribeUrl: "https://u", offer: true });
  assert.equal(m.subject, STRINGS.en.subjectConfirmOffer);
  assert.ok(m.html.indexOf("c.example/confirm") < m.html.indexOf("#download"));
  assert.match(m.text, /one reminder/);
  assert.doesNotMatch(m.html, /BETTY-/);
});

test("a confirmed subscriber signing up again gets no confirm button", () => {
  const m = renderWelcome({ lang: "en", source: "footer", code: "BETTY-ABCD-EFGH", unsubscribeUrl: "https://u" });
  assert.equal(m.subject, STRINGS.en.subjectThanks);
  assert.doesNotMatch(m.html, /Yes, send me the newsletter/);
});

test("every language has every welcome string", () => {
  const keys = Object.keys(STRINGS.en).sort();
  for (const [lang, s] of Object.entries(STRINGS)) assert.deepEqual(Object.keys(s).sort(), keys, lang);
  for (const t of Object.values(THEMES)) assert.deepEqual(Object.keys(t.kicker).sort(), Object.keys(STRINGS).sort());
});

/* ── Discount codes ─────────────────────────────────────────────────── */

test("codes are readable: no 0/O or 1/I/L", () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode(), /^BETTY-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
});

test("with the discount switched off, the button promises only the newsletter", () => {
  const m = renderWelcome({ lang: "de", source: "footer", confirmUrl: "https://c", unsubscribeUrl: "https://u", offer: false });
  assert.equal(m.subject, STRINGS.de.subjectConfirm);
  assert.doesNotMatch(m.html, /BETTY-|50 %|50-%/);
  assert.match(m.html, new RegExp(STRINGS.de.confirmButton));
  assert.match(m.html, /href="https:\/\/c"/);
});

test("the code email carries the code, the download link and an unsubscribe link", () => {
  const m = renderCodeEmail({ lang: "da", code: "BETTY-ABCD-EFGH", unsubscribeUrl: "https://u.example" });
  assert.equal(m.subject, STRINGS.da.subjectCodeEmail);
  assert.match(m.html, /BETTY-ABCD-EFGH/);
  assert.match(m.text, /BETTY-ABCD-EFGH/);
  assert.match(m.html, /bethaniel.eu\/da\/#download/);
  assert.match(m.html, /href="https:\/\/u.example"/);
});

test("the reminder asks once, says it is the last, and never carries a code", () => {
  const on = renderReminder({ lang: "es", confirmUrl: "https://c.example", unsubscribeUrl: "https://u", offer: true });
  assert.equal(on.subject, STRINGS.es.subjectReminderOffer);
  assert.match(on.html, new RegExp(STRINGS.es.confirmButtonOffer));
  assert.match(on.html, /href="https:\/\/c.example"/);
  assert.match(on.text, new RegExp(STRINGS.es.reminderNot.slice(0, 20)));
  assert.doesNotMatch(on.html, /BETTY-/);
  const off = renderReminder({ lang: "es", confirmUrl: "https://c.example", unsubscribeUrl: "https://u", offer: false });
  assert.equal(off.subject, STRINGS.es.subjectReminder);
});

/* ── Sign-in's return address ───────────────────────────────────────── */

import { safeNext } from "../api/_lib/session.js";

test("sign-in returns only to an admin page", () => {
  assert.equal(safeNext("/admin/stats"), "/admin/stats");
  assert.equal(safeNext("/admin/newsletter"), "/admin/newsletter");
  for (const bad of ["//evil.example", "https://evil.example", "/admin/../api", "/", "/admin/stats?x=1", undefined, 7]) {
    assert.equal(safeNext(bad), "/admin/newsletter", String(bad));
  }
});

/* ── Discount codes, in the app's own cloud service ─────────────────── */

import { mintWelcomeCode, lookupCodes } from "../api/_lib/promo.js";

function stubFetch(reply) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const { status = 200, json } = reply(calls.length, calls.at(-1).body);
    return new Response(JSON.stringify(json), { status });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("a welcome code is minted under site-welcome, 50% off an edit or a readthrough, once", async () => {
  process.env.PROMO_MINT_TOKEN = "t".repeat(40);
  const f = stubFetch((n, body) => ({ json: { ok: true, minted: body.codes, clashed: [] } }));
  try {
    const code = await mintWelcomeCode();
    assert.match(code, /^BETTY-/);
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].url, /\/admin\/promo$/);
    assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${"t".repeat(40)}`);
    assert.deepEqual(f.calls[0].body, { ...WELCOME, codes: [code] });
    assert.deepEqual(WELCOME, { campaign: "site-welcome", discount_pct: 50, max_uses: 1, products: ["edit", "readthrough"] });
    /* Nothing about the subscriber leaves the site with the code. */
    assert.doesNotMatch(f.calls[0].init.body, /@/);
  } finally {
    f.restore();
  }
});

test("a clash is tried once more with a fresh code", async () => {
  process.env.PROMO_MINT_TOKEN = "t".repeat(40);
  const f = stubFetch((n, body) => ({ json: { ok: true, minted: n === 1 ? [] : body.codes, clashed: n === 1 ? body.codes : [] } }));
  try {
    const code = await mintWelcomeCode();
    assert.equal(f.calls.length, 2);
    assert.equal(code, f.calls[1].body.codes[0]);
    assert.notEqual(f.calls[0].body.codes[0], f.calls[1].body.codes[0]);
  } finally {
    f.restore();
  }
});

test("a refused token says so, instead of a bare 404", async () => {
  process.env.PROMO_MINT_TOKEN = "t".repeat(40);
  const f = stubFetch(() => ({ status: 404, json: { error: "Not found" } }));
  try {
    await assert.rejects(mintWelcomeCode(), /refused the promo token/);
  } finally {
    f.restore();
  }
});

test("no token configured fails before any request", async () => {
  delete process.env.PROMO_MINT_TOKEN;
  const f = stubFetch(() => ({ json: {} }));
  try {
    await assert.rejects(mintWelcomeCode(), /PROMO_MINT_TOKEN is not set/);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test("lookup keys the cloud service's answer by code", async () => {
  process.env.PROMO_MINT_TOKEN = "t".repeat(40);
  const f = stubFetch(() => ({ json: { ok: true, codes: [{ code: "A-BC", uses: 1, max_uses: 3, status: "active" }] } }));
  try {
    const got = await lookupCodes(["A-BC"]);
    assert.equal(got["A-BC"].uses, 1);
    assert.deepEqual(await lookupCodes([]), {});
    assert.equal(f.calls.length, 1);
  } finally {
    f.restore();
  }
});

test("terms read the way /admin shows them", () => {
  assert.equal(describeTerms(WELCOME), "50% off · copy and line edit, final readthrough · 1 use");
  assert.equal(
    describeTerms({ discount_pct: 100, products: ["translate"], max_uses: 2, max_words: 5000 }),
    "100% off · translation · 2 uses · up to 5,000 words",
  );
  assert.equal(validCustomCode("REVIEW-BOGFORUM"), true);
  assert.equal(validCustomCode("review-bogforum"), false);
});

/* ── Pressing "Confirm" ─────────────────────────────────────────────── */

import { confirmSubscription } from "../api/_lib/confirm-flow.js";

function effects(over = {}) {
  const calls = [];
  const fx = {
    offer: true,
    mintCode: async () => { calls.push("mint"); return "BETTY-NEW1-CODE"; },
    storeCode: async (c) => { calls.push(`store ${c}`); return c; },
    confirm: async () => { calls.push("confirm"); },
    sendCode: async (c) => { calls.push(`send ${c}`); },
    ...over,
  };
  return { fx, calls };
}

test("confirming mints the code before confirming, then emails it", async () => {
  const { fx, calls } = effects();
  const r = await confirmSubscription({ discount_code: null }, fx);
  assert.deepEqual(r, { ok: true, code: "BETTY-NEW1-CODE", sent: true });
  assert.deepEqual(calls, ["mint", "store BETTY-NEW1-CODE", "confirm", "send BETTY-NEW1-CODE"]);
});

test("if the code cannot be made, nothing is confirmed — pressing again retries", async () => {
  const { fx, calls } = effects({ mintCode: async () => { throw new Error("cloud service down"); } });
  const r = await confirmSubscription({ discount_code: null }, fx);
  assert.deepEqual(r, { ok: false });
  assert.equal(calls.includes("confirm"), false);
});

test("a subscriber who already has a code keeps it: no second code is minted", async () => {
  const { fx, calls } = effects();
  const r = await confirmSubscription({ discount_code: "BETTY-OLD1-CODE" }, { ...fx, offer: false });
  assert.deepEqual(r, { ok: true, code: "BETTY-OLD1-CODE", sent: true });
  assert.deepEqual(calls, ["confirm", "send BETTY-OLD1-CODE"]);
});

test("with the offer off, confirming confirms and nothing else", async () => {
  const { fx, calls } = effects({ offer: false });
  const r = await confirmSubscription({ discount_code: null }, fx);
  assert.deepEqual(r, { ok: true, code: null, sent: false });
  assert.deepEqual(calls, ["confirm"]);
});

test("a failed code email still confirms and still shows the code", async () => {
  const { fx } = effects({ sendCode: async () => { throw new Error("resend down"); } });
  const r = await confirmSubscription({ discount_code: null }, fx);
  assert.deepEqual(r, { ok: true, code: "BETTY-NEW1-CODE", sent: false });
});

test("two presses racing keep the first code stored, and show that one", async () => {
  const { fx } = effects({ storeCode: async () => "BETTY-FIRST-ONE" });
  const r = await confirmSubscription({ discount_code: null }, fx);
  assert.equal(r.code, "BETTY-FIRST-ONE");
});
