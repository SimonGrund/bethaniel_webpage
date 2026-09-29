/* The public side of the newsletter: signing up, confirming, unsubscribing.
   One function with ?action=, not three, to stay well inside Vercel Hobby's
   limit on the number of functions. */

import { createHash } from "node:crypto";
import { validateSignup } from "./_lib/signup.js";
import { renderWelcome, escapeHtml, LANGS } from "./_lib/email-render.js";
import { sendOne, siteUrl } from "./_lib/mail.js";
import { mintPromotionCode } from "./_lib/stripe.js";
import {
  upsertPending, setDiscountCode, claimWelcome, releaseWelcome,
  byToken, confirmByToken, unsubscribeByToken, getSetting,
} from "./_lib/newsletter-store.js";

export function linkUrl(action, token) {
  return `${siteUrl()}/api/newsletter?action=${action}&t=${encodeURIComponent(token)}`;
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body ?? {};
}

async function subscribe(req, res) {
  const v = validateSignup(parseBody(req));
  if (!v.ok) return res.status(400).json({ error: v.error });
  if (v.bot) return res.status(200).json({ ok: true });

  try {
    if (!v.newsletter) {
      /* The link alone: sent, and the address forgotten. Resend keeps an
         idempotency key for 24 hours, so a key that changes every ten
         minutes lets through one email per address per ten minutes without
         this function storing the address anywhere. */
      const bucket = Math.floor(Date.now() / 600_000);
      const key = createHash("sha256").update(`${v.email}|${v.lang}|${bucket}`).digest("hex");
      const mail = renderWelcome({ lang: v.lang, source: "phone" });
      await sendOne({ to: v.email, ...mail }, `link-${key}`);
      return res.status(200).json({ ok: true });
    }

    const sub = await upsertPending(v);
    /* A bounced or complained address is told nothing different — the form
       must not become a way to test which addresses are on the list. */
    if (sub.status !== "pending" && sub.status !== "confirmed") {
      return res.status(200).json({ ok: true });
    }

    /* A code already minted is the subscriber's to keep, and is sent again
       whatever the switch says; only minting a new one is switched off. */
    let code = sub.discount_code;
    if (!code && (await getSetting("welcome_discount"))) {
      code = await setDiscountCode(sub.id, await mintPromotionCode(sub.id));
    }

    if (!(await claimWelcome(sub.id))) return res.status(200).json({ ok: true });
    try {
      const mail = renderWelcome({
        lang: v.lang,
        source: v.source,
        code,
        confirmUrl: sub.status === "pending" ? linkUrl("confirm", sub.token) : null,
        unsubscribeUrl: linkUrl("unsubscribe", sub.token),
      });
      await sendOne({ to: sub.email, ...mail, unsubscribeUrl: linkUrl("unsubscribe", sub.token) });
    } catch (err) {
      await releaseWelcome(sub.id);
      throw err;
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("newsletter subscribe failed:", err.message);
    return res.status(502).json({ error: "could not sign you up" });
  }
}

/* ── Confirm and unsubscribe pages ───────────────────────────────────── */

const PAGE = {
  en: {
    confirmTitle: "Confirm your subscription",
    confirmBody: "One click and Notes from Betty will start arriving.",
    confirmButton: "Yes, send me the newsletter",
    confirmedTitle: "You're on the list.",
    confirmedBody: "I'll be in touch. — Simon",
    unsubTitle: "Unsubscribe from Notes from Betty?",
    unsubBody: "You'll get no more newsletters. Your discount code keeps working.",
    unsubButton: "Unsubscribe",
    unsubDoneTitle: "You're unsubscribed.",
    unsubDoneBody: "You won't hear from me again. If that was a mistake, you can sign up again on the site.",
    invalidTitle: "This link no longer works.",
    invalidBody: "It may already have been used. If you meant to change your subscription, write to simon@bethaniel.eu.",
    back: "Back to Betty",
  },
  da: {
    confirmTitle: "Bekræft din tilmelding",
    confirmBody: "Ét klik, så begynder Nyt fra Betty at komme.",
    confirmButton: "Ja, send mig nyhedsbrevet",
    confirmedTitle: "Du er på listen.",
    confirmedBody: "Jeg vender tilbage. — Simon",
    unsubTitle: "Afmeld Nyt fra Betty?",
    unsubBody: "Du får ikke flere nyhedsbreve. Din rabatkode virker stadig.",
    unsubButton: "Afmeld",
    unsubDoneTitle: "Du er afmeldt.",
    unsubDoneBody: "Du hører ikke fra mig igen. Var det en fejl, kan du tilmelde dig igen på siden.",
    invalidTitle: "Dette link virker ikke længere.",
    invalidBody: "Det er måske allerede brugt. Vil du ændre din tilmelding, så skriv til simon@bethaniel.eu.",
    back: "Tilbage til Betty",
  },
  de: {
    confirmTitle: "Anmeldung bestätigen",
    confirmBody: "Ein Klick, und Neues von Betty kommt zu Ihnen.",
    confirmButton: "Ja, schicken Sie mir den Newsletter",
    confirmedTitle: "Sie stehen auf der Liste.",
    confirmedBody: "Ich melde mich. — Simon",
    unsubTitle: "Neues von Betty abbestellen?",
    unsubBody: "Sie erhalten keine Newsletter mehr. Ihr Rabattcode gilt weiterhin.",
    unsubButton: "Abbestellen",
    unsubDoneTitle: "Sie sind abgemeldet.",
    unsubDoneBody: "Sie hören nicht mehr von mir. War das ein Versehen, können Sie sich auf der Website neu anmelden.",
    invalidTitle: "Dieser Link funktioniert nicht mehr.",
    invalidBody: "Vielleicht wurde er schon benutzt. Wenn Sie Ihr Abonnement ändern möchten, schreiben Sie an simon@bethaniel.eu.",
    back: "Zurück zu Betty",
  },
  es: {
    confirmTitle: "Confirma tu suscripción",
    confirmBody: "Un clic y empezarán a llegarte las Noticias de Betty.",
    confirmButton: "Sí, envíame el boletín",
    confirmedTitle: "Ya estás en la lista.",
    confirmedBody: "Te escribiré. — Simon",
    unsubTitle: "¿Darte de baja de Noticias de Betty?",
    unsubBody: "No recibirás más boletines. Tu código de descuento sigue valiendo.",
    unsubButton: "Darme de baja",
    unsubDoneTitle: "Te has dado de baja.",
    unsubDoneBody: "No volverás a saber de mí. Si fue un error, puedes volver a suscribirte en la web.",
    invalidTitle: "Este enlace ya no funciona.",
    invalidBody: "Puede que ya se haya usado. Si querías cambiar tu suscripción, escribe a simon@bethaniel.eu.",
    back: "Volver a Betty",
  },
  fr: {
    confirmTitle: "Confirmez votre inscription",
    confirmBody: "Un clic, et Des nouvelles de Betty commencera à arriver.",
    confirmButton: "Oui, envoyez-moi la newsletter",
    confirmedTitle: "Vous êtes sur la liste.",
    confirmedBody: "Je vous écrirai. — Simon",
    unsubTitle: "Se désabonner de Des nouvelles de Betty ?",
    unsubBody: "Vous ne recevrez plus de newsletter. Votre code de réduction reste valable.",
    unsubButton: "Me désabonner",
    unsubDoneTitle: "Désinscription confirmée.",
    unsubDoneBody: "Vous n'aurez plus de mes nouvelles. Si c'était une erreur, vous pouvez vous réinscrire sur le site.",
    invalidTitle: "Ce lien ne fonctionne plus.",
    invalidBody: "Il a peut-être déjà servi. Pour modifier votre inscription, écrivez à simon@bethaniel.eu.",
    back: "Retour à Betty",
  },
};

function page(res, status, lang, title, body, form) {
  lang = LANGS.includes(lang) ? lang : "en";
  const home = lang === "en" ? "/" : `/${lang}/`;
  const action = form
    ? `<form method="post" action="${escapeHtml(form.action)}" style="margin-top:1.5rem">
         <button type="submit" class="btn btn-dark">${escapeHtml(form.label)}</button>
       </form>`
    : `<p style="margin-top:1.5rem"><a class="btn btn-outline" href="${home}">${escapeHtml(PAGE[lang].back)}</a></p>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  return res.status(status).send(`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} — Betty</title>
<link rel="icon" type="image/svg+xml" href="/Public/logo-icon.svg">
<link rel="stylesheet" href="https://fonts.bunny.net/css?family=cormorant-garamond:400,500,600,700|inter:400,500,600|jetbrains-mono:400,500&display=swap">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main style="max-width:32rem;margin:0 auto;padding:clamp(3rem,12vh,7rem) 1rem">
<p style="font-family:var(--serif);font-size:2rem;color:var(--muted)">❦</p>
<h1 style="font-family:var(--serif);font-size:2.4rem;line-height:1.15;color:var(--heading);margin:.5rem 0 1rem">${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
${action}
</main>
</body>
</html>`);
}

/* GET shows a button; only the POST acts. Mail scanners open every link in
   a message, and would otherwise confirm — or unsubscribe — for the reader. */
async function confirm(req, res) {
  const token = String(req.query.t ?? "");
  const sub = token ? await byToken(token) : null;
  const lang = sub?.lang;
  const s = PAGE[LANGS.includes(lang) ? lang : "en"];
  if (!sub || (sub.status !== "pending" && sub.status !== "confirmed")) {
    return page(res, 404, lang, s.invalidTitle, s.invalidBody);
  }
  if (req.method === "GET" && sub.status === "pending") {
    return page(res, 200, lang, s.confirmTitle, s.confirmBody, {
      action: linkUrl("confirm", token),
      label: s.confirmButton,
    });
  }
  if (req.method === "POST") await confirmByToken(token);
  return page(res, 200, lang, s.confirmedTitle, s.confirmedBody);
}

/* A POST here is either the button on the page or a mail client's RFC 8058
   one-click unsubscribe; both mean the same thing. */
async function unsubscribe(req, res) {
  const token = String(req.query.t ?? "");
  const sub = token ? await byToken(token) : null;
  const lang = sub?.lang;
  const s = PAGE[LANGS.includes(lang) ? lang : "en"];
  if (!sub) return page(res, 404, lang, s.invalidTitle, s.invalidBody);
  if (sub.status !== "pending" && sub.status !== "confirmed") {
    return page(res, 200, lang, s.unsubDoneTitle, s.unsubDoneBody);
  }
  if (req.method === "GET") {
    return page(res, 200, lang, s.unsubTitle, s.unsubBody, {
      action: linkUrl("unsubscribe", token),
      label: s.unsubButton,
    });
  }
  await unsubscribeByToken(token);
  return page(res, 200, lang, s.unsubDoneTitle, s.unsubDoneBody);
}

/* Whether the site may promise a code. The pages show the offer's wording
   only once this says yes, so switching it off in /admin takes the promise
   off the site within a minute or so, and a failed read promises nothing. */
async function offer(req, res) {
  let on = false;
  try {
    on = (await getSetting("welcome_discount")) === true;
  } catch (err) {
    console.error("newsletter offer read failed:", err.message);
  }
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json({ welcomeDiscount: on });
}

export default async function handler(req, res) {
  const action = req.query.action;
  try {
    if (action === "offer") return await offer(req, res);
    if (action === "subscribe") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).end();
      }
      return await subscribe(req, res);
    }
    if (action === "confirm" || action === "unsubscribe") {
      if (req.method !== "GET" && req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return res.status(405).end();
      }
      return await (action === "confirm" ? confirm(req, res) : unsubscribe(req, res));
    }
    return res.status(404).end();
  } catch (err) {
    console.error(`newsletter ${action} failed:`, err.message);
    return res.status(500).send("Something went wrong. Please try again, or write to simon@bethaniel.eu.");
  }
}
