/* Shared by every /admin page: the API call, the signed-out gate, and the
   header's sign-out. The session is an HttpOnly cookie this script never
   sees, so "signed out" is learnt from a 401. Each page keeps its content in
   #app and waits on bettyAdmin.ready, which resolves to the signed-in
   address — or to null, with the gate showing. */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  var SIGNED_OUT = "You are signed out.";

  function showGate() {
    $("app").hidden = true;
    $("who").hidden = true;
    $("gate").hidden = false;
  }

  async function api(action, opts) {
    opts = opts || {};
    var url = "/api/admin?action=" + encodeURIComponent(action);
    if (opts.query) url += "&" + new URLSearchParams(opts.query).toString();
    var init = { method: opts.body ? "POST" : "GET", credentials: "same-origin", headers: {} };
    if (opts.body) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    var res = await fetch(url, init);
    if (res.status === 401) {
      showGate();
      throw new Error(SIGNED_OUT);
    }
    var data = res.status === 204 ? {} : await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "That failed (" + res.status + ").");
    return data;
  }

  // Signing in comes back to this page, not to the first admin page.
  $("signIn").href = "/api/admin?action=login&next=" + encodeURIComponent(location.pathname);

  $("signOut").addEventListener("click", async function () {
    await api("logout", { body: {} }).catch(function () {});
    showGate();
  });

  var ready = api("whoami").then(
    function (me) {
      $("whoEmail").textContent = me.email;
      $("who").hidden = false;
      $("gate").hidden = true;
      $("app").hidden = false;
      return me.email;
    },
    function (e) {
      showGate();
      /* A 401 is the ordinary signed-out state, not an error to report. */
      if (e.message !== SIGNED_OUT) $("gateError").textContent = e.message;
      return null;
    },
  );

  window.bettyAdmin = { api: api, ready: ready, SIGNED_OUT: SIGNED_OUT };
})();
