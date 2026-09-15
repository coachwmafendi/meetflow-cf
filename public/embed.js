(function () {
  "use strict";

  if (window.__meetflowEmbedLoaded) return;
  window.__meetflowEmbedLoaded = true;

  var OVERLAY_ID = "__meetflow_embed__";

  function origin() {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (!src) return null;
      return new URL(src).origin;
    } catch (err) {
      return null;
    }
  }

  var ORIGIN = origin();

  function close(overlay) {
    overlay.style.display = "none";
  }

  function show(url) {
    if (!document.body) return;
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.style.display = "none";

      var backdrop = document.createElement("div");
      backdrop.style.cssText =
        "position:fixed;inset:0;background:rgba(2,6,23,0.65);display:flex;align-items:center;justify-content:center;padding:16px;z-index:2147483647;";

      var panel = document.createElement("div");
      panel.style.cssText =
        "position:relative;width:100%;max-width:1024px;height:min(90vh,800px);background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.35);";

      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close booking page");
      closeBtn.innerHTML = "&times;";
      closeBtn.style.cssText =
        "position:absolute;top:8px;right:8px;z-index:1;width:34px;height:34px;border:0;border-radius:8px;background:rgba(255,255,255,0.9);color:#0f172a;font-size:22px;line-height:1;cursor:pointer;";

      var frame = document.createElement("iframe");
      frame.setAttribute("title", "Booking page");
      frame.setAttribute("allow", "payment");
      frame.style.cssText = "width:100%;height:100%;border:0;";

      panel.appendChild(closeBtn);
      panel.appendChild(frame);
      backdrop.appendChild(panel);
      overlay.appendChild(backdrop);
      document.body.appendChild(overlay);

      closeBtn.addEventListener("click", function () {
        close(overlay);
      });
      backdrop.addEventListener("click", function (event) {
        if (event.target === backdrop) close(overlay);
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && overlay.style.display !== "none") close(overlay);
      });

      overlay._meetflowLoad = function (url) {
        frame.src = url;
        overlay.style.display = "block";
      };
    }
    overlay._meetflowLoad(url);
  }

  document.addEventListener("click", function (event) {
    try {
      var target = event.target;
      var trigger = target && target.closest ? target.closest("[data-meetflow-link]") : null;
      if (!trigger || !ORIGIN) return;
      var link = trigger.getAttribute("data-meetflow-link");
      if (!link) return;
      event.preventDefault();
      show(new URL("/" + link.replace(/^\/+/, ""), ORIGIN).href);
    } catch (err) {
      /* never throw on host pages */
    }
  });
})();
