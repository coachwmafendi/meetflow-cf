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
