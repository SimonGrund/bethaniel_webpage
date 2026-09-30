/* Email HTML. Email clients ignore most modern CSS — Outlook renders with
   Word — so every email is the same table layout with inline styles, and a
   theme is a palette, an ornament and a kicker line, not free-form design.
   Web fonts are left out: only Apple Mail loads them, and fetching one from
   a font CDN would tell that CDN when the email was opened. */

import { marked } from "marked";
import { siteUrl } from "./mail.js";

export const LANGS = ["en", "da", "de", "es", "fr"];

const SERIF = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`;
const SANS = `-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`;

/* Each theme suits a kind of letter; the kicker above the title says which. */
export const THEMES = {
  parchment: {
    label: "Parchment — a letter",
    scheme: "light",
    outer: "#f0e8d4", paper: "#f7f1e3", text: "#2a2419", heading: "#1a140a",
    muted: "#8b7355", rule: "#c9b896", link: "#6a662b",
    button: "#1a140a", buttonText: "#f7f1e3", codeBg: "#efe6d0",
    ornament: "❦",
    kicker: { en: "A letter", da: "Et brev", de: "Ein Brief", es: "Una carta", fr: "Une lettre" },
  },
  midnight: {
    label: "Midnight — release notes",
    scheme: "light",
    outer: "#1c1651", paper: "#f7f1e3", text: "#2a2419", heading: "#1c1651",
    muted: "#5c5680", rule: "#c9c3e0", link: "#1c1651",
    button: "#1c1651", buttonText: "#f7f1e3", codeBg: "#e9e5f3",
    ornament: "✦",
    kicker: { en: "What's new", da: "Nyt i Betty", de: "Was ist neu", es: "Novedades", fr: "Quoi de neuf" },
  },
  olive: {
    label: "Olive — on the craft",
    scheme: "light",
    outer: "#e6e3c8", paper: "#f9f7ec", text: "#2a2a14", heading: "#3d3b17",
    muted: "#6a662b", rule: "#bdb98a", link: "#6a662b",
    button: "#6a662b", buttonText: "#fbf9ee", codeBg: "#eceadb",
    ornament: "❧",
    kicker: { en: "On the craft", da: "Om håndværket", de: "Zum Handwerk", es: "Sobre el oficio", fr: "Sur le métier" },
  },
  ink: {
    label: "Ink — after hours (dark)",
    scheme: "dark",
    outer: "#0f0b05", paper: "#1a140a", text: "#e9e0cc", heading: "#f7f1e3",
    muted: "#b39d7a", rule: "#4a3f2c", link: "#e0d49a",
    button: "#f7f1e3", buttonText: "#1a140a", codeBg: "#2a2419",
    ornament: "✒",
    kicker: { en: "After hours", da: "Efter fyraften", de: "Nach Feierabend", es: "A deshoras", fr: "Après les heures" },
  },
};

export function themeOf(name) {
  return THEMES[name] ?? THEMES.parchment;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* A bulletproof button: a table cell with a background, which Outlook
   draws, around a link, which everything else does. */
function button(t, href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background:${t.button};border-radius:4px;">`
    + `<a style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:600;color:${t.buttonText};text-decoration:none;" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    + `</td></tr></table>`;
}

/* marked's output, styled inline — the only styling email reliably keeps.
   A paragraph that is only "=> [Text](url)" becomes a button. */
export function markdownToEmailHtml(md, t) {
  let html = marked.parse(md ?? "", { async: false, gfm: true, breaks: false });
  html = html.replace(
    /<p>=&gt;\s*<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/p>/g,
    (_, href, text) => button(t, unescapeHref(href), stripTags(text)),
  );
  const p = `margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.65;color:${t.text};`;
  const styles = {
    p,
    h1: `margin:28px 0 12px;font-family:${SERIF};font-size:30px;line-height:1.2;font-weight:600;color:${t.heading};`,
    h2: `margin:28px 0 10px;font-family:${SERIF};font-size:25px;line-height:1.25;font-weight:600;color:${t.heading};`,
    h3: `margin:24px 0 8px;font-family:${SERIF};font-size:20px;line-height:1.3;font-weight:600;color:${t.heading};`,
    ul: `margin:0 0 16px;padding-left:22px;`,
    ol: `margin:0 0 16px;padding-left:22px;`,
    li: `margin:0 0 6px;font-family:${SANS};font-size:16px;line-height:1.6;color:${t.text};`,
    blockquote: `margin:0 0 16px;padding:2px 0 2px 16px;border-left:3px solid ${t.rule};font-style:italic;`,
    hr: `border:0;border-top:1px solid ${t.rule};margin:28px 0;`,
    code: `font-family:Menlo,Consolas,monospace;font-size:14px;background:${t.codeBg};padding:1px 4px;border-radius:3px;`,
    pre: `margin:0 0 16px;padding:12px;background:${t.codeBg};border-radius:4px;overflow:auto;`,
    strong: `color:${t.heading};`,
  };
  for (const [tag, style] of Object.entries(styles)) {
    html = html.replace(new RegExp(`<${tag}>`, "g"), `<${tag} style="${style}">`);
    if (tag === "ol") html = html.replace(/<ol start="(\d+)">/g, `<ol start="$1" style="${style}">`);
  }
  /* Only marked's own links start "<a href="; a button's starts with its
     style, so it is not restyled as a text link here. */
  html = html.replace(/<a href=/g, `<a style="color:${t.link};text-decoration:underline;" href=`);
  html = html.replace(/<img /g, `<img style="display:block;max-width:100%;height:auto;border:0;margin:0 0 16px;" `);
  return html;
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function unescapeHref(s) {
  return s.replace(/&amp;/g, "&");
}

/* Markdown is already a readable plain-text format; only the button
   shorthand and link syntax need unwinding. */
export function markdownToText(md) {
  return (md ?? "")
    .replace(/^=>[ 	]*\[([^\]]*)\]\(([^)]*)\)[ 	]*$/gm, "$1: $2")
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
}

/* The ornament is followed by U+FE0E, which asks for the plain text glyph:
   without it Windows and some mail apps draw ❦ and ✒ as colour emoji. */
function layout({ t, lang, preheader, kicker, title, bodyHtml, footerHtml }) {
  /* The preheader is the grey line an inbox shows after the subject. The
     trailing spacers stop the client padding it out with body text. */
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}${"&#8199;&#847;".repeat(40)}</div>`
    : "";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${t.scheme} only">
<meta name="supported-color-schemes" content="${t.scheme} only">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${t.outer};">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.outer};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${t.paper};border-radius:10px;">
<tr><td style="padding:36px 36px 8px;text-align:center;">
<div style="font-family:${SERIF};font-size:26px;line-height:1;color:${t.muted};">${t.ornament}&#xFE0E;</div>
<div style="margin-top:10px;font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${t.muted};">${escapeHtml(kicker)}</div>
<h1 style="margin:10px 0 0;font-family:${SERIF};font-size:34px;line-height:1.15;font-weight:600;color:${t.heading};">${escapeHtml(title)}</h1>
<div style="width:48px;margin:22px auto 0;border-top:1px solid ${t.rule};"></div>
</td></tr>
<tr><td style="padding:24px 36px 12px;">
${bodyHtml}
</td></tr>
<tr><td style="padding:8px 36px 32px;">
<div style="border-top:1px solid ${t.rule};padding-top:18px;font-family:${SANS};font-size:12px;line-height:1.6;color:${t.muted};">
${footerHtml}
</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/* ── Newsletters ─────────────────────────────────────────────────────── */

export function renderNewsletter(campaign, { unsubscribeUrl }) {
  const t = themeOf(campaign.theme);
  const lang = LANGS.includes(campaign.lang) ? campaign.lang : "en";
  const s = STRINGS[lang];
  const unsub = unsubscribeUrl || "#";
  const html = layout({
    t,
    lang,
    preheader: campaign.preheader,
    kicker: t.kicker[lang],
    title: campaign.subject,
    bodyHtml: markdownToEmailHtml(campaign.body_md, t),
    footerHtml: `${escapeHtml(s.nlFooter)} ${footerLink(t, unsub, s.unsubscribe)} · ${footerLink(t, privacyUrl(lang), s.privacy)}`,
  });
  const text = `${campaign.subject}\n\n${markdownToText(campaign.body_md)}\n\n—\n${s.nlFooter}\n${s.unsubscribe}: ${unsub}\n${s.privacy}: ${privacyUrl(lang)}\n`;
  return { subject: campaign.subject, html, text };
}

/* ── The welcome email ───────────────────────────────────────────────── */

/* What the welcome code covers is WELCOME in promo.js; if that changes,
   `codeBody` here is the one line to change with it. */
export const STRINGS = {
  en: {
    subjectCode: "Your link to Betty, and half off your first edit",
    subjectLink: "Your link to Betty",
    subjectWelcome: "Welcome to Notes from Betty",
    subjectThanks: "Welcome to Notes from Betty, with half off your first edit",
    leadPhone: "Here's Betty, for your computer.",
    bodyPhone: "Betty runs on macOS, Windows and Linux. Open this email on your computer and download her from here:",
    leadThanks: "Thanks for signing up.",
    bodyThanks: "If you haven't got Betty yet, she's here:",
    download: "Download Betty",
    codeHead: "Half price, once",
    codeBody: "Your code for 50% off one copy-edit or final readthrough in the cloud:",
    codeHow: "Enter it at checkout in Betty. It works once, and it's yours.",
    confirmHead: "One more click",
    confirmBody: "Notes from Betty is a short letter about updates and new features. If you'd like it, say so:",
    confirmButton: "Yes, send me the newsletter",
    confirmNot: "If not, do nothing: you'll get one reminder in a few days, then nothing more.",
    footer: "You're getting this because this address was entered at bethaniel.eu.",
    footerLink: "You asked for this link at bethaniel.eu. Your address has not been kept.",
    nlFooter: "You're getting Notes from Betty because you signed up at bethaniel.eu.",
    unsubscribe: "Unsubscribe",
    privacy: "Privacy policy",
    sign: "— Simon",
    subjectConfirmPhoneOffer: "Your link to Betty — and one click for 50% off",
    subjectConfirmPhone: "Your link to Betty — and one click for the newsletter",
    subjectConfirmOffer: "One click for Notes from Betty — and 50% off",
    subjectConfirm: "One click to confirm Notes from Betty",
    leadConfirm: "One click, and you're on the list.",
    confirmBodyOffer: "One click confirms Notes from Betty — a short letter about updates and new features — and your code for 50% off one copy-edit or final readthrough in the cloud arrives straight away.",
    confirmButtonOffer: "Confirm and get your 50% code",
    subjectCodeEmail: "Your 50% code for Betty",
    codeLead: "You're on the list.",
    codeThanks: "Thanks for confirming.",
    subjectReminderOffer: "Your 50% code is still waiting",
    subjectReminder: "Still want Notes from Betty?",
    reminderLead: "Still interested?",
    reminderBody: "A few days ago this address was signed up for Notes from Betty at bethaniel.eu, but it hasn't been confirmed.",
    reminderNot: "If that wasn't you, or you've changed your mind, do nothing. This is the last you'll hear from us.",
  },
  da: {
    subjectCode: "Dit link til Betty – og halv pris på din første redigering",
    subjectLink: "Dit link til Betty",
    subjectWelcome: "Velkommen til Nyt fra Betty",
    subjectThanks: "Velkommen til Nyt fra Betty – med halv pris på din første redigering",
    leadPhone: "Her er Betty, til din computer.",
    bodyPhone: "Betty kører på macOS, Windows og Linux. Åbn denne e-mail på din computer, og download hende her:",
    leadThanks: "Tak for din tilmelding.",
    bodyThanks: "Hvis du ikke har Betty endnu, finder du hende her:",
    download: "Download Betty",
    codeHead: "Halv pris, én gang",
    codeBody: "Din kode til 50 % rabat på én korrektur eller én afsluttende gennemlæsning i skyen:",
    codeHow: "Indtast den ved betalingen i Betty. Den virker én gang, og den er din.",
    confirmHead: "Ét klik mere",
    confirmBody: "Nyt fra Betty er et kort brev om opdateringer og nye funktioner. Hvis du vil have det, så sig til:",
    confirmButton: "Ja, send mig nyhedsbrevet",
    confirmNot: "Hvis ikke, skal du ikke gøre noget: du får én påmindelse om et par dage og derefter ikke mere.",
    footer: "Du får denne e-mail, fordi adressen blev indtastet på bethaniel.eu.",
    footerLink: "Du bad om dette link på bethaniel.eu. Din adresse er ikke gemt.",
    nlFooter: "Du får Nyt fra Betty, fordi du har tilmeldt dig på bethaniel.eu.",
    unsubscribe: "Afmeld",
    privacy: "Privatlivspolitik",
    sign: "— Simon",
    subjectConfirmPhoneOffer: "Dit link til Betty – og ét klik til 50 % rabat",
    subjectConfirmPhone: "Dit link til Betty – og ét klik til nyhedsbrevet",
    subjectConfirmOffer: "Ét klik til Nyt fra Betty – og 50 % rabat",
    subjectConfirm: "Ét klik for at bekræfte Nyt fra Betty",
    leadConfirm: "Ét klik, så er du på listen.",
    confirmBodyOffer: "Ét klik bekræfter Nyt fra Betty – et kort brev om opdateringer og nye funktioner – og din kode til 50 % rabat på én korrektur eller én afsluttende gennemlæsning i skyen kommer med det samme.",
    confirmButtonOffer: "Bekræft og få din kode på 50 %",
    subjectCodeEmail: "Din kode til 50 % rabat på Betty",
    codeLead: "Du er på listen.",
    codeThanks: "Tak, fordi du bekræftede.",
    subjectReminderOffer: "Din kode til 50 % rabat venter stadig",
    subjectReminder: "Vil du stadig have Nyt fra Betty?",
    reminderLead: "Stadig interesseret?",
    reminderBody: "For et par dage siden blev denne adresse tilmeldt Nyt fra Betty på bethaniel.eu, men tilmeldingen er ikke bekræftet.",
    reminderNot: "Hvis det ikke var dig, eller du har fortrudt, skal du ikke gøre noget. Du hører ikke fra os igen.",
  },
  de: {
    subjectCode: "Ihr Link zu Betty – und die Hälfte Rabatt auf Ihr erstes Lektorat",
    subjectLink: "Ihr Link zu Betty",
    subjectWelcome: "Willkommen bei Neues von Betty",
    subjectThanks: "Willkommen bei Neues von Betty – mit halbem Preis für Ihr erstes Lektorat",
    leadPhone: "Hier ist Betty, für Ihren Computer.",
    bodyPhone: "Betty läuft unter macOS, Windows und Linux. Öffnen Sie diese E-Mail an Ihrem Computer und laden Sie sie hier herunter:",
    leadThanks: "Danke für Ihre Anmeldung.",
    bodyThanks: "Falls Sie Betty noch nicht haben, finden Sie sie hier:",
    download: "Betty herunterladen",
    codeHead: "Halber Preis, einmal",
    codeBody: "Ihr Code für 50 % Rabatt auf ein Korrektorat oder eine Schlussdurchsicht in der Cloud:",
    codeHow: "Geben Sie ihn beim Bezahlen in Betty ein. Er gilt einmal und nur für Sie.",
    confirmHead: "Noch ein Klick",
    confirmBody: "Neues von Betty ist ein kurzer Brief über Updates und neue Funktionen. Wenn Sie ihn möchten, sagen Sie es:",
    confirmButton: "Ja, schicken Sie mir den Newsletter",
    confirmNot: "Wenn nicht, tun Sie einfach nichts: Sie erhalten in ein paar Tagen eine Erinnerung und danach nichts mehr.",
    footer: "Sie erhalten diese E-Mail, weil diese Adresse auf bethaniel.eu eingegeben wurde.",
    footerLink: "Sie haben diesen Link auf bethaniel.eu angefordert. Ihre Adresse wurde nicht gespeichert.",
    nlFooter: "Sie erhalten Neues von Betty, weil Sie sich auf bethaniel.eu angemeldet haben.",
    unsubscribe: "Abbestellen",
    privacy: "Datenschutzerklärung",
    sign: "— Simon",
    subjectConfirmPhoneOffer: "Ihr Link zu Betty – und ein Klick für 50 % Rabatt",
    subjectConfirmPhone: "Ihr Link zu Betty – und ein Klick zum Newsletter",
    subjectConfirmOffer: "Ein Klick für Neues von Betty – und 50 % Rabatt",
    subjectConfirm: "Ein Klick, um Neues von Betty zu bestätigen",
    leadConfirm: "Ein Klick, und Sie stehen auf der Liste.",
    confirmBodyOffer: "Ein Klick bestätigt Neues von Betty – einen kurzen Brief über Updates und neue Funktionen –, und Ihr Code für 50 % Rabatt auf ein Korrektorat oder eine Schlussdurchsicht in der Cloud kommt sofort.",
    confirmButtonOffer: "Bestätigen und 50-%-Code erhalten",
    subjectCodeEmail: "Ihr 50-%-Code für Betty",
    codeLead: "Sie stehen auf der Liste.",
    codeThanks: "Danke für Ihre Bestätigung.",
    subjectReminderOffer: "Ihr 50-%-Code wartet noch",
    subjectReminder: "Möchten Sie Neues von Betty noch erhalten?",
    reminderLead: "Noch interessiert?",
    reminderBody: "Vor ein paar Tagen wurde diese Adresse auf bethaniel.eu für Neues von Betty angemeldet, die Anmeldung aber nicht bestätigt.",
    reminderNot: "Wenn Sie das nicht waren oder es sich anders überlegt haben, tun Sie nichts. Dann hören Sie nicht mehr von uns.",
  },
  es: {
    subjectCode: "Tu enlace a Betty, y la mitad de precio en tu primera corrección",
    subjectLink: "Tu enlace a Betty",
    subjectWelcome: "Te damos la bienvenida a Noticias de Betty",
    subjectThanks: "Te damos la bienvenida a Noticias de Betty, con la mitad de precio en tu primera corrección",
    leadPhone: "Aquí tienes a Betty, para tu ordenador.",
    bodyPhone: "Betty funciona en macOS, Windows y Linux. Abre este correo en tu ordenador y descárgala desde aquí:",
    leadThanks: "Gracias por suscribirte.",
    bodyThanks: "Si aún no tienes a Betty, está aquí:",
    download: "Descargar Betty",
    codeHead: "A mitad de precio, una vez",
    codeBody: "Tu código para un 50 % de descuento en una corrección de estilo o una lectura final en la nube:",
    codeHow: "Introdúcelo al pagar en Betty. Sirve una vez, y es tuyo.",
    confirmHead: "Un clic más",
    confirmBody: "Noticias de Betty es una carta breve sobre actualizaciones y novedades. Si la quieres, dímelo:",
    confirmButton: "Sí, envíame el boletín",
    confirmNot: "Si no, no hagas nada: recibirás un recordatorio dentro de unos días y nada más.",
    footer: "Recibes esto porque esta dirección se introdujo en bethaniel.eu.",
    footerLink: "Pediste este enlace en bethaniel.eu. Tu dirección no se ha guardado.",
    nlFooter: "Recibes Noticias de Betty porque te suscribiste en bethaniel.eu.",
    unsubscribe: "Darse de baja",
    privacy: "Política de privacidad",
    sign: "— Simon",
    subjectConfirmPhoneOffer: "Tu enlace a Betty, y un clic para un 50 % de descuento",
    subjectConfirmPhone: "Tu enlace a Betty, y un clic para el boletín",
    subjectConfirmOffer: "Un clic para Noticias de Betty, y un 50 % de descuento",
    subjectConfirm: "Un clic para confirmar Noticias de Betty",
    leadConfirm: "Un clic y estarás en la lista.",
    confirmBodyOffer: "Un clic confirma Noticias de Betty —una carta breve sobre actualizaciones y novedades— y tu código con un 50 % de descuento en una corrección de estilo o una lectura final en la nube llega al instante.",
    confirmButtonOffer: "Confirmar y recibir mi código del 50 %",
    subjectCodeEmail: "Tu código del 50 % para Betty",
    codeLead: "Ya estás en la lista.",
    codeThanks: "Gracias por confirmar.",
    subjectReminderOffer: "Tu código del 50 % sigue esperándote",
    subjectReminder: "¿Sigues queriendo Noticias de Betty?",
    reminderLead: "¿Te sigue interesando?",
    reminderBody: "Hace unos días esta dirección se suscribió a Noticias de Betty en bethaniel.eu, pero la suscripción no se ha confirmado.",
    reminderNot: "Si no fuiste tú, o has cambiado de opinión, no hagas nada. No volverás a saber de nosotros.",
  },
  fr: {
    subjectCode: "Votre lien vers Betty, et moitié prix sur votre première correction",
    subjectLink: "Votre lien vers Betty",
    subjectWelcome: "Bienvenue dans Des nouvelles de Betty",
    subjectThanks: "Bienvenue dans Des nouvelles de Betty, avec moitié prix sur votre première correction",
    leadPhone: "Voici Betty, pour votre ordinateur.",
    bodyPhone: "Betty fonctionne sous macOS, Windows et Linux. Ouvrez cet e-mail sur votre ordinateur et téléchargez-la ici :",
    leadThanks: "Merci de votre inscription.",
    bodyThanks: "Si vous n'avez pas encore Betty, elle est ici :",
    download: "Télécharger Betty",
    codeHead: "Moitié prix, une fois",
    codeBody: "Votre code pour 50 % de réduction sur une correction ou une relecture finale dans le cloud :",
    codeHow: "Saisissez-le au paiement dans Betty. Il sert une fois, et il est à vous.",
    confirmHead: "Encore un clic",
    confirmBody: "Des nouvelles de Betty est une courte lettre sur les mises à jour et les nouveautés. Si vous la voulez, dites-le :",
    confirmButton: "Oui, envoyez-moi la newsletter",
    confirmNot: "Sinon, ne faites rien : vous recevrez un rappel dans quelques jours, puis plus rien.",
    footer: "Vous recevez ceci parce que cette adresse a été saisie sur bethaniel.eu.",
    footerLink: "Vous avez demandé ce lien sur bethaniel.eu. Votre adresse n'a pas été conservée.",
    nlFooter: "Vous recevez Des nouvelles de Betty parce que cette adresse est inscrite sur bethaniel.eu.",
    unsubscribe: "Se désabonner",
    privacy: "Politique de confidentialité",
    sign: "— Simon",
    subjectConfirmPhoneOffer: "Votre lien vers Betty, et un clic pour 50 % de réduction",
    subjectConfirmPhone: "Votre lien vers Betty, et un clic pour la newsletter",
    subjectConfirmOffer: "Un clic pour Des nouvelles de Betty, et 50 % de réduction",
    subjectConfirm: "Un clic pour confirmer Des nouvelles de Betty",
    leadConfirm: "Un clic, et vous êtes sur la liste.",
    confirmBodyOffer: "Un clic confirme Des nouvelles de Betty — une courte lettre sur les mises à jour et les nouveautés — et votre code de 50 % de réduction sur une correction ou une relecture finale dans le cloud arrive aussitôt.",
    confirmButtonOffer: "Confirmer et recevoir mon code de 50 %",
    subjectCodeEmail: "Votre code de 50 % pour Betty",
    codeLead: "Vous êtes sur la liste.",
    codeThanks: "Merci de votre confirmation.",
    subjectReminderOffer: "Votre code de 50 % vous attend toujours",
    subjectReminder: "Voulez-vous toujours recevoir Des nouvelles de Betty ?",
    reminderLead: "Ça vous intéresse toujours ?",
    reminderBody: "Il y a quelques jours, cette adresse a été inscrite à Des nouvelles de Betty sur bethaniel.eu, mais l'inscription n'a pas été confirmée.",
    reminderNot: "Si ce n'était pas vous, ou si vous avez changé d'avis, ne faites rien. Vous n'aurez plus de nos nouvelles.",
  },
};

export function privacyUrl(lang) {
  return `${siteUrl()}/${lang && lang !== "en" ? lang + "/" : ""}privacy`;
}

function footerLink(t, href, label) {
  return `<a href="${escapeHtml(href)}" style="color:${t.muted};text-decoration:underline;">${escapeHtml(label)}</a>`;
}

/* `campaign`, when given, tags the link so the download it leads to is
   counted against the campaign that brought the visitor — the phone-to-
   computer hand-off otherwise loses it, because the campaign lives in the
   phone's browser session. See campaignParams. */
export function downloadUrl(lang, campaign) {
  const q = campaign ? `?${new URLSearchParams(campaign)}` : "";
  return `${siteUrl()}/${lang && lang !== "en" ? lang + "/" : ""}${q}#download`;
}

/* The UTM parameters for an email's download link. A visitor who came from
   a campaign keeps its source, medium and campaign — so the download lands
   in the same row of the stats — and utm_content says it came through the
   email. One who came from none is tagged as the email hand-off itself, so
   those downloads are counted as that rather than as "direct". Nothing
   here identifies anyone: these are the campaign names the page already
   records. */
export function campaignParams(attr, via = "phone-link") {
  const a = attr && typeof attr === "object" ? attr : {};
  const source = a.source || a.click_platform || null;
  if (!source) return { utm_source: "betty-email", utm_medium: "email", utm_campaign: via };
  const out = { utm_source: source };
  if (a.medium) out.utm_medium = a.medium;
  if (a.campaign) out.utm_campaign = a.campaign;
  if (a.term) out.utm_term = a.term;
  out.utm_content = "email-link";
  return out;
}

/* The pieces every welcome-family email is built from. */
function kit(lang) {
  lang = LANGS.includes(lang) ? lang : "en";
  const t = THEMES.parchment;
  return {
    lang,
    s: STRINGS[lang],
    t,
    para: (x) => `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.65;color:${t.text};">${escapeHtml(x)}</p>`,
    head: (x) => `<h2 style="margin:28px 0 10px;font-family:${SERIF};font-size:24px;line-height:1.25;font-weight:600;color:${t.heading};">${escapeHtml(x)}</h2>`,
    codeBox: (code) => `<div style="margin:0 0 12px;padding:16px;text-align:center;background:${t.codeBg};border:1px dashed ${t.rule};border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:22px;letter-spacing:2px;color:${t.heading};">${escapeHtml(code)}</div>`,
    footer: (unsubscribeUrl) => {
      const s = STRINGS[lang];
      return {
        html: `${escapeHtml(s.footer)} ${footerLink(t, unsubscribeUrl, s.unsubscribe)} · ${footerLink(t, privacyUrl(lang), s.privacy)}`,
        text: `\n—\n${s.footer}\n${s.unsubscribe}: ${unsubscribeUrl}\n${s.privacy}: ${privacyUrl(lang)}\n`,
      };
    },
  };
}

/* One email for every signup.
   - Link only (no confirmUrl, no unsubscribeUrl): the download link, and
     the address is not kept.
   - Awaiting confirmation (confirmUrl): the link and one button. `offer`
     says the button also brings the 50% code — the code itself is minted
     only when they press it, so confirming is what earns it.
   - Already confirmed, signing up again: no button, and their code if they
     have one — it is theirs to keep. */
export function renderWelcome({ lang, source, code, confirmUrl, unsubscribeUrl, offer, attr }) {
  const k = kit(lang);
  const { s, t, para, head } = k;
  const phone = source === "phone";
  const linkOnly = !code && !confirmUrl && !unsubscribeUrl;
  const pending = Boolean(confirmUrl);

  const link = downloadUrl(k.lang, campaignParams(attr, phone || linkOnly ? "phone-link" : "welcome-email"));
  const linkHtml = para(phone ? s.bodyPhone : s.bodyThanks) + button(t, link, s.download);
  const linkText = `${phone ? s.bodyPhone : s.bodyThanks}\n${link}\n`;

  const confirmBody = offer ? s.confirmBodyOffer : s.confirmBody;
  const confirmButton = offer ? s.confirmButtonOffer : s.confirmButton;
  const confirmHtml = para(confirmBody) + button(t, confirmUrl ?? "", confirmButton) + para(s.confirmNot);
  const confirmText = `${confirmBody}\n${confirmButton}: ${confirmUrl}\n${s.confirmNot}\n`;

  let body;
  let text;
  if (pending && !phone) {
    /* They came for the newsletter: the button leads, the download follows. */
    body = confirmHtml + linkHtml;
    text = `${confirmText}\n${linkText}`;
  } else if (pending) {
    /* They came for the link: it leads, the button follows. */
    body = linkHtml + head(s.confirmHead) + confirmHtml;
    text = `${linkText}\n${s.confirmHead}\n${confirmText}`;
  } else {
    body = linkHtml;
    text = linkText;
    if (code) {
      body += head(s.codeHead) + para(s.codeBody) + k.codeBox(code) + para(s.codeHow);
      text += `\n${s.codeHead}\n${s.codeBody}\n\n    ${code}\n\n${s.codeHow}\n`;
    }
  }
  body += para(s.sign);
  text += `\n${s.sign}\n`;

  let footerHtml;
  if (linkOnly) {
    footerHtml = `${escapeHtml(s.footerLink)} ${footerLink(t, privacyUrl(k.lang), s.privacy)}`;
    text += `\n—\n${s.footerLink}\n${s.privacy}: ${privacyUrl(k.lang)}\n`;
  } else {
    const f = k.footer(unsubscribeUrl);
    footerHtml = f.html;
    text += f.text;
  }

  let subject;
  if (linkOnly) subject = s.subjectLink;
  else if (pending) {
    subject = phone
      ? (offer ? s.subjectConfirmPhoneOffer : s.subjectConfirmPhone)
      : (offer ? s.subjectConfirmOffer : s.subjectConfirm);
  } else subject = code ? (phone ? s.subjectCode : s.subjectThanks) : (phone ? s.subjectLink : s.subjectWelcome);

  const html = layout({
    t,
    lang: k.lang,
    preheader: pending ? confirmBody : code ? s.codeBody : s.bodyPhone,
    kicker: "Betty",
    title: pending && !phone ? s.leadConfirm : phone || linkOnly ? s.leadPhone : s.leadThanks,
    bodyHtml: body,
    footerHtml,
  });
  return { subject, html, text };
}

/* Sent the moment a subscription is confirmed, when the offer brought a code. */
export function renderCodeEmail({ lang, code, unsubscribeUrl }) {
  const k = kit(lang);
  const { s, t, para, head } = k;
  /* codeBody ends in a colon: the code follows it directly. */
  const body = para(s.codeThanks) + head(s.codeHead) + para(s.codeBody) + k.codeBox(code) + para(s.codeHow)
    + para(s.bodyThanks) + button(t, downloadUrl(k.lang), s.download) + para(s.sign);
  const f = k.footer(unsubscribeUrl);
  const text = `${s.codeLead}\n\n${s.codeThanks}\n\n${s.codeHead}\n${s.codeBody}\n\n    ${code}\n\n${s.codeHow}\n\n`
    + `${s.bodyThanks}\n${downloadUrl(k.lang)}\n\n${s.sign}\n${f.text}`;
  const html = layout({
    t, lang: k.lang, preheader: `${s.codeThanks} ${code}`, kicker: "Betty",
    title: s.codeLead, bodyHtml: body, footerHtml: f.html,
  });
  return { subject: s.subjectCodeEmail, html, text };
}

/* The one reminder, three days after a signup nobody confirmed. */
export function renderReminder({ lang, confirmUrl, unsubscribeUrl, offer }) {
  const k = kit(lang);
  const { s, t, para } = k;
  const confirmBody = offer ? s.confirmBodyOffer : s.confirmBody;
  const confirmButton = offer ? s.confirmButtonOffer : s.confirmButton;
  const body = para(s.reminderBody) + para(confirmBody) + button(t, confirmUrl, confirmButton)
    + para(s.reminderNot) + para(s.sign);
  const f = k.footer(unsubscribeUrl);
  const text = `${s.reminderLead}\n\n${s.reminderBody}\n\n${confirmBody}\n${confirmButton}: ${confirmUrl}\n\n`
    + `${s.reminderNot}\n\n${s.sign}\n${f.text}`;
  const html = layout({
    t, lang: k.lang, preheader: s.reminderBody, kicker: "Betty",
    title: s.reminderLead, bodyHtml: body, footerHtml: f.html,
  });
  return { subject: offer ? s.subjectReminderOffer : s.subjectReminder, html, text };
}
