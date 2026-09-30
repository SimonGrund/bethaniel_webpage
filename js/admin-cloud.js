/* /admin/cloud: every cloud job, what it was sold for, what it used, and
   what reached the Stripe account. The joining happens server-side
   (api/_lib/cloud-report.js); this only draws it. */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  var api = window.bettyAdmin.api;

  var PRODUCT_NAMES = {
    edit: "Copy and line edit",
    readthrough: "Final readthrough",
    translate: "Translation",
    enhance: "Language analysis",
    unknown: "—",
  };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function money(cents, currency) {
    if (cents === null || cents === undefined || !currency) return "—";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(2) + " " + currency.toUpperCase();
    }
  }

  /* An amount per currency: "€12.00 · DKK 39.00". Never summed across. */
  function moneyMap(map) {
    var keys = Object.keys(map || {});
    if (!keys.length) return "—";
    return keys.map(function (c) { return money(map[c], c); }).join(" · ");
  }

  function eur(x) {
    return x === null || x === undefined ? "—" : money(Math.round(x * 100), "eur");
  }

  function num(n) {
    return (n || 0).toLocaleString();
  }

  function when(iso) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function td(text, cls) {
    return el("td", { class: cls || "", text: text });
  }

  function empty(tbody, cols, text) {
    tbody.appendChild(el("tr", {}, [el("td", { colspan: String(cols), class: "adm__empty", text: text })]));
  }

  function stripeLink(paymentIntent) {
    if (!paymentIntent) return el("td");
    return el("td", {}, [el("a", {
      href: "https://dashboard.stripe.com/payments/" + encodeURIComponent(paymentIntent),
      target: "_blank", rel: "noopener noreferrer", class: "adm__link", text: "Stripe",
    })]);
  }

  function statusText(j) {
    var s = j.status === "active" ? "active" : j.status === "expired" ? "expired" : j.status;
    if (j.stripeStatus === "refunded" || j.refundStatus === "refunded") s += ", refunded";
    else if (j.stripeStatus === "partly refunded") s += ", partly refunded";
    else if (j.refundStatus === "review") s += ", refund to decide";
    else if (j.refundStatus === "failed") s += ", refund failed";
    return s;
  }

  function tile(value, label) {
    var b = el("b");
    if (typeof value === "string") b.textContent = value;
    else b.appendChild(value);
    return el("div", { class: "adm__tile" }, [b, el("span", { text: label })]);
  }

  function render(d) {
    $("rangeLine").textContent = "Showing " + d.from + " – " + d.to + ".";

    var w = $("warnings");
    w.textContent = "";
    if (d.errors.cloud) {
      w.appendChild(el("div", { class: "cl__warn" }, [el("b", { text: "The cloud service could not be read." }), d.errors.cloud]));
    }
    if (d.errors.stripe) {
      w.appendChild(el("div", { class: "cl__warn" }, [
        el("b", { text: "Stripe could not be read — fees, received and refunds are missing." }), d.errors.stripe,
      ]));
    }
    if (d.truncated) {
      w.appendChild(el("div", { class: "cl__warn" }, [el("b", { text: "Not everything in this range is shown." }),
        "Pick a shorter range to see all of it."]));
    }

    var t = d.totals;
    var tiles = $("tiles");
    tiles.textContent = "";
    tiles.appendChild(tile(num(t.jobs), "jobs"));
    tiles.appendChild(tile(num(t.paidJobs), "paid" + (t.discountedJobs ? " (" + t.discountedJobs + " with a code)" : "")));
    tiles.appendChild(tile(num(t.codeJobs), "free with a code"));
    tiles.appendChild(tile(d.haveStripe ? moneyMap(t.net) : "—", "received, after fees"));
    tiles.appendChild(tile(d.haveStripe ? moneyMap(t.fees) : "—", "Stripe fees"));
    tiles.appendChild(tile(eur(t.providerCostEur), "est. provider cost"));
    tiles.appendChild(tile(eur(t.marginEur), "est. margin"));
    tiles.appendChild(tile(num(t.tokensUsed), "tokens used of " + num(t.tokensSold) + " sold"));
    tiles.appendChild(tile(num(t.refunds), "refunded"));
    if (t.awaitingDecision) tiles.appendChild(tile(num(t.awaitingDecision), "refunds to decide"));

    var pr = $("productRows");
    pr.textContent = "";
    if (!d.byProduct.length) empty(pr, 6, "No jobs in this range.");
    d.byProduct.forEach(function (p) {
      pr.appendChild(el("tr", {}, [
        td(PRODUCT_NAMES[p.product] || p.product), td(num(p.jobs), "num"), td(num(p.paid), "num"),
        td(num(p.tokensUsed), "num"), td(eur(p.providerCostEur), "num"), td(moneyMap(p.charged), "num"),
      ]));
    });

    var dr = $("dailyRows");
    dr.textContent = "";
    if (!d.daily.length) empty(dr, 4, "No jobs in this range.");
    d.daily.slice().reverse().forEach(function (x) {
      dr.appendChild(el("tr", {}, [td(x.date), td(num(x.jobs), "num"), td(num(x.paid), "num"), td(num(x.tokensUsed), "num")]));
    });

    var jr = $("jobRows");
    jr.textContent = "";
    if (!d.jobs.length) empty(jr, 11, "No jobs in this range.");
    d.jobs.forEach(function (j) {
      var used = el("td", { class: "num" }, [
        num(j.tokensUsed) + " / " + num(j.tokenBudget),
        el("span", { class: "cl__bar", title: j.usedPct + "% used" }, [el("i", { style: "width:" + Math.min(100, j.usedPct) + "%" })]),
      ]);
      jr.appendChild(el("tr", {}, [
        td(when(j.createdAt)),
        td(j.customerEmail || (j.kind === "code" ? "(free with a code)" : "—"), "cl__email"),
        td(PRODUCT_NAMES[j.product || "unknown"] || j.product),
        td(j.kind === "code" ? "free" : money(j.chargedCents, j.chargedCurrency), "num"),
        td(j.promoCode || "", "cl__mono"),
        used,
        td(eur(j.providerCostEur), "num"),
        td(j.feeCents === null ? "—" : money(j.feeCents, j.settlementCurrency), "num"),
        td(j.netCents === null ? "—" : money(j.netCents, j.settlementCurrency), "num"),
        td(statusText(j)),
        stripeLink(j.paymentIntent),
      ]));
    });

    var or = $("orphanRows");
    or.textContent = "";
    $("orphanSection").hidden = !d.orphans.length;
    d.orphans.forEach(function (o) {
      or.appendChild(el("tr", {}, [
        td(when(o.createdAt)), td(o.email || "—", "cl__email"), td(money(o.amountCents, o.currency), "num"),
        td(o.refundedCents ? money(o.refundedCents, o.currency) : "", "num"), td(o.description || ""),
        stripeLink(o.paymentIntent),
      ]));
    });
  }

  function isoDaysAgo(days) {
    return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  }

  var range = { days: 30 };

  async function load() {
    var q = range.days
      ? { from: isoDaysAgo(range.days - 1), to: new Date().toISOString().slice(0, 10) }
      : { from: range.from, to: range.to };
    $("rangeLine").textContent = "Loading…";
    try {
      render(await api("cloud", { query: q }));
    } catch (e) {
      if (e.message === window.bettyAdmin.SIGNED_OUT) return;
      $("rangeLine").textContent = "";
      $("warnings").textContent = "";
      $("warnings").appendChild(el("div", { class: "cl__warn" }, [el("b", { text: "Could not load the report." }), e.message]));
    }
  }

  document.querySelectorAll("[data-days]").forEach(function (b) {
    b.addEventListener("click", function () {
      range = { days: Number(b.getAttribute("data-days")) };
      load();
    });
  });
  $("applyRange").addEventListener("click", function () {
    var f = $("from").value, t = $("to").value;
    if (f && t) {
      range = { from: f, to: t };
      load();
    }
  });

  window.bettyAdmin.ready.then(function (email) {
    if (email) load();
  });
})();
