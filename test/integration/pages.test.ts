import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createHost, resetDb } from "../helpers";

describe("pages", () => {
  beforeEach(resetDb);

  it("serves the login page as HTML", async () => {
    const res = await SELF.fetch("https://example.com/login");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Sign in");
  });

  it("redirects an anonymous visitor away from the dashboard", async () => {
    const res = await SELF.fetch("https://example.com/dashboard", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("renders the dashboard for a signed-in host", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch("https://example.com/dashboard", {
      headers: { cookie: host.cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Upcoming");
    expect(html).toContain("app-sidebar");
    expect(html).toContain("ui-side-link-active");
  });

  it("404s an unknown public profile", async () => {
    const res = await SELF.fetch("https://example.com/nobody");
    expect(res.status).toBe(404);
  });

  it("renders a public booking page", async () => {
    const host = await createHost("wan");
    await SELF.fetch("https://example.com/api/event-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
    });
    const res = await SELF.fetch("https://example.com/wan/consultation");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Confirm booking");
    expect(html).toContain('id="page-data"');
    expect(html).toContain("ui-day");
    expect(html).toContain("data-timezone");
  });

  it("renders open/copy actions on event type cards", async () => {
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
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('data-copy="/wan/consultation"');
    expect(html).toContain("Copy link");
    expect(html).toContain("Embed");
    expect(html).toContain('data-embed-open="embed-');
    expect(html).toContain("Clone");
    expect(html).toContain("Delete");
    expect(html).toContain("ui-menu");
  });

  it("shows public page actions at the sidebar bottom", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch("https://example.com/dashboard", {
      headers: { cookie: host.cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Copy public page link");
    expect(html).toContain('data-copy="/wan"');
    expect(html).toContain("View public page");
  });

  it("escapes host-controlled text", async () => {
    const host = await createHost("wan");
    await SELF.fetch("https://example.com/api/event-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({
        name: "<script>alert(1)</script>",
        slug: "xss",
        duration_minutes: 30,
      }),
    });
    const res = await SELF.fetch("https://example.com/dashboard/event-types", {
      headers: { cookie: host.cookie },
    });
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("round-trips the availability form without losing windows", async () => {
    const host = await createHost("wan");
    await SELF.fetch("https://example.com/api/availability", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({
        rules: [
          { day_of_week: 1, start_time: "09:00", end_time: "12:00" },
          { day_of_week: 1, start_time: "14:00", end_time: "17:00" },
        ],
      }),
    });

    // Re-submit the rendered form untouched: the blank spare row must be dropped
    // and both Monday windows must survive.
    const form = new URLSearchParams();
    for (let day = 0; day <= 6; day++) {
      if (day === 1) {
        form.append("start_1", "09:00");
        form.append("end_1", "12:00");
        form.append("start_1", "14:00");
        form.append("end_1", "17:00");
      }
      form.append(`start_${day}`, "");
      form.append(`end_${day}`, "");
    }

    const res = await SELF.fetch("https://example.com/dashboard/availability", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: host.cookie,
      },
      body: form.toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);

    const after = await SELF.fetch("https://example.com/api/availability", {
      headers: { cookie: host.cookie },
    });
    const { rules } = await after.json<{
      rules: Array<{ day_of_week: number; start_time: string; end_time: string }>;
    }>();
    expect(rules.map((r) => `${r.day_of_week} ${r.start_time}-${r.end_time}`)).toEqual([
      "1 09:00-12:00",
      "1 14:00-17:00",
    ]);
  });

  it("logs out and clears the cookie", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch("https://example.com/logout", {
      method: "POST",
      headers: { cookie: host.cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("renders a toast from the query param", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch(
      "https://example.com/dashboard/event-types?toast=Event+type+cloned",
      { headers: { cookie: host.cookie } },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Event type cloned");
    expect(html).toContain('class="toast"');
  });

  it("clones an event type with a unique slug", async () => {
    const host = await createHost("wan");
    const created = await SELF.fetch("https://example.com/api/event-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
    });
    const { eventType } = await created.json<{ eventType: { id: number } }>();

    const first = await SELF.fetch(
      `https://example.com/dashboard/event-types/${eventType.id}/clone`,
      { method: "POST", headers: { cookie: host.cookie }, redirect: "manual" },
    );
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toContain("toast=Event%20type%20cloned");

    const second = await SELF.fetch(
      `https://example.com/dashboard/event-types/${eventType.id}/clone`,
      { method: "POST", headers: { cookie: host.cookie }, redirect: "manual" },
    );
    expect(second.status).toBe(302);

    const list = await SELF.fetch("https://example.com/dashboard/event-types", {
      headers: { cookie: host.cookie },
    });
    const html = await list.text();
    expect(html).toContain("/wan/consultation-copy");
    expect(html).toContain("/wan/consultation-copy-2");
    expect(html).toContain("Consultation (copy)");
  });

  it("deleting an event type redirects with a toast", async () => {
    const host = await createHost("wan");
    const created = await SELF.fetch("https://example.com/api/event-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
    });
    const { eventType } = await created.json<{ eventType: { id: number } }>();

    const res = await SELF.fetch(
      `https://example.com/dashboard/event-types/${eventType.id}/delete`,
      { method: "POST", headers: { cookie: host.cookie }, redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("toast=Event%20type%20deleted");

    const list = await SELF.fetch("https://example.com/dashboard/event-types", {
      headers: { cookie: host.cookie },
    });
    expect(await list.text()).not.toContain("/wan/consultation");
  });
});
