import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("schema", () => {
  it("creates the four core tables", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["availability_rules", "bookings", "event_types", "users"]),
    );
  });

  it("enforces the confirmed-start unique index", async () => {
    const now = "2026-09-13T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO users (id,name,email,password_hash,slug,timezone,created_at,updated_at)
       VALUES (900,'U','u900@example.com','x','u900','UTC',?,?)`,
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO event_types (id,user_id,name,slug,duration_minutes,is_active,created_at,updated_at)
       VALUES (900,900,'E','e',30,1,?,?)`,
    )
      .bind(now, now)
      .run();

    const insert = (endAt: string) =>
      env.DB.prepare(
        `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
         VALUES (900,900,'G','g@example.com','2026-10-01T01:00:00Z',?, 'UTC','confirmed',?,?)`,
      )
        .bind(endAt, now, now)
        .run();

    await insert("2026-10-01T01:30:00Z");
    await expect(insert("2026-10-01T02:00:00Z")).rejects.toThrow();
  });
});
