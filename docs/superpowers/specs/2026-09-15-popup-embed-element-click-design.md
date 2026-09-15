# Design: Popup embed via element click

Date: 2026-09-15 · Status: approved by user

A second embed mode for booking pages, in the style of Cal.com's element-click
embed: the host pastes a small loader script once, marks any element with
`data-meetflow-link="userSlug/eventSlug"`, and a click opens the booking page in
a centered modal overlay. Complements the existing inline iframe embed; the
dashboard dialog gains tabs to choose between the two.

## Architecture

- `public/embed.js` — new static asset, served through the existing Assets
  binding (same path as fonts and `app.css`). Vanilla JS, zero dependencies,
  defensive (no errors thrown on hostile pages).
- Loader snippet — a ~10-line `<script>` the host pastes into any page; it
  injects `embed.js` async from the MeetFlow origin.
- Trigger attribute — any element carrying `data-meetflow-link` becomes a
  trigger. One delegated `document` click listener binds all current and
  future (dynamically added) triggers; no per-element wiring.

## Loader snippet

```html
<!-- MeetFlow element-click embed code begins -->
<script>
(function (d, s, u) {
  var js = d.createElement(s);
  js.src = u; js.async = true;
  d.getElementsByTagName(s)[0].parentNode.insertBefore(js, d.getElementsByTagName(s)[0]);
})(document, "script", "https://meetflow.wmafendi.workers.dev/embed.js");
</script>
<!-- MeetFlow element-click embed code ends -->

<button data-meetflow-link="wmafendi/fundraising-using-digital-briefing">Book now</button>
```

embed.js derives the MeetFlow origin from `document.currentScript.src`, so the
snippet works unchanged on any deployment (local, workers.dev, custom domain).

## embed.js behavior

- On load: bind one delegated click listener. When
  `event.target.closest("[data-meetflow-link]")` matches: `preventDefault()`,
  build `origin + "/" + link`, open the modal.
- Modal: dark fixed backdrop; centered container `max-width: 1024px`,
  `min(90vh, 800px)`; iframe fills it (`width/height: 100%`); close X button,
  Escape key, and backdrop click all close. The overlay and iframe are created
  once per session and reused for subsequent clicks (iframe not recreated).
- Link values are read via the attribute (browser-parsed, no manual HTML
  injection); the iframe `src` is built with `new URL(...)` — a malformed link
  silently does nothing.
- Modal markup/styles are injected inline by embed.js; it must not assume the
  host page has any styling. Uses a reserved id prefix (`__meetflow_embed_`) to
  avoid clashing with host elements.
- No X-Frame-Options/CSP frame-ancestors headers exist on the booking page
  (verified), so the iframe renders.

## Dashboard changes (src/views/dashboard.ts)

- The per-event-type embed dialog gains two tabs: **Inline** (existing iframe
  snippet) and **Popup** (loader script + example trigger button).
- The readonly textarea (`data-embed-code`) and the copy button operate on the
  active tab. The snippet is still built client-side from `window.location.origin`
  and `data-path` (`/${user.slug}/${e.slug}`), as today.
- Popup tab snippet = loader script with the origin-derived embed.js URL, plus
  a commented example button carrying `data-meetflow-link="<slug path>"`.

## Error handling

- embed.js never throws on host pages: everything is wrapped defensively;
  malformed links and absent elements are no-ops.
- If embed.js fails to load (CDN down), clicking a trigger does nothing — no
  broken UI beyond the missing popup.

## Testing

- Integration (test/integration/pages.test.ts, extended):
  - `/embed.js` is served with JavaScript content-type.
  - Dashboard HTML contains both tabs and the popup snippet contains
    `data-meetflow-link` and the loader script.
- Manual: paste the popup snippet into a standalone HTML page, click the
  trigger, confirm the modal opens, the booking flow works, and Escape/backdrop/X
  close it.

## Out of scope

- Config options (layout, theme, custom button colors) — YAGNI.
- Multiple namespaces / queue-based init API like Cal.com — the simple loader
  covers the need; revisit only if hosts ask for it.
- Analytics/events on embed usage.