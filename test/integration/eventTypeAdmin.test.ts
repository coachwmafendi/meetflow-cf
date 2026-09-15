import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

async function makeEventType(cookie: string, slug = "consultation") {
  const res = await api("/api/event-types", {
    method: "POST",
    cookie,
    body: JSON.stringify({ name: "Consultation", slug, duration_minutes: 30 }),
  });
  const { eventType } = await res.json<{ eventType: { id: number } }>();
  return eventType.id;
}

function form(fields: Record<string, string>, cookie: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  };
}

const page = (path: string, cookie: string) =>
  SELF.fetch(`https://example.com${path}`, { headers: { cookie } });

describe("event type editing", () => {
  beforeEach(resetDb);

  it("renders the edit page for an owned event type", async () => {
    const host = await createHost("wan");
    const id = await makeEventType(host.cookie);
    const res = await page(`/dashboard/event-types/${id}`, host.cookie);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Save changes");
    expect(html).toContain("Danger zone");
  });

  it("404s another host's event type", async () => {
    const wan = await createHost("wan");
    const ali = await createHost("ali");
    const id = await makeEventType(wan.cookie);

    expect((await page(`/dashboard/event-types/${id}`, ali.cookie)).status).toBe(404);
    expect(
      (
        await SELF.fetch(
          `https://example.com/dashboard/event-types/${id}`,
          form({ name: "Hacked", slug: "x", duration_minutes: "30" }, ali.cookie),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(
          `https://example.com/dashboard/event-types/${id}/delete`,
          form({}, ali.cookie),
        )
      ).status,
    ).toBe(404);
  });

  it("saves an edit", async () => {
    const host = await createHost("wan");
    const id = await makeEventType(host.cookie);

    const res = await SELF.fetch(
      `https://example.com/dashboard/event-types/${id}`,
      form({ name: "Strategy call", slug: "strategy", duration_minutes: "45" }, host.cookie),
    );
    expect(res.status).toBe(302);

    const detail = await api(`/api/event-types/${id}`, { cookie: host.cookie });
    expect(await detail.json()).toMatchObject({
      eventType: { name: "Strategy call", slug: "strategy", duration_minutes: 45 },
    });
  });

  it("re-renders with an error instead of saving rubbish", async () => {
    const host = await createHost("wan");
    const id = await makeEventType(host.cookie);

    const res = await SELF.fetch(
      `https://example.com/dashboard/event-types/${id}`,
      form({ name: "Ok", slug: "ok", duration_minutes: "0" }, host.cookie),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Duration must be between 5 and 480");

    const detail = await api(`/api/event-types/${id}`, { cookie: host.cookie });
    expect(await detail.json()).toMatchObject({ eventType: { duration_minutes: 30 } });
  });

  it("toggles active state", async () => {
    const host = await createHost("wan");
    const id = await makeEventType(host.cookie);

    await SELF.fetch(
      `https://example.com/dashboard/event-types/${id}/toggle`,
      form({}, host.cookie),
    );
    let detail = await api(`/api/event-types/${id}`, { cookie: host.cookie });
    expect(await detail.json()).toMatchObject({ eventType: { is_active: 0 } });

    // Deactivated types disappear from the public page.
    expect((await SELF.fetch("https://example.com/api/public/wan/consultation")).status).toBe(404);

    await SELF.fetch(
      `https://example.com/dashboard/event-types/${id}/toggle`,
      form({}, host.cookie),
    );
    detail = await api(`/api/event-types/${id}`, { cookie: host.cookie });
    expect(await detail.json()).toMatchObject({ eventType: { is_active: 1 } });
  });

  it("returns JSON for the card switch's in-place toggle", async () => {
    const host = await createHost("wan");
    const id = await makeEventType(host.cookie);

    const res = await SELF.fetch(`https://example.com/dashboard/event-types/${id}/toggle`, {
      method: "POST",
      headers: { accept: "application/json", cookie: host.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ is_active: 0 });
  });

  it("hard-deletes an event type with no bookings", async () => {
    const host = await createHost("wan");
    const id = await makeEventType(host.cookie);

    await SELF.fetch(
      `https://example.com/dashboard/event-types/${id}/delete`,
      form({}, host.cookie),
    );
    expect((await api(`/api/event-types/${id}`, { cookie: host.cookie })).status).toBe(404);
  });

  it("deactivates rather than deletes when bookings exist", async () => {
    const host = await createHost("wan", "Asia/Kuala_Lumpur");
    const id = await makeEventType(host.cookie);
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }] }),
    });
    const booked = await api("/api/public/wan/consultation/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-09-21T01:00:00Z",
        guest_name: "Ahmad",
        guest_email: "ahmad@example.com",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    expect(booked.status).toBe(201);

    await SELF.fetch(
      `https://example.com/dashboard/event-types/${id}/delete`,
      form({}, host.cookie),
    );

    // Row survives so the booking keeps its event name, but is hidden.
    const detail = await api(`/api/event-types/${id}`, { cookie: host.cookie });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ eventType: { is_active: 0 } });

    const bookings = await api("/api/bookings?scope=upcoming", { cookie: host.cookie });
    const body = await bookings.json<{ bookings: Array<{ event_name: string }> }>();
    expect(body.bookings[0]!.event_name).toBe("Consultation");
  });
});
