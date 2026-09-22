/* Conversion tracking. Three jobs, and none of them may ever throw: a broken
   tracker must cost a number in a report, never a download or a form.

   Loaded from <head> without defer, so the campaign is in storage before the
   page below it has even parsed. It is small and same-origin, and every page
   needs it, so it is cached after the first visit.

   sessionStorage rather than a cookie is the whole reason this site needs no
   consent banner: nothing here outlives the browser session, and nothing in
   it identifies anyone. */
(function () {
  "use strict";

  var KEY = "betty_attr";
  var MAX = 200;
  var UTM = ["source", "medium", "campaign", "content", "term"];
  var CLICK_IDS = {
    gclid: "google",
    fbclid: "meta",
    rdt_cid: "reddit",
    li_fat_id: "linkedin",
    twclid: "x",
    msclkid: "microsoft",
  };

  function cap(value) {
    return typeof value === "string" ? value.slice(0, MAX) : null;
  }

  /* Reads the campaign out of the URL and remembers it for the session.
     Returns without writing when the URL carries no campaign, so an internal
     page view leaves an earlier ad click's attribution intact. Last touch
     wins, but only when there is a touch to record. */
  function capture() {
    try {
      var params = new URLSearchParams(location.search);
      var attr = { landing_path: cap(location.pathname) || "/" };
      var found = false;

      for (var i = 0; i < UTM.length; i++) {
        var value = cap(params.get("utm_" + UTM[i]));
        attr[UTM[i]] = value;
        if (value) found = true;
      }

      attr.click_id = null;
      attr.click_platform = null;
      for (var param in CLICK_IDS) {
        var id = cap(params.get(param));
        if (id) {
          attr.click_id = id;
          attr.click_platform = CLICK_IDS[param];
          found = true;
          break;
        }
      }

      if (!found) return;

      try {
        attr.referrer_host = document.referrer
          ? cap(new URL(document.referrer).hostname)
          : null;
      } catch (e) {
        attr.referrer_host = null;
      }
      if (attr.referrer_host === location.hostname) attr.referrer_host = null;

      sessionStorage.setItem(KEY, JSON.stringify(attr));
    } catch (e) {
      /* Storage disabled, or a URL we cannot parse. No attribution, no error. */
    }
  }

  function attr() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function encode(obj) {
    /* base64url, so it survives a query string without escaping. The
       TextEncoder step is what makes a non-ASCII campaign name survive
       btoa, which only speaks latin-1. The payload is well under a
       kilobyte, so spreading the bytes is safe here. */
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    var b64 = btoa(String.fromCharCode.apply(null, bytes));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function track(event, props) {
    try {
      var payload = JSON.stringify({
        event: event,
        props: props || {},
        attr: attr(),
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/event",
          new Blob([payload], { type: "application/json" })
        );
      } else {
        fetch("/api/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {
      /* Deliberately silent. */
    }
  }

  /* Hangs the campaign off every download href. The bare href already works
     without this — it just lands as an unattributed download — so a failure
     here costs attribution, not the download. */
  function decorateDownloads() {
    try {
      var a = attr();
      if (!a || !Object.keys(a).length) return;
      var encoded = encode(a);
      var links = document.querySelectorAll("a[data-dl-asset]");
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        if (el.href.indexOf("&a=") !== -1) continue;
        el.href = "/api/download?asset=" + el.dataset.dlAsset + "&a=" + encoded;
      }
    } catch (e) {
      /* Links keep their static hrefs. */
    }
  }

  capture();
  window.Betty = { track: track, attr: attr };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", decorateDownloads);
  } else {
    decorateDownloads();
  }
})();
