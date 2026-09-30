/* /admin/cloud: every cloud job, what it was sold for, what it used, what
   reached the Stripe account — as charts first, then the tables that are
   also their plain-data view. The joining happens server-side
   (api/_lib/cloud-report.js); this draws it, and sends refund decisions. */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  var api = window.bettyAdmin.api;
  var SVG = "http://www.w3.org/2000/svg";

  var PRODUCTS = ["edit", "readthrough", "translate", "enhance", "unknown"];
  var PRODUCT_NAMES = {
    edit: "Copy and line edit",
    readthrough: "Final readthrough",
    translate: "Translation",
    enhance: "Language analysis",
    unknown: "Not recorded",
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

  function sv(tag, attrs) {
    var n = document.createElementNS(SVG, tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
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
  function shortDay(date) {
    return new Date(date + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  }
  function td(text, cls) {
    return el("td", { class: cls || "", text: text });
  }
  function empty(tbody, cols, text) {
    tbody.appendChild(el("tr", {}, [el("td", { colspan: String(cols), class: "adm__empty", text: text })]));
  }

  /* Clean axis ticks: 1, 2 or 5 times a power of ten. */
  function niceTicks(lo, hi, count) {
    if (lo === hi) { hi = lo + 1; }
    var raw = (hi - lo) / Math.max(1, count);
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = [1, 2, 5, 10].map(function (m) { return m * pow; }).find(function (s) { return s >= raw; });
    var start = Math.floor(lo / step) * step;
    var ticks = [];
    for (var v = start; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  /* ── The tooltip: one element, shared by every chart ── */
  var tip = null;
  function showTip(clientX, clientY, lead, rows) {
    if (!tip) {
      tip = el("div", { class: "cl__tip", role: "status" });
      document.body.appendChild(tip);
    }
    tip.textContent = "";
    tip.appendChild(el("b", { text: lead }));
    rows.forEach(function (r) {
      var row = el("div", { class: "cl__tiprow" });
      if (r.color) row.appendChild(el("i", { class: "cl__key", style: "background:" + r.color }));
      row.appendChild(el("span", { class: "cl__tipval", text: r.value }));
      row.appendChild(document.createTextNode(" " + r.label));
      tip.appendChild(row);
    });
    tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var x = clientX + 14, y = clientY - h - 10;
    if (x + w > window.innerWidth - 8) x = clientX - w - 14;
    if (y < 8) y = clientY + 16;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideTip() {
    if (tip) tip.hidden = true;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
      getComputedStyle($("app")).getPropertyValue(name).trim();
  }
  function color(product) {
    return cssVar("--viz-" + product);
  }

  /* ── Chart 1: accumulated margin — the line, blue above zero, red below ── */
  function drawMargin(box, series) {
    box.textContent = "";
    var W = Math.max(280, box.clientWidth), H = 230;
    var L = 64, R = 70, T = 14, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var vals = series.map(function (d) { return d.cumulative; });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (lo === hi) { lo -= 1; hi += 1; }
    var ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    var n = series.length;
    var x = function (i) { return L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw); };
    var y = function (v) { return T + ((hi - v) / (hi - lo)) * ph; };
    var y0 = y(0);

    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": "Accumulated margin, from " + eur(series[0].cumulative) + " to " + eur(series[n - 1].cumulative), tabindex: "0" });

    ticks.forEach(function (t) {
      svg.appendChild(sv("line", { x1: L, x2: L + pw, y1: y(t), y2: y(t), class: t === 0 ? "cl__base" : "cl__grid" }));
      var lab = sv("text", { x: L - 8, y: y(t) + 4, "text-anchor": "end", class: "cl__axis" });
      lab.textContent = eur(t);
      svg.appendChild(lab);
    });
    [0, Math.floor((n - 1) / 2), n - 1].filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (i) {
      var t = sv("text", { x: x(i), y: H - 8, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle", class: "cl__axis" });
      t.textContent = shortDay(series[i].date);
      svg.appendChild(t);
    });

    /* One path, drawn twice: clipped above the zero line in blue, below it
       in red — so the colour changes exactly where the margin crosses zero. */
    var id = "m" + Math.random().toString(36).slice(2);
    var defs = sv("defs");
    var up = sv("clipPath", { id: id + "u" }); up.appendChild(sv("rect", { x: 0, y: 0, width: W, height: y0 }));
    var dn = sv("clipPath", { id: id + "d" }); dn.appendChild(sv("rect", { x: 0, y: y0, width: W, height: H - y0 }));
    defs.appendChild(up); defs.appendChild(dn); svg.appendChild(defs);
    var line = series.map(function (d, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(d.cumulative).toFixed(1); }).join(" ");
    var area = line + " L" + x(n - 1).toFixed(1) + " " + y0 + " L" + x(0).toFixed(1) + " " + y0 + " Z";
    [["u", "--viz-positive"], ["d", "--viz-negative"]].forEach(function (p) {
      var c = cssVar(p[1]);
      svg.appendChild(sv("path", { d: area, fill: c, "fill-opacity": "0.1", "clip-path": "url(#" + id + p[0] + ")" }));
      svg.appendChild(sv("path", { d: line, fill: "none", stroke: c, "stroke-width": 2, "stroke-linejoin": "round",
        "stroke-linecap": "round", "clip-path": "url(#" + id + p[0] + ")" }));
    });

    /* The end: a dot, and the one value worth labelling — where it stands now. */
    var last = series[n - 1];
    var endColor = cssVar(last.cumulative < 0 ? "--viz-negative" : "--viz-positive");
    svg.appendChild(sv("circle", { cx: x(n - 1), cy: y(last.cumulative), r: 4, fill: endColor, stroke: cssVar("--viz-surface"), "stroke-width": 2 }));
    var endLab = sv("text", { x: x(n - 1) + 10, y: y(last.cumulative) + 4, class: "cl__endlabel" });
    endLab.textContent = eur(last.cumulative);
    svg.appendChild(endLab);

    /* The crosshair finds the day; the readout gives all three numbers. */
    var cross = sv("line", { y1: T, y2: T + ph, class: "cl__cross", visibility: "hidden" });
    var dot = sv("circle", { r: 4, stroke: cssVar("--viz-surface"), "stroke-width": 2, visibility: "hidden" });
    svg.appendChild(cross); svg.appendChild(dot);
    var hit = sv("rect", { x: L, y: T, width: pw, height: ph, fill: "transparent" });
    svg.appendChild(hit);
    var cur = n - 1;
    function show(i, cx, cy) {
      cur = Math.max(0, Math.min(n - 1, i));
      var d = series[cur];
      cross.setAttribute("x1", x(cur)); cross.setAttribute("x2", x(cur)); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(cur)); dot.setAttribute("cy", y(d.cumulative));
      dot.setAttribute("fill", cssVar(d.cumulative < 0 ? "--viz-negative" : "--viz-positive"));
      dot.setAttribute("visibility", "visible");
      var r = svg.getBoundingClientRect();
      showTip(cx !== undefined ? cx : r.left + x(cur), cy !== undefined ? cy : r.top + y(d.cumulative),
        new Date(d.date + "T00:00:00Z").toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" }), [
          { value: eur(d.cumulative), label: "accumulated" },
          { value: eur(d.received), label: "received that day" },
          { value: eur(d.cost), label: "est. provider cost that day" },
        ]);
    }
    function hide() {
      cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip();
    }
    hit.addEventListener("pointermove", function (e) {
      var r = svg.getBoundingClientRect();
      var px = e.clientX - r.left;
      show(n === 1 ? 0 : Math.round(((px - L) / pw) * (n - 1)), e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", function () { show(cur); });
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { show(cur - 1); e.preventDefault(); }
      if (e.key === "ArrowRight") { show(cur + 1); e.preventDefault(); }
    });
    box.appendChild(svg);
  }

  /* ── Chart 2: jobs per day, stacked by type ── */
  function roundedTop(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return "M" + x + " " + (y + h) + " V" + (y + r) + " Q" + x + " " + y + " " + (x + r) + " " + y +
      " H" + (x + w - r) + " Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) + " V" + (y + h) + " Z";
  }

  function drawJobs(box, days) {
    box.textContent = "";
    var used = PRODUCTS.filter(function (p) { return days.some(function (d) { return d[p] > 0; }); });
    var legend = el("div", { class: "cl__legend" });
    used.forEach(function (p) {
      legend.appendChild(el("span", {}, [el("i", { class: "cl__swatch", style: "background:" + color(p) }), PRODUCT_NAMES[p]]));
    });
    box.appendChild(legend);

    var W = Math.max(280, box.clientWidth), H = 190;
    var L = 36, R = 12, T = 10, B = 28;
    var pw = W - L - R, ph = H - T - B;
    var n = days.length;
    var totals = days.map(function (d) { return used.reduce(function (s, p) { return s + d[p]; }, 0); });
    var max = Math.max(1, Math.max.apply(null, totals));
    var ticks = niceTicks(0, max, Math.min(4, max)).filter(function (t) { return Number.isInteger(t); });
    var top = ticks[ticks.length - 1];
    var slot = pw / n;
    var bw = Math.max(2, Math.min(24, slot * 0.7));
    var y = function (v) { return T + ph - (v / top) * ph; };

    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": "Jobs per day by type; " + num(totals.reduce(function (a, b) { return a + b; }, 0)) + " in all" });
    ticks.forEach(function (t) {
      svg.appendChild(sv("line", { x1: L, x2: L + pw, y1: y(t), y2: y(t), class: t === 0 ? "cl__base" : "cl__grid" }));
      var lab = sv("text", { x: L - 8, y: y(t) + 4, "text-anchor": "end", class: "cl__axis" });
      lab.textContent = String(t);
      svg.appendChild(lab);
    });
    [0, Math.floor((n - 1) / 2), n - 1].filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (i) {
      var t = sv("text", { x: L + slot * i + slot / 2, y: H - 8, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle", class: "cl__axis" });
      t.textContent = shortDay(days[i].date);
      svg.appendChild(t);
    });

    days.forEach(function (d, i) {
      var cx = L + slot * i + (slot - bw) / 2;
      var base = 0;
      var segs = used.filter(function (p) { return d[p] > 0; });
      var g = sv("g", { class: "cl__col" });
      segs.forEach(function (p, k) {
        var y1 = y(base + d[p]), y2 = y(base);
        /* The 2px surface gap between segments; the topmost gets the
           rounded end, the baseline stays square. */
        var h = Math.max(1, y2 - y1 - (k > 0 ? 2 : 0));
        var yTop = y1;
        var shape = k === segs.length - 1
          ? sv("path", { d: roundedTop(cx, yTop, bw, h, 4), fill: color(p) })
          : sv("rect", { x: cx, y: yTop, width: bw, height: h, fill: color(p) });
        g.appendChild(shape);
        base += d[p];
      });
      /* The whole slot is the hit target, not the painted pixels. */
      var hit = sv("rect", { x: L + slot * i, y: T, width: slot, height: ph, fill: "transparent", tabindex: totals[i] ? "0" : "-1" });
      function show(e) {
        g.classList.add("is-hot");
        var r = hit.getBoundingClientRect();
        showTip(e && e.clientX !== undefined ? e.clientX : r.left + r.width / 2, e && e.clientY !== undefined ? e.clientY : r.top + 20,
          new Date(d.date + "T00:00:00Z").toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" }) + " — " + num(totals[i]) + " job" + (totals[i] === 1 ? "" : "s"),
          segs.slice().reverse().map(function (p) { return { color: color(p), value: num(d[p]), label: PRODUCT_NAMES[p] }; }));
      }
      function hide() { g.classList.remove("is-hot"); hideTip(); }
      hit.addEventListener("pointermove", show);
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("focus", function () { show(); });
      hit.addEventListener("blur", hide);
      svg.appendChild(g);
      svg.appendChild(hit);
    });
    box.appendChild(svg);
  }

  /* ── Chart 3: margin by job type — bars from zero, blue or red ── */
  function drawMarginByType(box, rows) {
    box.textContent = "";
    var W = Math.max(280, box.clientWidth);
    var rowH = 34, T = 6, B = 24, labelW = Math.min(150, W * 0.34), R = 72;
    var H = T + B + rows.length * rowH;
    var vals = rows.map(function (r) { return r.margin; });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (lo === hi) hi = lo + 1;
    var ticks = niceTicks(lo, hi, 3);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    /* A negative bar's value sits left of its end: make room for it
       there, so it never runs into the row's name. */
    var L = labelW + 12 + (lo < 0 ? 64 : 0), pw = W - L - R;
    var x = function (v) { return L + ((v - lo) / (hi - lo)) * pw; };
    var x0 = x(0);
    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Margin by job type" });
    ticks.forEach(function (t) {
      svg.appendChild(sv("line", { x1: x(t), x2: x(t), y1: T, y2: H - B, class: t === 0 ? "cl__base" : "cl__grid" }));
      var lab = sv("text", { x: x(t), y: H - 6, "text-anchor": "middle", class: "cl__axis" });
      lab.textContent = eur(t);
      svg.appendChild(lab);
    });
    rows.forEach(function (r, i) {
      var cy = T + i * rowH + rowH / 2;
      var name = sv("text", { x: labelW, y: cy + 4, "text-anchor": "end", class: "cl__rowlabel" });
      name.textContent = PRODUCT_NAMES[r.product] || r.product;
      svg.appendChild(name);
      var bh = Math.min(20, rowH - 12);
      var neg = r.margin < 0;
      var xa = neg ? x(r.margin) : x0, len = Math.max(1, Math.abs(x(r.margin) - x0));
      var rad = Math.min(4, len / 2);
      /* Rounded at the data end, square at the zero line. */
      var d = neg
        ? "M" + x0 + " " + (cy - bh / 2) + " H" + (xa + rad) + " Q" + xa + " " + (cy - bh / 2) + " " + xa + " " + (cy - bh / 2 + rad) +
          " V" + (cy + bh / 2 - rad) + " Q" + xa + " " + (cy + bh / 2) + " " + (xa + rad) + " " + (cy + bh / 2) + " H" + x0 + " Z"
        : "M" + x0 + " " + (cy - bh / 2) + " H" + (x0 + len - rad) + " Q" + (x0 + len) + " " + (cy - bh / 2) + " " + (x0 + len) + " " + (cy - bh / 2 + rad) +
          " V" + (cy + bh / 2 - rad) + " Q" + (x0 + len) + " " + (cy + bh / 2) + " " + (x0 + len - rad) + " " + (cy + bh / 2) + " H" + x0 + " Z";
      var bar = sv("path", { d: d, fill: cssVar(neg ? "--viz-negative" : "--viz-positive"), class: "cl__hbar" });
      svg.appendChild(bar);
      var val = sv("text", { x: neg ? xa - 6 : x0 + len + 6, y: cy + 4, "text-anchor": neg ? "end" : "start", class: "cl__endlabel" });
      val.textContent = eur(r.margin);
      svg.appendChild(val);
      var hit = sv("rect", { x: 0, y: T + i * rowH, width: W, height: rowH, fill: "transparent", tabindex: "0" });
      function show(e) {
        bar.classList.add("is-hot");
        var b = hit.getBoundingClientRect();
        showTip(e && e.clientX !== undefined ? e.clientX : b.left + x0, e && e.clientY !== undefined ? e.clientY : b.top,
          PRODUCT_NAMES[r.product] || r.product, [
            { value: eur(r.margin), label: "margin" },
            { value: eur(r.received), label: "received" },
            { value: eur(r.cost), label: "est. provider cost" },
          ]);
      }
      function hide() { bar.classList.remove("is-hot"); hideTip(); }
      hit.addEventListener("pointermove", show);
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("focus", function () { show(); });
      hit.addEventListener("blur", hide);
      svg.appendChild(hit);
    });
    box.appendChild(svg);
  }

  function note(box, text) {
    box.textContent = "";
    box.appendChild(el("p", { class: "adm__empty", text: text }));
  }

  var lastData = null;
  function drawCharts() {
    var d = lastData;
    if (!d) return;
    var c = d.charts;
    var why = c.marginNote === "no-stripe"
      ? "Needs Stripe, which could not be read."
      : c.marginNote === "not-euro"
        ? "The Stripe account does not settle in euros, so received and provider cost can't be set against each other honestly."
        : null;
    if (c.marginSeries && c.marginSeries.length) drawMargin($("chartMargin"), c.marginSeries);
    else note($("chartMargin"), why || "No days in this range.");
    if (c.jobsByDay.some(function (x) { return PRODUCTS.some(function (p) { return x[p] > 0; }); })) drawJobs($("chartJobs"), c.jobsByDay);
    else note($("chartJobs"), "No jobs in this range.");
    if (c.marginByProduct && c.marginByProduct.length) drawMarginByType($("chartTypes"), c.marginByProduct);
    else note($("chartTypes"), why || "No jobs in this range.");
  }
  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawCharts, 150);
  });

  /* ── Refunds ── */

  /* A refund moves money: the first click arms the button, the second one
     sends it. */
  function armed(btn, question, action) {
    var label = btn.textContent;
    var timer;
    btn.addEventListener("click", function () {
      if (!btn.classList.contains("is-armed")) {
        btn.classList.add("is-armed");
        btn.textContent = question;
        timer = setTimeout(function () { btn.classList.remove("is-armed"); btn.textContent = label; }, 5000);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true;
      btn.textContent = "…";
      action().then(load, function (err) {
        btn.disabled = false;
        btn.classList.remove("is-armed");
        btn.textContent = label;
        $("refundMsg").textContent = err.message;
        $("refundMsg").className = "adm__msg adm__msg--error";
      });
    });
  }

  function refundable(j) {
    return j.kind === "paid" && j.paymentIntent && j.refundStatus !== "refunded" && j.stripeStatus !== "refunded";
  }

  function refundButton(j) {
    var btn = el("button", { type: "button", class: "adm__del", text: "Refund" });
    var amount = money(j.chargedCents, j.chargedCurrency);
    armed(btn, j.status === "active" ? "Refund " + amount + "? (usable until it expires)" : "Refund " + amount + "?", function () {
      return api("refund-job", { body: { credentialId: j.id, action: "refund" } }).then(function () {
        $("refundMsg").textContent = "Refunded " + amount + " to " + (j.customerEmail || "the buyer") + ".";
        $("refundMsg").className = "adm__msg adm__msg--ok";
      });
    });
    return btn;
  }

  function declineButton(j) {
    var btn = el("button", { type: "button", class: "adm__del", text: "Decline" });
    armed(btn, "Decline — no refund?", function () {
      return api("refund-job", { body: { credentialId: j.id, action: "decline" } }).then(function () {
        $("refundMsg").textContent = "Declined — no money moved.";
        $("refundMsg").className = "adm__msg adm__msg--ok";
      });
    });
    return btn;
  }

  function statusText(j) {
    var s = j.status;
    if (j.stripeStatus === "refunded" || j.refundStatus === "refunded") s += ", refunded";
    else if (j.stripeStatus === "partly refunded") s += ", partly refunded";
    else if (j.refundStatus === "review") s += ", refund to decide";
    else if (j.refundStatus === "failed") s += ", refund failed";
    else if (j.refundStatus === "none") s += ", refund declined";
    return s;
  }

  function stripeLink(paymentIntent) {
    if (!paymentIntent) return null;
    return el("a", {
      href: "https://dashboard.stripe.com/payments/" + encodeURIComponent(paymentIntent),
      target: "_blank", rel: "noopener noreferrer", class: "adm__link", text: "Stripe",
    });
  }

  function jobType(j) {
    var name = PRODUCT_NAMES[j.product] || (j.product ? j.product : "—");
    return j.product ? name : j.kind === "code" ? "— (free job, type not recorded)" : "—";
  }

  function tile(value, label) {
    return el("div", { class: "adm__tile" }, [el("b", { text: value }), el("span", { text: label })]);
  }

  function render(d) {
    lastData = d;
    $("rangeLine").textContent = "Showing " + d.from + " – " + d.to + ".";
    $("marginSince").textContent = d.from;

    var w = $("warnings");
    w.textContent = "";
    function warn(title, text) { w.appendChild(el("div", { class: "cl__warn" }, [el("b", { text: title }), text])); }
    if (d.errors.cloud) warn("The cloud service could not be read.", d.errors.cloud);
    if (d.errors.stripe) warn("Stripe could not be read — fees, received and refunds are missing.", d.errors.stripe);
    if (d.errors.types) warn("The type of some older jobs could not be looked up in Stripe.",
      d.errors.types + " — the report key needs Read access to Checkout Sessions.");
    if (d.truncated) warn("Not everything in this range is shown.", "Pick a shorter range to see all of it.");

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

    drawCharts();

    /* Refunds to decide: the sweep's queue, now settled here. */
    var review = d.jobs.filter(function (j) { return j.refundStatus === "review"; });
    $("reviewSection").hidden = !review.length;
    var rr = $("reviewRows");
    rr.textContent = "";
    review.forEach(function (j) {
      rr.appendChild(el("tr", {}, [
        td(when(j.createdAt)), td(j.customerEmail || "—", "cl__email"), td(jobType(j)),
        td(money(j.chargedCents, j.chargedCurrency), "num"), td(j.usedPct + "% used", "num"),
        el("td", { class: "cl__actions" }, [refundButton(j), declineButton(j)]),
      ]));
    });

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
    var byDate = {};
    (d.charts.marginSeries || []).forEach(function (m) { byDate[m.date] = m; });
    var active = d.charts.jobsByDay.filter(function (x) { return PRODUCTS.some(function (p) { return x[p] > 0; }); });
    if (!active.length) empty(dr, 5, "No jobs in this range.");
    active.slice().reverse().forEach(function (x) {
      var jobs = PRODUCTS.reduce(function (s, p) { return s + x[p]; }, 0);
      var m = byDate[x.date];
      dr.appendChild(el("tr", {}, [
        td(x.date), td(num(jobs), "num"),
        td(PRODUCTS.filter(function (p) { return x[p]; }).map(function (p) { return PRODUCT_NAMES[p] + " " + x[p]; }).join(", ")),
        td(m ? eur(m.margin) : "—", "num"), td(m ? eur(m.cumulative) : "—", "num"),
      ]));
    });

    var jr = $("jobRows");
    jr.textContent = "";
    if (!d.jobs.length) empty(jr, 11, "No jobs in this range.");
    d.jobs.forEach(function (j) {
      var used = el("td", { class: "num" }, [
        num(j.tokensUsed) + " / " + num(j.tokenBudget),
        el("span", { class: "cl__bar", title: j.usedPct + "% used" }, [el("i", { style: "width:" + Math.min(100, j.usedPct) + "%" })]),
      ]);
      var actions = el("td", { class: "cl__actions" });
      var link = stripeLink(j.paymentIntent);
      if (link) actions.appendChild(link);
      if (refundable(j)) actions.appendChild(refundButton(j));
      var type = el("td", {}, [
        j.product ? el("i", { class: "cl__swatch", style: "background:" + color(j.product) }) : "",
        jobType(j),
      ]);
      jr.appendChild(el("tr", {}, [
        td(when(j.createdAt)),
        td(j.customerEmail || (j.kind === "code" ? "(free with a code)" : "—"), "cl__email"),
        type,
        td(j.kind === "code" ? "free" : money(j.chargedCents, j.chargedCurrency), "num"),
        td(j.promoCode || "", "cl__mono"),
        used,
        td(eur(j.providerCostEur), "num"),
        td(j.feeCents === null ? "—" : money(j.feeCents, j.settlementCurrency), "num"),
        td(j.netCents === null ? "—" : money(j.netCents, j.settlementCurrency), "num"),
        td(statusText(j)),
        actions,
      ]));
    });

    var or = $("orphanRows");
    or.textContent = "";
    $("orphanSection").hidden = !d.orphans.length;
    d.orphans.forEach(function (o) {
      var link = stripeLink(o.paymentIntent);
      or.appendChild(el("tr", {}, [
        td(when(o.createdAt)), td(o.email || "—", "cl__email"), td(money(o.amountCents, o.currency), "num"),
        td(o.refundedCents ? money(o.refundedCents, o.currency) : "", "num"), td(o.description || ""),
        el("td", {}, link ? [link] : []),
      ]));
    });
  }

  function isoDaysAgo(days) {
    return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  }

  var range = { days: 30 };

  function load() {
    var q = range.days
      ? { from: isoDaysAgo(range.days - 1), to: new Date().toISOString().slice(0, 10) }
      : { from: range.from, to: range.to };
    $("app").classList.add("is-loading");
    return api("cloud", { query: q }).then(render, function (e) {
      if (e.message === window.bettyAdmin.SIGNED_OUT) return;
      $("warnings").textContent = "";
      $("warnings").appendChild(el("div", { class: "cl__warn" }, [el("b", { text: "Could not load the report." }), e.message]));
    }).then(function () {
      $("app").classList.remove("is-loading");
    });
  }

  document.querySelectorAll("[data-days]").forEach(function (b) {
    b.addEventListener("click", function () {
      range = { days: Number(b.getAttribute("data-days")) };
      $("refundMsg").textContent = "";
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
