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

      /* The id itself (gclid, fbclid, ...) is never captured — it singles
         out one visitor's click and is joinable back to them by the
         platform that issued it. Only which platform sent it is kept. */
      attr.click_platform = null;
      for (var param in CLICK_IDS) {
        var id = cap(params.get(param));
        if (id) {
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

  /* Hangs the campaign off a download href at click time, not load time.
     i18n.js keys a translated block by its innerHTML, so mutating a link's
     href on DOMContentLoaded changes the key out from under it — translation
     silently stops applying to exactly the visitors this exists to track.
     And i18n.js's apply() replaces innerHTML wholesale, which would wipe out
     an href already decorated. Waiting for the click sidesteps both: the DOM
     stays byte-identical (and translatable) right up until the moment the
     visitor actually leaves.

     This MUST stay a delegated listener on document, not one bound to the
     link itself: apply() overwrites the parent's innerHTML to translate it,
     which destroys any listener that was attached to the element — a
     listener on document survives because it was never inside that
     innerHTML. The bare /api/download?asset=... href still works with no
     JS at all; a failure here costs attribution, never the download. */
  function decorateOnClick(e) {
    try {
      var el = e.target.closest && e.target.closest("a[data-dl-asset]");
      if (!el) return;
      if (el.href.indexOf("&a=") !== -1) return;
      var a = attr();
      if (!a || !Object.keys(a).length) return;
      el.href = "/api/download?asset=" + el.dataset.dlAsset + "&a=" + encode(a);
    } catch (e2) {
      /* Link keeps its static href. */
    }
  }

  capture();
  window.Betty = { track: track, attr: attr };

  /* auxclick covers middle-click / ctrl-click "open in new tab", which never
     fires a click event. Neither handler calls preventDefault or navigates
     itself — updating .href in place is enough; the browser reads the new
     value when it follows the link. */
  document.addEventListener("click", decorateOnClick);
  document.addEventListener("auxclick", decorateOnClick);
})();
