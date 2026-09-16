import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

/**
 * Date-specific events: a dates-only type ignores the weekly grid and opens
 * slots exactly on its listed dates — the twice-a-year briefing case.
 */
describe("event dates", () => {
  beforeEach(resetDb);

  // Weekly rules stay wide open on Mondays so the tests prove the dates-only
  // type genuinely ignores them, not just that a narrow window fits nothing.
  async function seedDatesEvent() {
    const host = await createHost("wan", "Asia/Kuala_Lumpur");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({
        rules: [{ day_of_week: 1, start_time: "09:00", end_time: "20:00" }],
      }),
    });
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "Fundraising Briefing",
        slug: "briefing",
        duration_minutes: 300,
        seats_total: 2,
        dates_only: 1,
        dates: [
          // 6.5h window, deliberately NOT a multiple of the 300m duration:
          // one date row must be exactly ONE session, start to end.
          { date: "2026-12-05", start_time: "09:00", end_time: "15:30" },
          { date: "2027-03-14", start_time: "09:00", end_time: "15:30" },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const { eventType } = await created.json<{ eventType: { id: number } }>();
    return { host, eventTypeId: eventType.id };
  }

  const SLOT = "2026-12-05T01:00:00Z"; // 2026-12-05 09:00 in Kuala Lumpur
  const SLOT_END = "2026-12-05T07:30:00Z"; // 15:30 in Kuala Lumpur — the full window

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
    return { res, body: await res.json<Record<string, unknown>>() };
  }

  function SELF_fetch(path: string, init?: RequestInit) {
    return SELF.fetch(`https://example.com${path}`, init);
  }

  it("opens slots only on the listed dates, never on the weekly grid", async () => {
    await seedDatesEvent();

    const onDate = await api(`/api/public/wan/briefing/slots?date=2026-12-05`);
    const onDateBody = await onDate.json<{ slots: Array<{ startAt: string; endAt: string }> }>();
    expect(onDateBody.slots.map((s) => s.startAt)).toEqual([SLOT]);
    expect(onDateBody.slots[0]!.endAt).toBe(SLOT_END);

    // A Monday inside the weekly grid, but not a listed date.
    const monday = await api(`/api/public/wan/briefing/slots?date=2026-10-05`);
    expect((await monday.json<{ slots: unknown[] }>()).slots).toEqual([]);

    const month = await api(`/api/public/wan/briefing/month?year=2026&month=12`);
    expect((await month.json<{ days: string[] }>()).days).toEqual(["2026-12-05"]);
  });

  it("books a seat on a listed date and refuses the weekly grid", async () => {
    await seedDatesEvent();

    const first = await book(SLOT, "Ahmad", "ahmad@example.com");
    expect(first.res.status).toBe(201);
    // The booking spans the whole listed window, not start + duration.
    expect((first.body.booking as { end_at: string }).end_at).toBe(SLOT_END);
    const attendee = first.body.attendee as { ticket_code: string };
    expect(attendee.ticket_code).toMatch(/^MF-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);

    const offGrid = await book("2026-10-05T01:00:00Z", "Bella", "bella@example.com");
    expect(offGrid.res.status).toBe(422);
    expect(offGrid.body.error).toBe("That time is not available");
  });

  it("keeps seats working on a dates-only slot", async () => {
    await seedDatesEvent();

    const first = await book(SLOT, "Ahmad", "ahmad@example.com");
    expect(first.res.status).toBe(201);
    const second = await book(SLOT, "Bella", "bella@example.com");
    expect(second.res.status).toBe(201);
    expect((second.body.booking as { id: number }).id).toBe(
      (first.body.booking as { id: number }).id,
    );

    const third = await book(SLOT, "Cody", "cody@example.com");
    expect(third.res.status).toBe(409);
    expect(third.body.error).toBe("This event is fully booked.");
  });

  it("leaves weekly event types on the same host untouched", async () => {
    const { host } = await seedDatesEvent();
    await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 60 }),
    });

    // The dates-only type sees nothing on a Monday; the weekly type does.
    const dates = await api(`/api/public/wan/briefing/slots?date=2026-10-05`);
    expect((await dates.json<{ slots: unknown[] }>()).slots).toEqual([]);

    const weekly = await api(`/api/public/wan/consultation/slots?date=2026-10-05`);
    const { slots } = await weekly.json<{ slots: Array<{ startAt: string }> }>();
    expect(slots[0]!.startAt).toBe("2026-10-05T01:00:00Z");
  });

  it("updates the date set and can switch back to the weekly grid", async () => {
    const { host, eventTypeId } = await seedDatesEvent();

    const swapped = await api(`/api/event-types/${eventTypeId}`, {
      method: "PATCH",
      cookie: host.cookie,
      body: JSON.stringify({
        dates: [{ date: "2027-03-14", start_time: "09:00", end_time: "14:00" }],
      }),
    });
    expect(swapped.status).toBe(200);

    const old = await api(`/api/public/wan/briefing/slots?date=2026-12-05`);
    expect((await old.json<{ slots: unknown[] }>()).slots).toEqual([]);
    const fresh = await api(`/api/public/wan/briefing/slots?date=2027-03-14`);
    expect((await fresh.json<{ slots: Array<{ startAt: string }> }>()).slots).toHaveLength(1);

    // Back to weekly: Monday slots return, listed dates stop being used.
    const weekly = await api(`/api/event-types/${eventTypeId}`, {
      method: "PATCH",
      cookie: host.cookie,
      body: JSON.stringify({ dates_only: 0 }),
    });
    expect(weekly.status).toBe(200);
    const monday = await api(`/api/public/wan/briefing/slots?date=2026-10-05`);
    const { slots } = await monday.json<{ slots: Array<{ startAt: string }> }>();
    expect(slots[0]!.startAt).toBe("2026-10-05T01:00:00Z");

    // A dates-only type must keep at least one date.
    const emptied = await api(`/api/event-types/${eventTypeId}`, {
      method: "PATCH",
      cookie: host.cookie,
      body: JSON.stringify({ dates_only: 1, dates: [] }),
    });
    expect(emptied.status).toBe(400);
  });

  it("ignores buffer for dates-only sessions, so same-day sessions can touch", async () => {
    const host = await createHost("wan", "Asia/Kuala_Lumpur");
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "Expo",
        slug: "expo",
        duration_minutes: 90,
        buffer_minutes: 30,
        seats_total: 10,
        dates_only: 1,
        dates: [
          { date: "2026-12-05", start_time: "10:00", end_time: "11:30" },
          { date: "2026-12-05", start_time: "11:30", end_time: "13:00" },
        ],
      }),
    });
    expect(created.status).toBe(201);

    // Both sessions listed, even though a 30m buffer would overlap them.
    const slots = await api(`/api/public/wan/expo/slots?date=2026-12-05`);
    const { slots: list } = await slots.json<{ slots: Array<{ startAt: string }> }>();
    expect(list.map((s) => s.startAt)).toEqual(["2026-12-05T02:00:00Z", "2026-12-05T03:30:00Z"]);

    // Booking the second right after the first must not be blocked by padding.
    const first = await api("/api/public/wan/expo/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-12-05T02:00:00Z",
        guest_name: "Ahmad",
        guest_email: "ahmad@example.com",
        timezone: "UTC",
      }),
    });
    expect(first.status).toBe(201);
    const second = await api("/api/public/wan/expo/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-12-05T03:30:00Z",
        guest_name: "Bella",
        guest_email: "bella@example.com",
        timezone: "UTC",
      }),
    });
    expect(second.status).toBe(201);
  });

  it("rejects malformed dates and dates-only without dates", async () => {
    const host = await createHost("wan");

    const badRow = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "X",
        slug: "x",
        duration_minutes: 60,
        dates_only: 1,
        dates: [{ date: "2026-13-45", start_time: "14:00", end_time: "09:00" }],
      }),
    });
    expect(badRow.status).toBe(400);

    const noDates = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "X", slug: "x", duration_minutes: 60, dates_only: 1 }),
    });
    expect(noDates.status).toBe(400);
  });

  it("renders the ticket view with sessions baked in (no client fetch needed)", async () => {
    await seedDatesEvent();
    const html = await (await SELF_fetch("/wan/briefing")).text();
    expect(html).toContain("Upcoming sessions");
    expect(html).toContain("Get ticket");
    expect(html).toContain('"datesOnly":true');
    // Server-rendered sessions: date, full window span and seats.
    expect(html).toContain('"date":"2026-12-05"');
    expect(html).toContain('"startAt":"2026-12-05T01:00:00Z"');
    expect(html).toContain('"endAt":"2026-12-05T07:30:00Z"');
    expect(html).toContain('"seatsLeft":2');
  });

  it("shows the schedule editor on the edit page and saves date rows", async () => {
    const { host, eventTypeId } = await seedDatesEvent();

    const page = await SELF_fetch("/dashboard/event-types/" + eventTypeId, {
      headers: { cookie: host.cookie },
    });
    const editHtml = await page.text();
    expect(editHtml).toContain("Specific dates only");
    expect(editHtml).toContain('value="2026-12-05"');
    expect(editHtml).toContain('name="ed_date_0"');

    const saved = await SELF_fetch("/dashboard/event-types/" + eventTypeId, {
      method: "POST",
      headers: { cookie: host.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: "Fundraising Briefing",
        slug: "briefing",
        duration_minutes: "300",
        buffer_minutes: "0",
        booking_style: "group",
        group_seats: "2",
        schedule_mode: "dates",
        ed_count: "1",
        ed_date_0: "2027-03-14",
        ed_start_0: "09:00",
        ed_end_0: "14:00",
        description: "",
        location_type: "none",
        location_value: "",
      }).toString(),
    });
    expect(saved.status).toBe(200);

    const stored = await env.DB.prepare(
      "SELECT date FROM event_dates WHERE event_type_id = ? ORDER BY date",
    )
      .bind(eventTypeId)
      .all<{ date: string }>();
    expect(stored.results.map((r) => r.date)).toEqual(["2027-03-14"]);
  });
});
