// Every signup form on the site posts to /api/newsletter: the phone note on
// each page, and on the front page the download modal and the newsletter
// section. A form's data-source says which it is; only the phone note may
// ask for the link without the newsletter.
(function () {
  // Whether the welcome code is on offer is decided in /admin. Until the
  // server says so, the pages promise nothing: a failed read leaves the
  // plain wording, never a promise of a code that will not come.
  var offer = false;
  if (document.querySelector("[data-offer]")) {
    fetch("/api/newsletter?action=offer")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (d) {
        offer = !!(d && d.welcomeDiscount);
        document.documentElement.classList.toggle("offer-on", offer);
      })
      .catch(function () {});
  }

  window.bettySignup = function (form) {
    var fd = new FormData(form);
    var source = form.getAttribute("data-source") || "footer";
    var body = {
      email: fd.get("email"),
      newsletter: source !== "phone" || fd.get("newsletter") === "true",
      source: source,
      lang: document.documentElement.lang,
      website: fd.get("website") || "",
      // The campaign this visit came from, so the download link in the
      // email can carry it to the computer the download happens on. Not
      // stored by the server; used for that link only.
      attr: window.Betty ? window.Betty.attr() : {},
    };
    return fetch("/api/newsletter?action=subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) throw new Error("signup failed");
      // Counted for the stats with the visit's campaign, never the address.
      // A filled honeypot is a bot the server has already turned away.
      if (window.Betty && !body.website) {
        var form = source === "phone"
          ? (body.newsletter ? "phone-newsletter" : "phone-link")
          : source === "download" ? "download-modal" : "newsletter";
        window.Betty.track("signup", { form: form });
      }
      return body;
    });
  };

  // The phone forms: the note's, on every page, and on the front page the
  // one in the hero. Each sits with its replies in one container — the
  // dialog, or #heroPhone — and finds them there by data-reply.
  function wirePhoneForm(form) {
    var scope = form.parentNode;
    function reply(name) {
      return scope.querySelector('[data-reply="' + name + '"]');
    }
    var sent = reply("sent");
    var sentCode = reply("code");
    var sentConfirm = reply("confirm");
    var error = reply("error");
    var btn = form.querySelector("button[type=submit]");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      btn.disabled = true;
      error.hidden = true;
      window.bettySignup(form).then(
        function (body) {
          form.hidden = true;
          (!body.newsletter ? sent : offer ? sentCode : sentConfirm).hidden = false;
        },
        function () {
          error.hidden = false;
          btn.disabled = false;
        },
      );
    });

    return function reset() {
      form.hidden = false;
      form.reset();
      btn.disabled = false;
      sent.hidden = true;
      sentCode.hidden = true;
      sentConfirm.hidden = true;
      error.hidden = true;
    };
  }

  // This script loads just after the header, before the hero is parsed.
  document.addEventListener("DOMContentLoaded", function () {
    var hero = document.querySelector('#heroPhone form[data-source="phone"]');
    if (hero) wirePhoneForm(hero);
  });

  var form = document.getElementById("phoneNoteForm");
  if (!form) return;
  // Every opening of the note starts clean — the next tap may be a
  // different download, or a second try with another address, and a box
  // ticked last time must never carry over into a subscription.
  // js/platform.js calls this just before it opens the note, rather than
  // this script waiting for the dialog's close event, which Chrome holds
  // back while the tab is hidden.
  window.bettyResetPhoneNote = wirePhoneForm(form);
})();
