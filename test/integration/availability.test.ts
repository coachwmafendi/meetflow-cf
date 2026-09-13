import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

const rules = [
  { day_of_week: 1, start_time: "09:00", end_time: "12:00" },
  { day_of_week: 1, start_time: "14:00", end_time: "17:00" },
  { day_of_week: 2, start_time: "09:00", end_time: "12:00" },
];

describe("availability", () => {
  beforeEach(resetDb);

  it("requires auth", async () => {
    expect((await api("/api/availability")).status).toBe(401);
  });

  it("starts empty", async () => {
    const host = await createHost("wan");
    const res = await api("/api/availability", { cookie: host.cookie });
    expect(await res.json()).toEqual({ rules: [] });
  });

  it("replaces the whole week on PUT", async () => {
    const host = await createHost("wan");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules }),
    });
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 3, start_time: "10:00", end_time: "11:00" }] }),
    });
    const res = await api("/api/availability", { cookie: host.cookie });
    const body = await res.json<{ rules: Array<{ day_of_week: number }> }>();
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]!.day_of_week).toBe(3);
  });

  it("allows two windows on the same day", async () => {
    const host = await createHost("wan");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules }),
    });
    const res = await api("/api/availability", { cookie: host.cookie });
    const body = await res.json<{ rules: unknown[] }>();
    expect(body.rules).toHaveLength(3);
  });

  it("rejects end before start", async () => {
    const host = await createHost("wan");
    const res = await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "17:00", end_time: "09:00" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a bad day_of_week", async () => {
    const host = await createHost("wan");
    const res = await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 7, start_time: "09:00", end_time: "10:00" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("keeps hosts isolated", async () => {
    const wan = await createHost("wan");
    const ali = await createHost("ali");
    await api("/api/availability", {
      method: "PUT",
      cookie: wan.cookie,
      body: JSON.stringify({ rules }),
    });
    const res = await api("/api/availability", { cookie: ali.cookie });
    expect(await res.json()).toEqual({ rules: [] });
  });
});
