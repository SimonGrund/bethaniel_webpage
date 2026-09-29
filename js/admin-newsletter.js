/* /admin/newsletter: newsletters, subscribers and discount codes.
   Sign-in, the API call and the header live in js/admin-common.js. */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  var api = window.bettyAdmin.api;

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function when(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function status(s) {
    return el("span", { class: "adm__status adm__status--" + s, text: s });
  }

  function msg(node, text, kind) {
    node.textContent = text || "";
    node.className = "adm__msg" + (kind ? " adm__msg--" + kind : "");
  }

  /* Destructive buttons ask twice, inline: the first click arms the button
     for a few seconds, the second one acts. */
  function armed(btn, question, action) {
    var label = btn.textContent;
    var timer;
    btn.addEventListener("click", function () {
      if (!btn.classList.contains("is-armed")) {
        btn.classList.add("is-armed");
        btn.textContent = typeof question === "function" ? question() : question;
        timer = setTimeout(function () {
          btn.classList.remove("is-armed");
          btn.textContent = label;
        }, 4000);
        return;
      }
      clearTimeout(timer);
      btn.classList.remove("is-armed");
      btn.textContent = label;
      action();
    });
  }

  var LANG_NAMES = { en: "English", da: "Danish", de: "German", es: "Spanish", fr: "French" };
  var themes = {};

  /* ── Sign-in ───────────────────────────────────────────────────────── */

  async function start() {
    if (!(await window.bettyAdmin.ready)) return;
    var me;
    try {
      me = await api("me");
    } catch (e) {
      /* Signed in, but the newsletter could not be read — most likely its
         tables have not been created yet (db/2026-09-29-newsletter.sql). */
      if (e.message === window.bettyAdmin.SIGNED_OUT) return;
      $("appError").textContent = "Could not load the newsletter: " + e.message;
      $("appError").hidden = false;
      return;
    }
    me.themes.forEach(function (t) {
      themes[t.id] = t.label;
      $("fTheme").appendChild(el("option", { value: t.id, text: t.label }));
    });
    renderTiles(me.counts);
    loadCampaigns();
  }

  /* ── Tabs ──────────────────────────────────────────────────────────── */

  var TABS = { Campaigns: null, Subscribers: function () { loadSubscribers(true); }, Codes: function () { loadCodes(); } };
  Object.keys(TABS).forEach(function (name) {
    $("tab" + name).addEventListener("click", function () {
      Object.keys(TABS).forEach(function (other) {
        $("tab" + other).setAttribute("aria-selected", String(other === name));
        $("pane" + other).hidden = other !== name;
      });
      if (TABS[name]) TABS[name]();
    });
  });

  /* ── Newsletter list ───────────────────────────────────────────────── */

  async function loadCampaigns() {
    var rows = (await api("campaigns")).rows;
    var body = $("campaignRows");
    body.textContent = "";
    if (!rows.length) {
      body.appendChild(el("tr", {}, [el("td", { colspan: "6", class: "adm__empty", text: "No newsletters yet." })]));
      return;
    }
    rows.forEach(function (c) {
      var tr = el("tr", { class: "adm__row", tabindex: "0" }, [
        el("td", { text: c.subject || "(no subject)" }),
        el("td", { text: (themes[c.theme] || c.theme).split(" — ")[0] }),
        el("td", { text: c.lang ? LANG_NAMES[c.lang] : "Everyone" }),
        el("td", {}, [status(c.status)]),
        el("td", { text: when(c.sent_at || c.send_at) }),
        el("td", { class: "num", text: String(c.delivered) }),
      ]);
      tr.addEventListener("click", function () { openEditor(c.id); });
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter") openEditor(c.id); });
      body.appendChild(tr);
    });
  }

  $("newCampaign").addEventListener("click", function () { openEditor(null); });
  $("backToList").addEventListener("click", function () {
    $("editor").hidden = true;
    $("campaignList").hidden = false;
    loadCampaigns();
  });

  /* ── Editor ────────────────────────────────────────────────────────── */

  var current = null; // the saved campaign, or null for one not yet saved
  var dirty = false;
  var audience = 0;

  function fields() {
    return {
      id: current && current.id,
      subject: $("fSubject").value,
      preheader: $("fPreheader").value,
      theme: $("fTheme").value,
      lang: $("fLang").value || null,
      body_md: $("fBody").value,
    };
  }

  async function openEditor(id) {
    msg($("editorMsg"), "");
    current = null;
    if (id) {
      var data = await api("campaign", { query: { id: id } });
      current = data.campaign;
    }
    var c = current || { subject: "", preheader: "", theme: "parchment", lang: null, body_md: "" };
    $("fSubject").value = c.subject;
    $("fPreheader").value = c.preheader;
    $("fTheme").value = c.theme;
    $("fLang").value = c.lang || "";
    $("fBody").value = c.body_md;
    $("fSendAt").value = "";
    dirty = false;
    $("campaignList").hidden = true;
    $("editor").hidden = false;
    refreshAudience();
    refreshState();
    preview();
  }

  function locked() {
    return !!current && (current.status === "sending" || current.status === "sent");
  }

  function refreshState() {
    var c = current;
    var lock = locked();
    ["fSubject", "fPreheader", "fTheme", "fLang", "fBody"].forEach(function (id) { $(id).disabled = lock; });
    $("saveBtn").hidden = lock;
    $("deleteBtn").hidden = lock || !c;
    $("scheduleBar").hidden = lock;
    $("unscheduleBtn").hidden = !c || c.status !== "scheduled";
    var line;
    if (!c) line = "Not saved yet.";
    else if (c.status === "draft") line = "Draft — not sent.";
    else if (c.status === "scheduled") line = "Scheduled for " + when(c.send_at) + ".";
    else if (c.status === "sending") line = "Sending — " + c.delivered + " sent so far.";
    else line = "Sent " + when(c.sent_at) + " to " + c.delivered + " people.";
    $("sendState").textContent = line;
    if (c && c.status === "sending") $("scheduleBar").hidden = false;
    $("scheduleBtn").hidden = lock;
  }

  async function refreshAudience() {
    try {
      audience = (await api("audience", { query: { lang: $("fLang").value } })).audience;
      $("audienceLine").textContent = audience + " confirmed subscriber" + (audience === 1 ? "" : "s") + " will get this.";
    } catch (e) {
      $("audienceLine").textContent = "";
    }
  }

  var previewTimer;
  function preview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async function () {
      try {
        $("preview").srcdoc = (await api("preview", { body: fields() })).html;
      } catch (e) {
        /* The preview is a convenience; a failed one leaves the last. */
      }
    }, 350);
  }

  ["fSubject", "fPreheader", "fTheme", "fLang", "fBody"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      dirty = true;
      preview();
    });
  });
  $("fLang").addEventListener("change", refreshAudience);

  async function save() {
    var data = await api("save-campaign", { body: fields() });
    current = Object.assign({ delivered: 0 }, current || {}, data.campaign);
    dirty = false;
    refreshState();
  }

  $("campaignForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    try {
      await save();
      msg($("editorMsg"), "Saved.", "ok");
    } catch (err) {
      msg($("editorMsg"), err.message, "error");
    }
  });

  $("testBtn").addEventListener("click", async function () {
    try {
      var r = await api("test", { body: fields() });
      msg($("editorMsg"), "Test sent to " + r.sentTo + ".", "ok");
    } catch (err) {
      msg($("editorMsg"), err.message, "error");
    }
  });

  armed($("deleteBtn"), "Delete for good?", async function () {
    try {
      await api("delete-campaign", { body: { id: current.id } });
      $("backToList").click();
    } catch (err) {
      msg($("editorMsg"), err.message, "error");
    }
  });

  $("scheduleBtn").addEventListener("click", async function () {
    var v = $("fSendAt").value;
    if (!v) return msg($("editorMsg"), "Pick a date and time first.", "error");
    try {
      if (dirty || !current) await save();
      var r = await api("schedule", { body: { id: current.id, send_at: new Date(v).toISOString() } });
      current = Object.assign(current, r.campaign);
      refreshState();
      msg($("editorMsg"), "Scheduled.", "ok");
    } catch (err) {
      msg($("editorMsg"), err.message, "error");
    }
  });

  $("unscheduleBtn").addEventListener("click", async function () {
    try {
      var r = await api("unschedule", { body: { id: current.id } });
      current = Object.assign(current, r.campaign);
      refreshState();
      msg($("editorMsg"), "Back to draft.", "ok");
    } catch (err) {
      msg($("editorMsg"), err.message, "error");
    }
  });

  armed(
    $("sendNowBtn"),
    function () { return "Send to " + audience + " now?"; },
    async function () {
      var btn = $("sendNowBtn");
      btn.disabled = true;
      try {
        if (!locked() && (dirty || !current)) await save();
        var total = 0;
        var r = await api("send-now", { body: { id: current.id } });
        /* Each call sends for up to ~40 seconds. "busy" means the cron holds
           the campaign right now; wait for its step to end and carry on. */
        for (var tries = 0; !r.done && tries < 500; tries++) {
          total += r.sent || 0;
          msg($("editorMsg"), "Sending… " + total + " so far. Keep this tab open, or leave it to the scheduler.");
          if (r.busy) await new Promise(function (ok) { setTimeout(ok, 5000); });
          r = await api("send-step", { body: { id: current.id } });
        }
        total += r.sent || 0;
        current = (await api("campaign", { query: { id: current.id } })).campaign;
        refreshState();
        msg($("editorMsg"), current.status === "sent" ? "Sent." : "Still sending — the scheduler will finish it.", "ok");
      } catch (err) {
        msg($("editorMsg"), err.message + " Anything not yet sent will go out with the next scheduler run.", "error");
      } finally {
        btn.disabled = false;
      }
    },
  );

  /* ── Subscribers ───────────────────────────────────────────────────── */

  function renderTiles(counts) {
    var tiles = [
      ["confirmed", "confirmed"],
      ["pending", "awaiting confirmation"],
      ["unsubscribed", "unsubscribed"],
      ["suppressed", "bounced or complained"],
    ];
    counts.suppressed = (counts.bounced || 0) + (counts.complained || 0);
    $("tiles").textContent = "";
    tiles.forEach(function (t) {
      $("tiles").appendChild(el("div", { class: "adm__tile" }, [
        el("b", { text: String(counts[t[0]] || 0) }),
        el("span", { text: t[1] }),
      ]));
    });
  }

  var offset = 0;
  async function loadSubscribers(reset) {
    if (reset) {
      offset = 0;
      $("subRows").textContent = "";
      api("me").then(function (me) { renderTiles(me.counts); }).catch(function () {});
    }
    var rows = (await api("subscribers", {
      query: { q: $("subSearch").value, status: $("subStatus").value, offset: offset },
    })).rows;
    offset += rows.length;
    $("subMore").hidden = rows.length < 100;
    if (reset && !rows.length) {
      $("subRows").appendChild(el("tr", {}, [el("td", { colspan: "7", class: "adm__empty", text: "Nobody here." })]));
    }
    rows.forEach(function (s) {
      var del = el("button", { type: "button", class: "adm__del", text: "Delete" });
      var tr = el("tr", {}, [
        el("td", { text: s.email }),
        el("td", {}, [status(s.status)]),
        el("td", { text: s.lang }),
        el("td", { text: s.source || "" }),
        el("td", { text: s.discount_code || "" }),
        el("td", { text: when(s.created_at) }),
        el("td", {}, [del]),
      ]);
      armed(del, "Erase?", async function () {
        try {
          await api("delete-subscriber", { body: { id: s.id } });
          tr.remove();
        } catch (err) {
          del.textContent = "Failed";
        }
      });
      $("subRows").appendChild(tr);
    });
  }

  var searchTimer;
  $("subSearch").addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { loadSubscribers(true); }, 300);
  });
  $("subStatus").addEventListener("change", function () { loadSubscribers(true); });
  $("subMore").addEventListener("click", function () { loadSubscribers(false); });

  $("importBtn").addEventListener("click", async function () {
    try {
      var r = await api("import", { body: { text: $("importText").value, lang: $("importLang").value } });
      msg($("importMsg"), "Found " + r.found + ", added " + r.added + ", already here " + r.skipped + ".", "ok");
      $("importText").value = "";
      loadSubscribers(true);
    } catch (err) {
      msg($("importMsg"), err.message, "error");
    }
  });

  /* ── Discount codes ────────────────────────────────────────────────── */

  var coupons = [];

  function setToggle(on) {
    $("welcomeToggle").setAttribute("aria-checked", String(on));
  }

  async function loadCodes() {
    var d = await api("discounts");
    setToggle(d.welcomeOn);
    var welcome = d.coupons.filter(function (c) { return c.welcome; })[0];
    $("welcomeLine").textContent = (d.welcomeOn ? "On" : "Off") + " — "
      + (welcome ? welcome.label : d.welcomeCoupon ? "coupon " + d.welcomeCoupon : "no coupon set (STRIPE_NEWSLETTER_COUPON)")
      + ". " + d.welcomeCodes + " welcome code" + (d.welcomeCodes === 1 ? "" : "s") + " sent so far.";
    $("stripeError").hidden = !d.stripeError;
    $("stripeError").textContent = d.stripeError ? "Stripe: " + d.stripeError : "";

    coupons = d.coupons;
    var sel = $("mCoupon");
    var keep = sel.value;
    sel.textContent = "";
    coupons.forEach(function (c) {
      sel.appendChild(el("option", { value: c.id, text: c.label + (c.welcome ? " (the welcome coupon)" : "") }));
    });
    if (keep) sel.value = keep;

    renderCodes(d.codes, {});
    if (d.codes.length) {
      api("code-usage").then(function (u) { renderCodes(d.codes, u.usage); }).catch(function () {});
    }
  }

  function renderCodes(rows, usage) {
    var body = $("codeRows");
    body.textContent = "";
    if (!rows.length) {
      body.appendChild(el("tr", {}, [el("td", { colspan: "7", class: "adm__empty", text: "None minted here yet." })]));
      return;
    }
    rows.forEach(function (r) {
      var u = usage[r.id];
      var inactive = u && !u.active;
      var used = u ? u.used + (r.max_redemptions ? " / " + r.max_redemptions : "") : "…";
      var actions = [];
      if (!inactive) {
        var off = el("button", { type: "button", class: "adm__del", text: "Deactivate" });
        armed(off, "Sure?", async function () {
          try {
            await api("deactivate-code", { body: { id: r.id } });
            loadCodes();
          } catch (err) {
            off.textContent = "Failed";
          }
        });
        actions.push(off);
      }
      body.appendChild(el("tr", {}, [
        el("td", { class: "adm__code" + (inactive ? " adm__off" : ""), text: r.code }),
        el("td", { text: r.coupon_label }),
        el("td", { class: "num", text: used }),
        el("td", { text: r.expires_at ? when(r.expires_at) : "" }),
        el("td", { text: r.note || "" }),
        el("td", { text: when(r.created_at) }),
        el("td", {}, actions),
      ]));
    });
  }

  $("welcomeToggle").addEventListener("click", async function () {
    var on = $("welcomeToggle").getAttribute("aria-checked") !== "true";
    try {
      await api("welcome-discount", { body: { on: on } });
      msg($("welcomeMsg"), on ? "Welcome discount on." : "Welcome discount off.", "ok");
      loadCodes();
    } catch (err) {
      msg($("welcomeMsg"), err.message, "error");
    }
  });

  /* A coupon worth a whole job asks once more, on the button itself. */
  var freeArmed = false;
  $("mintForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var coupon = coupons.filter(function (c) { return c.id === $("mCoupon").value; })[0];
    var btn = $("mintBtn");
    if (coupon && coupon.free && !freeArmed) {
      freeArmed = true;
      btn.textContent = "These make a job free — mint?";
      setTimeout(function () { freeArmed = false; btn.textContent = "Mint"; }, 5000);
      return;
    }
    var expires = $("mExpires").value;
    btn.disabled = true;
    msg($("mintMsg"), "Minting…");
    try {
      var r = await api("mint-codes", { body: {
        coupon: $("mCoupon").value,
        count: Number($("mCount").value),
        uses: $("mUses").value,
        code: $("mCode").value,
        /* The end of the chosen day, in this browser's time zone. */
        expires_at: expires ? new Date(expires + "T23:59:59").toISOString() : null,
        note: $("mNote").value,
        confirm_free: freeArmed,
      } });
      msg($("mintMsg"), "Minted " + r.minted.length + ".", "ok");
      $("mintedList").value = r.minted.join("\n");
      $("minted").hidden = false;
      $("mCode").value = "";
      loadCodes();
    } catch (err) {
      msg($("mintMsg"), err.message, "error");
    } finally {
      freeArmed = false;
      btn.textContent = "Mint";
      btn.disabled = false;
    }
  });

  $("copyMinted").addEventListener("click", function () {
    var t = $("mintedList");
    if (navigator.clipboard) navigator.clipboard.writeText(t.value);
    else { t.select(); document.execCommand("copy"); }
    $("copyMinted").textContent = "Copied";
    setTimeout(function () { $("copyMinted").textContent = "Copy"; }, 1500);
  });

  start();
})();
