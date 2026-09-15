# Popup Embed via Element Click — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cal.com-style popup embed: hosts paste a small loader script, mark any element with `data-meetflow-link="userSlug/eventSlug"`, and clicks open the booking page in a centered modal.

**Architecture:** A vanilla-JS file `public/embed.js` is served through the existing Assets binding (same layer as `/app.css`). A ~10-line loader snippet injects it async; embed.js derives the MeetFlow origin from `document.currentScript.src` and binds one delegated click listener that opens a reusable modal iframe. The dashboard embed dialog gains Inline/Popup tabs; snippets are still generated client-side from `window.location.origin`.

**Tech Stack:** Cloudflare Workers + Hono, vanilla JS (embed.js), Tailwind v4 component classes, vitest-pool-workers (`cloudflare:test`).

**Spec:** `docs/superpowers/specs/2026-09-15-popup-embed-element-click-design.md`

---

### File map

- Create: `public/embed.js` — the popup script asset. Self-contained, defensive, no dependencies.
- Create: `test/integration/assets.test.ts` — verifies the asset is in the Assets binding with a JS content-type.
- Modify: `src/views/dashboard.ts` — `EMBED_SCRIPT` gains `popupSnippet()` + `activateTab()`; open/copy handlers target the active tab; dialog markup gains tab buttons and a second textarea.
- Modify: `src/styles/app.css` — `.ui-embed-tab` component classes.
- Modify: `test/integration/pages.test.ts` — dashboard renders both tabs and the popup snippet source.

---

### Task 1: Popup script asset (`public/embed.js`)

**Files:**
- Create: `public/embed.js`
- Test: `test/integration/assets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/integration/assets.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("assets", () => {
  it("serves the popup embed script from the assets binding", async () => {
    const res = await env.ASSETS.fetch(new Request("https://example.com/embed.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const body = await res.text();
    expect(body).toContain("data-meetflow-link");
    expect(body).toContain("iframe");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/integration/assets.test.ts`
Expected: FAIL — the asset is missing (404 from `env.ASSETS.fetch`).

- [ ] **Step 3: Create the asset**

Create `public/embed.js`:

```js
(function () {
  "use strict";

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
    var target = event.target;
    var trigger = target && target.closest ? target.closest("[data-meetflow-link]") : null;
    if (!trigger || !ORIGIN) return;
    event.preventDefault();
    var link = trigger.getAttribute("data-meetflow-link");
    if (!link) return;
    show(new URL("/" + link, ORIGIN).href);
  });
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/integration/assets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/embed.js test/integration/assets.test.ts
git commit -m "feat: popup embed script asset (embed.js)"
```

---

### Task 2: Embed dialog tabs in the dashboard

**Files:**
- Modify: `src/views/dashboard.ts` (lines 31-59 snippet fn, 126-182 click handlers, 346-368 dialog markup)
- Modify: `src/styles/app.css` (add `.ui-embed-tab` in `@layer components`, after `.ui-btn-sm`/`.ui-btn-lg` around line 253)
- Test: `test/integration/pages.test.ts` (add test after "renders open/copy actions on event type cards", line ~100)

- [ ] **Step 1: Write the failing test**

Append to `test/integration/pages.test.ts` after the "renders open/copy actions on event type cards" test:

```ts
  it("renders inline and popup embed tabs on event type cards", async () => {
    const host = await createHost("wan");
    await SELF.fetch("https://example.com/api/event-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
    });
    const res = await SELF.fetch("https://example.com/dashboard/event-types", {
      headers: { cookie: host.cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-embed-tab="inline"');
    expect(html).toContain('data-embed-tab="popup"');
    expect(html).toContain('data-embed-code-tab="inline"');
    expect(html).toContain('data-embed-code-tab="popup"');
    expect(html).toContain("ui-embed-tab");
    expect(html).toContain("data-meetflow-link");
    expect(html).toContain("/embed.js");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/integration/pages.test.ts -t "embed tabs"`
Expected: FAIL — no `data-embed-tab` in the HTML.

- [ ] **Step 3: Add the popup snippet generator to `EMBED_SCRIPT`**

In `src/views/dashboard.ts`, replace the `snippet` function (lines 34-36):

```js
      function snippet(url) {
        return '<iframe src="' + url + '" width="100%" height="600" style="border:0" loading="lazy" title="Booking page"></iframe>';
      }
```

with:

```js
      function snippet(url) {
        return '<iframe src="' + url + '" width="100%" height="600" style="border:0" loading="lazy" title="Booking page"></iframe>';
      }

      function popupSnippet(url, link) {
        var scriptUrl = new URL("/embed.js", url).href;
        return [
          "<!-- MeetFlow element-click embed code begins -->",
          "<script>",
          "(function (d, s, u) {",
          "  var js = d.createElement(s);",
          "  js.src = u; js.async = true;",
          "  d.getElementsByTagName(s)[0].parentNode.insertBefore(js, d.getElementsByTagName(s)[0]);",
          '})(document, "script", "' + scriptUrl + '");',
          "<\/script>",
          "<!-- MeetFlow element-click embed code ends -->",
          "",
          "<!-- Add data-meetflow-link to any element; clicking it opens the popup. -->",
          '<button data-meetflow-link="' + link + '">Book now</button>',
        ].join("\n");
      }

      function activateTab(dialog, name) {
        var tabs = dialog.querySelectorAll("[data-embed-tab]");
        Array.prototype.forEach.call(tabs, function (btn) {
          var active = btn.getAttribute("data-embed-tab") === name;
          btn.classList.toggle("ui-embed-tab-active", active);
          btn.setAttribute("aria-selected", active ? "true" : "false");
        });
        var codes = dialog.querySelectorAll("[data-embed-code]");
        Array.prototype.forEach.call(codes, function (code) {
          code.hidden = code.getAttribute("data-embed-code-tab") !== name;
        });
      }
```

- [ ] **Step 4: Update the open handler**

Replace the `[data-embed-open]` block (lines 134-143):

```js
        var openBtn = event.target.closest("[data-embed-open]");
        if (openBtn) {
          var dialog = document.getElementById(openBtn.getAttribute("data-embed-open"));
          if (!dialog) return;
          var url = new URL(openBtn.getAttribute("data-path"), window.location.origin).href;
          var code = dialog.querySelector("[data-embed-code]");
          if (code) code.value = snippet(url);
          dialog.showModal();
          return;
        }
```

with:

```js
        var openBtn = event.target.closest("[data-embed-open]");
        if (openBtn) {
          var dialog = document.getElementById(openBtn.getAttribute("data-embed-open"));
          if (!dialog) return;
          var path = openBtn.getAttribute("data-path");
          var url = new URL(path, window.location.origin).href;
          var inlineCode = dialog.querySelector('[data-embed-code-tab="inline"]');
          var popupCode = dialog.querySelector('[data-embed-code-tab="popup"]');
          if (inlineCode) inlineCode.value = snippet(url);
          if (popupCode) popupCode.value = popupSnippet(url, path.replace(/^\//, ""));
          activateTab(dialog, "inline");
          dialog.showModal();
          return;
        }

        var tabBtn = event.target.closest("[data-embed-tab]");
        if (tabBtn) {
          activateTab(tabBtn.closest("dialog"), tabBtn.getAttribute("data-embed-tab"));
          return;
        }
```

- [ ] **Step 5: Update the copy handler**

Replace the textarea lookup in the `[data-embed-copy]` block (line 154):

```js
          var code = dialog.querySelector("[data-embed-code]");
```

with:

```js
          var code = dialog.querySelector("[data-embed-code]:not([hidden])");
```

- [ ] **Step 6: Update the dialog markup**

Replace the dialog (lines 346-368) with:

```html
        <dialog id="embed-${e.id}" class="ui-dialog" aria-labelledby="embed-${e.id}-title">
          <div class="ui-dialog-body">
            <div class="flex items-center justify-between gap-4">
              <h3 id="embed-${e.id}-title" class="text-sm font-semibold text-ink">
                Embed this booking page
              </h3>
              <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
                      data-dialog-close aria-label="Close">
                ${icon("x", "size-4")}
              </button>
            </div>
            <p class="mt-1 text-[0.8125rem] text-muted">
              Paste this snippet into your website where the booking page should appear.
            </p>
            <div class="mt-3 flex gap-1 border-b border-line" role="tablist" aria-label="Embed type">
              <button type="button" class="ui-embed-tab ui-embed-tab-active" role="tab"
                      aria-selected="true" data-embed-tab="inline">Inline</button>
              <button type="button" class="ui-embed-tab" role="tab" aria-selected="false"
                      data-embed-tab="popup">Popup</button>
            </div>
            <textarea class="ui-input mt-3 resize-none font-mono text-[0.75rem]" rows="4"
                      readonly data-embed-code data-embed-code-tab="inline"></textarea>
            <textarea class="ui-input mt-3 resize-none font-mono text-[0.75rem]" rows="8"
                      readonly data-embed-code data-embed-code-tab="popup" hidden></textarea>
            <div class="mt-3 flex justify-end">
              <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" data-embed-copy>
                ${icon("copy", "size-4")}<span>Copy code</span>
              </button>
            </div>
          </div>
        </dialog>
```

- [ ] **Step 7: Add the tab component CSS**

In `src/styles/app.css`, after the `.ui-btn-lg` rule (around line 258), add:

```css
  .ui-embed-tab {
    @apply -mb-px border-b-2 border-transparent px-3 py-1.5 text-[0.8125rem]
      font-medium text-muted hover:text-ink;
  }

  .ui-embed-tab-active {
    @apply border-primary text-ink;
  }
```

Rebuild the CSS (the public copy is what tests/production serve):

Run: `npm run css`
Expected: exits 0; `public/app.css` now contains `.ui-embed-tab`.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run test/integration/pages.test.ts -t "embed tabs"`
Expected: PASS.

- [ ] **Step 9: Run the full check**

Run: `npm run check`
Expected: prettier check, typecheck, and all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/views/dashboard.ts src/styles/app.css public/app.css test/integration/pages.test.ts
git commit -m "feat: inline/popup embed tabs in dashboard"
```

---

### Task 3: Manual verification and deploy

**Files:** none (verification only)

- [ ] **Step 1: Verify locally**

Run: `npm run dev` (in one terminal), then create `embed-test.html` in `/tmp`:

```html
<!doctype html>
<html>
<body>
<button data-meetflow-link="wmafendi/fundraising-using-digital-briefing">Book now</button>
<script>
(function (d, s, u) {
  var js = d.createElement(s);
  js.src = u; js.async = true;
  d.getElementsByTagName(s)[0].parentNode.insertBefore(js, d.getElementsByTagName(s)[0]);
})(document, "script", "http://localhost:8787/embed.js");
</script>
</body>
</html>
```

Open it in a browser and verify:
- Click "Book now" → modal opens with the booking page inside.
- Escape, backdrop click, and the X all close it.
- Click again → reopens without reloading the page.

On the dashboard, open the Embed dialog and verify:
- "Inline" tab shows the iframe snippet; "Popup" tab shows the loader snippet + example button.
- "Copy code" copies the active tab's content.

- [ ] **Step 2: Deploy**

Run: `npm run deploy`
Expected: wrangler uploads `/embed.js` as a new asset and deploys the worker.

- [ ] **Step 3: Verify production**

Run:
```bash
curl -sI https://meetflow.wmafendi.workers.dev/embed.js | head -3
curl -s https://meetflow.wmafendi.workers.dev/embed.js | head -3
```
Expected: HTTP/2 200, `content-type` contains `javascript`, body starts with `(function () {`.

---

## Self-review notes

- Spec coverage: asset (Task 1), loader + `data-meetflow-link` + delegated click + reusable modal (Task 1 embed.js), origin derivation via `document.currentScript` (Task 1), tabs + copy-on-active-tab (Task 2), tests for asset + dashboard HTML (Tasks 1-2), manual verification + deploy (Task 3). Spec's "Out of scope" items (config options, namespaces, analytics) are not implemented.
- Placeholders: none — all steps contain complete code and commands.
- Type consistency: `activateTab(dialog, name)`, `popupSnippet(url, link)`, `OVERLAY_ID`, `data-embed-code-tab` used consistently across steps.