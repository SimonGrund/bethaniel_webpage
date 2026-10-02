/* Which installer this visitor wants, for every page's header button and
   the front page's download buttons.

   The OS is reliable; the Mac's chip is not. Safari reports every Mac as
   "Intel", so there is no honest way to read it off the user agent. What
   exists: Chromium answers client hints with the real architecture, and
   WebGL gives a strong hint everywhere else — the renderer names the chip
   in Chrome, and in Safari (which masks the name as "Apple GPU" on every
   Mac) Apple's own GPUs expose ASTC texture compression where the Intel and
   AMD parts in Intel Macs do not. A wrong guess costs one click on the line
   under the hero buttons, so this only picks a default; it never removes a
   route.

   window.bettyPlatform resolves to { os, arch, asset }, or null on a phone,
   a tablet, or anything else Betty does not ship for. Loaded right after
   the header, so the header button exists when it runs. */
(function () {
  var ua = navigator.userAgent;
  var plat = navigator.platform || "";
  // iPadOS Safari calls itself a Mac; the touch points give it away.
  var touch = (navigator.maxTouchPoints || 0) > 1;
  var os = null;
  if (/Mac/.test(plat) && !touch) os = "mac";
  else if (/Win/.test(plat)) os = "win";
  else if (/Linux/.test(plat) && !/Android/.test(ua)) os = "linux";

  function archFromWebGL() {
    try {
      var canvas = document.createElement("canvas");
      var gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return null;
      var info = gl.getExtension("WEBGL_debug_renderer_info");
      var renderer = info
        ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : "";
      if (/Apple M\d/.test(renderer)) return "arm64";
      if (/Intel|AMD|Radeon|NVIDIA/i.test(renderer)) return "x64";
      return gl.getExtension("WEBGL_compressed_texture_astc") ? "arm64" : "x64";
    } catch (e) {
      return null;
    }
  }

  function archFromHints() {
    var uad = navigator.userAgentData;
    if (!uad || !uad.getHighEntropyValues) return Promise.resolve(null);
    return uad.getHighEntropyValues(["architecture"]).then(
      function (v) {
        if (v.architecture === "arm") return "arm64";
        if (v.architecture === "x86") return "x64";
        return null;
      },
      function () {
        return null;
      },
    );
  }

  var ASSET = { win: "win", linux: "linux-appimage" };

  window.bettyPlatform = !os
    ? Promise.resolve(null)
    : (os === "mac" ? archFromHints() : Promise.resolve(null)).then(
        function (arch) {
          if (os === "mac") arch = arch || archFromWebGL() || "arm64";
          return {
            os: os,
            arch: arch,
            asset: os === "mac" ? "mac-" + arch : ASSET[os],
          };
        },
      );

  // The header button goes straight to the installer when there is one to
  // give. Its fallback href — the hero — stays for everyone else.
  window.bettyPlatform.then(function (p) {
    var btn = document.getElementById("navDownload");
    if (!btn || !p) return;
    btn.href = "/api/download?asset=" + p.asset;
    btn.setAttribute("data-dl-asset", p.asset);
  });

  // On a phone or tablet an installer is a file that will never open. Any
  // download there — the header button or a hero button — shows the note
  // instead: Betty is a computer program, here is the link to send yourself.
  // "Download anyway" stays, for the visitor who means to move the file.
  if (os) return;
  // Set now, before the hero is drawn: the front page's CSS swaps its
  // download buttons for the email-me-the-link form under this class, and
  // a swap after first paint would flash the buttons it means to hide.
  document.documentElement.classList.add("is-phone");
  var note = document.getElementById("phoneNote");
  if (!note || typeof note.showModal !== "function") return;
  var anyway = document.getElementById("phoneNoteAnyway");
  var copied = document.getElementById("phoneNoteCopied");

  // Capture phase, so the click stops here before the download's own
  // handlers — the tracking and the front page's after-download prompt —
  // ever see it.
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target.closest && e.target.closest("a[data-dl-asset], #navDownload");
      if (!a || note.contains(a)) return;
      // On the front page the header button's own href, the hero, already
      // holds the same form in plain sight; let it scroll there.
      if (a.id === "navDownload" && document.getElementById("heroPhone")) return;
      e.preventDefault();
      e.stopPropagation();
      var asset = a.getAttribute("data-dl-asset");
      anyway.hidden = !asset;
      if (asset) {
        anyway.href = "/api/download?asset=" + asset;
        anyway.setAttribute("data-dl-asset", asset);
      }
      copied.hidden = true;
      if (window.bettyResetPhoneNote) window.bettyResetPhoneNote();
      note.showModal();
    },
    true,
  );

  document.getElementById("phoneNoteClose").addEventListener("click", function () {
    note.close();
  });
  // A tap on the backdrop closes it, as a sheet should.
  note.addEventListener("click", function (e) {
    if (e.target === note) note.close();
  });

  document.getElementById("phoneNoteShare").addEventListener("click", function () {
    // The front page, in the language they are reading.
    var lang = document.documentElement.lang;
    var url = location.origin + (/^(da|de|es|fr)$/.test(lang) ? "/" + lang + "/" : "/");
    if (navigator.share) {
      navigator.share({ title: document.title, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () {
        copied.hidden = false;
      });
    }
  });
})();
