import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

describe("ticket manager", () => {
  beforeEach(resetDb);

  async function seedDatesEvent() {
    const host = await createHost("wan", "Asia/Kuala_Lumpur");
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "Briefing",
        slug: "briefing",
        duration_minutes: 90,
        seats_total: 3,
        dates_only: 1,
        dates: [
          { date: "2026-12-05", start_time: "09:00", end_time: "11:00" },
          { date: "2027-03-14", start_time: "09:00", end_time: "11:00" },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const { eventType } = await created.json<{ eventType: { id: number } }>();
    return { host, eventTypeId: eventType.id };
  }

  async function book(startAt: string, name: string, email: string) {
    const res = await api("/api/public/wan/briefing/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: startAt,
        guest_name: name,
        guest_email: email,
        timezone: "UTC",
      }),
    });
    expect(res.status).toBe(201);
    return res;
  }

  it("lists sessions, guests and totals; check-in round-trips from the page", async () => {
    const { host, eventTypeId } = await seedDatesEvent();
    await book("2026-12-05T01:00:00Z", "Ahmad", "ahmad@example.com");
    await book("2026-12-05T01:00:00Z", "Bella", "bella@example.com");
    await book("2027-03-14T01:00:00Z", "Cody", "cody@example.com");

    const page = await SELF.fetch(
      `https://example.com/dashboard/event-types/${eventTypeId}/tickets`,
      {
        headers: { cookie: host.cookie },
      },
    );
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Ticket manager");
    expect(html).toContain("Ahmad");
    expect(html).toContain("MF-");
    expect(html).toContain("Sat 05 Dec");
    expect(html).toContain("2/3");
    expect(html).toContain("/dashboard/event-types/");
    expect(html).toContain("door=1");

    // Check in Ahmad from the manager page and come back.
    const row = html.match(
      new RegExp(
        `/dashboard/bookings/(\\d+)/attendees/(\\d+)/check-in\\?back=[^"]*"[^>]*>[^\\v]*?Check in`,
      ),
    );
    expect(row).not.toBeNull();
    const bookingId = row![1]!;
    const attendeeId = row![2]!;
    const post = await SELF.fetch(
      `https://example.com/dashboard/bookings/${bookingId}/attendees/${attendeeId}/check-in?back=%2Fdashboard%2Fevent-types%2F${eventTypeId}%2Ftickets`,
      {
        method: "POST",
        headers: { cookie: host.cookie },
        redirect: "manual",
      },
    );
    expect(post.status).toBe(302);
    expect(post.headers.get("location")).toContain(`/dashboard/event-types/${eventTypeId}/tickets`);

    const after = await SELF.fetch(
      `https://example.com/dashboard/event-types/${eventTypeId}/tickets`,
      { headers: { cookie: host.cookie } },
    );
    const afterHtml = await after.text();
    expect(afterHtml).toContain('data-state="in"');
    expect(afterHtml).toMatch(/Checked in<\/p>/);
  });

  it("door mode defaults to the not-checked-in console", async () => {
    const { host, eventTypeId } = await seedDatesEvent();
    await book("2026-12-05T01:00:00Z", "Ahmad", "ahmad@example.com");

    const page = await SELF.fetch(
      `https://example.com/dashboard/event-types/${eventTypeId}/tickets?door=1`,
      { headers: { cookie: host.cookie } },
    );
    const html = await page.text();
    expect(html).toContain("Door check-in");
    expect(html).toContain("data-guest-default-filter");
    expect(html).toContain("Search name, code or email");
  });

  it("serves weekly group events with booked slots as sessions", async () => {
    const host = await createHost("wan2", "Asia/Kuala_Lumpur");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }] }),
    });
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "Workshop",
        slug: "workshop",
        duration_minutes: 60,
        seats_total: 5,
      }),
    });
    const { eventType } = await created.json<{ eventType: { id: number } }>();
    const res = await api("/api/public/wan2/workshop/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-10-05T01:00:00Z",
        guest_name: "Ahmad",
        guest_email: "ahmad@example.com",
        timezone: "UTC",
      }),
    });
    expect(res.status).toBe(201);

    const page = await SELF.fetch(
      `https://example.com/dashboard/event-types/${eventType.id}/tickets`,
      {
        headers: { cookie: host.cookie },
      },
    );
    const html = await page.text();
    expect(html).toContain("Mon 05 Oct");
    expect(html).toContain("Ahmad");
  });

  it("blocks other hosts and guests", async () => {
    const { eventTypeId } = await seedDatesEvent();
    const stranger = await createHost("stranger", "UTC");
    const res = await SELF.fetch(
      `https://example.com/dashboard/event-types/${eventTypeId}/tickets`,
      {
        headers: { cookie: stranger.cookie },
      },
    );
    expect(res.status).toBe(404);
  });
});
