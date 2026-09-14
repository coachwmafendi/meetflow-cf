import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

describe("event types", () => {
  beforeEach(resetDb);

  it("requires auth", async () => {
    expect((await api("/api/event-types")).status).toBe(401);
  });

  it("creates and lists an event type", async () => {
    const host = await createHost("wan");
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "Consultation",
        slug: "consultation",
        description: "A 30-minute consultation",
        duration_minutes: 30,
      }),
    });
    expect(created.status).toBe(201);

    const list = await api("/api/event-types", { cookie: host.cookie });
    const { eventTypes } = await list.json<{ eventTypes: Array<{ slug: string }> }>();
    expect(eventTypes).toHaveLength(1);
    expect(eventTypes[0]!.slug).toBe("consultation");
  });

  it("rejects a duplicate slug for the same host", async () => {
    const host = await createHost("wan");
    const payload = JSON.stringify({ name: "C", slug: "consultation", duration_minutes: 30 });
    await api("/api/event-types", { method: "POST", cookie: host.cookie, body: payload });
    const dup = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: payload,
    });
    expect(dup.status).toBe(409);
  });

  it("rejects an out-of-range duration", async () => {
    const host = await createHost("wan");
    const res = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "C", slug: "c", duration_minutes: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("stores a location and normalizes bare meeting links", async () => {
    const host = await createHost("wan");
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "C",
        slug: "c",
        duration_minutes: 30,
        location_type: "google_meet",
        location_value: "meet.google.com/abc-xyz",
      }),
    });
    expect(created.status).toBe(201);
    const { eventType } = await created.json<{
      eventType: { location_type: string; location_value: string | null };
    }>();
    expect(eventType.location_type).toBe("google_meet");
    expect(eventType.location_value).toBe("https://meet.google.com/abc-xyz");
  });

  it("rejects an unknown location type", async () => {
    const host = await createHost("wan");
    const res = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "C",
        slug: "c",
        duration_minutes: 30,
        location_type: "teams",
        location_value: "https://example.com",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("requires a value when a location is set", async () => {
    const host = await createHost("wan");
    const res = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "C",
        slug: "c",
        duration_minutes: 30,
        location_type: "in_person",
      }),
    });
    expect(res.status).toBe(400);
    const { error } = await res.json<{ error: string }>();
    expect(error).toContain("location_value");
  });

  it("remembers meeting links for reuse, deduplicated per platform", async () => {
    const host = await createHost("wan");
    const payload = (slug: string) => ({
      name: "C",
      slug,
      duration_minutes: 30,
      location_type: "google_meet",
      location_value: "https://meet.google.com/room-a",
    });
    await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify(payload("a")),
    });
    await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify(payload("b")),
    });

    const res = await api("/api/event-types/locations?type=google_meet", {
      cookie: host.cookie,
    });
    expect(res.status).toBe(200);
    const { locations } = await res.json<{ locations: string[] }>();
    expect(locations).toEqual(["https://meet.google.com/room-a"]);

    const other = await api("/api/event-types/locations?type=zoom", { cookie: host.cookie });
    expect((await other.json<{ locations: string[] }>()).locations).toEqual([]);
  });

  it("does not leak another host's event type", async () => {
    const wan = await createHost("wan");
    const ali = await createHost("ali");
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: wan.cookie,
      body: JSON.stringify({ name: "C", slug: "c", duration_minutes: 30 }),
    });
    const { eventType } = await created.json<{ eventType: { id: number } }>();

    expect((await api(`/api/event-types/${eventType.id}`, { cookie: ali.cookie })).status).toBe(
      404,
    );
    expect(
      (
        await api(`/api/event-types/${eventType.id}`, {
          method: "PATCH",
          cookie: ali.cookie,
          body: JSON.stringify({ name: "Hacked" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(`/api/event-types/${eventType.id}`, {
          method: "DELETE",
          cookie: ali.cookie,
        })
      ).status,
    ).toBe(404);
  });

  it("can be deactivated via PATCH", async () => {
    const host = await createHost("wan");
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "C", slug: "c", duration_minutes: 30 }),
    });
    const { eventType } = await created.json<{ eventType: { id: number } }>();

    const patched = await api(`/api/event-types/${eventType.id}`, {
      method: "PATCH",
      cookie: host.cookie,
      body: JSON.stringify({ is_active: 0 }),
    });
    expect(patched.status).toBe(200);
    const { eventType: updated } = await patched.json<{ eventType: { is_active: number } }>();
    expect(updated.is_active).toBe(0);
  });
});
