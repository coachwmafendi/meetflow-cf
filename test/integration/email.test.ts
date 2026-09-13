import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { processEmailJob, queueDueReminders, type EmailJob } from "../../src/services/email";
import { api, createHost, resetDb } from "../helpers";

/** Captures outgoing mail instead of calling Resend. */
function mailbox() {
  const sent: Array<{ to: string[]; subject: string; text: string; reply_to?: string }> = [];
  const impl = (async (_url: unknown, init: unknown) => {
    sent.push(JSON.parse(String((init as RequestInit).body)));
    return new Response(JSON.stringify({ id: "msg_test" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { sent, impl };
}

const mailEnv = {
  ...env,
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "MeetFlow <no-reply@example.com>",
};

async function seedBooking(start = "2026-09-21T01:00:00Z") {
  const host = await createHost("wan", "Asia/Kuala_Lumpur");
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }),
  });
  await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
  });
  const res = await api("/api/public/wan/consultation/book", {
    method: "POST",
    body: JSON.stringify({
      start_at: start,
      guest_name: "Ahmad",
      guest_email: "ahmad@example.com",
      notes: "Discuss ads",
      timezone: "Asia/Kuala_Lumpur",
    }),
  });
  if (res.status !== 201) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  const { booking } = await res.json<{ booking: { id: number } }>();
  return { host, bookingId: booking.id };
}

describe("email jobs", () => {
  beforeEach(resetDb);

  it("sends the guest a confirmation with the details", async () => {
    const { bookingId } = await seedBooking();
    const { sent, impl } = mailbox();

    const outcome = await processEmailJob(
      mailEnv as never,
      { kind: "booking_confirmed", bookingId, to: "guest" },
      impl,
    );

    expect(outcome.status).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["ahmad@example.com"]);
    expect(sent[0]!.subject).toBe("Confirmed: Consultation with wan");
    expect(sent[0]!.text).toContain("09:00–09:30 (Asia/Kuala_Lumpur)");
    expect(sent[0]!.text).toContain("Discuss ads");
  });

  it("sends the host their own notification", async () => {
    const { bookingId } = await seedBooking();
    const { sent, impl } = mailbox();

    await processEmailJob(
      mailEnv as never,
      { kind: "booking_confirmed", bookingId, to: "host" },
      impl,
    );

    expect(sent[0]!.to).toEqual(["wan@example.com"]);
    expect(sent[0]!.subject).toBe("New booking: Ahmad — Consultation");
    expect(sent[0]!.reply_to).toBe("ahmad@example.com");
  });

  it("does nothing at all when no API key is configured", async () => {
    const { bookingId } = await seedBooking();
    const { sent, impl } = mailbox();

    const outcome = await processEmailJob(
      { ...env, RESEND_API_KEY: undefined } as never,
      { kind: "booking_confirmed", bookingId, to: "guest" },
      impl,
    );

    expect(outcome.status).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("skips a confirmation for a booking cancelled before delivery", async () => {
    const { host, bookingId } = await seedBooking();
    await api(`/api/bookings/${bookingId}/cancel`, { method: "POST", cookie: host.cookie });

    const { sent, impl } = mailbox();
    const outcome = await processEmailJob(
      mailEnv as never,
      { kind: "booking_confirmed", bookingId, to: "guest" },
      impl,
    );

    expect(outcome.status).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("sends the cancellation only once the booking really is cancelled", async () => {
    const { host, bookingId } = await seedBooking();
    const job: EmailJob = { kind: "booking_cancelled", bookingId, to: "guest" };

    const early = mailbox();
    expect((await processEmailJob(mailEnv as never, job, early.impl)).status).toBe("skipped");

    await api(`/api/bookings/${bookingId}/cancel`, { method: "POST", cookie: host.cookie });

    const after = mailbox();
    expect((await processEmailJob(mailEnv as never, job, after.impl)).status).toBe("sent");
    expect(after.sent[0]!.subject).toBe("Cancelled: Consultation with wan");
  });

  it("skips a deleted booking instead of throwing", async () => {
    const { sent, impl } = mailbox();
    const outcome = await processEmailJob(
      mailEnv as never,
      { kind: "booking_confirmed", bookingId: 999_999, to: "guest" },
      impl,
    );
    expect(outcome.status).toBe("skipped");
    expect(sent).toHaveLength(0);
  });
});

describe("reminder sweep", () => {
  beforeEach(resetDb);

  it("queues a reminder for a booking inside the next 24 hours", async () => {
    const { bookingId } = await seedBooking("2026-09-21T01:00:00Z");
    const count = await queueDueReminders(env as never, new Date("2026-09-20T12:00:00Z"));
    expect(count).toBe(1);

    const row = await env.DB.prepare("SELECT reminder_sent_at FROM bookings WHERE id = ?")
      .bind(bookingId)
      .first<{ reminder_sent_at: string | null }>();
    expect(row?.reminder_sent_at).not.toBeNull();
  });

  it("ignores bookings further out than the window", async () => {
    await seedBooking("2026-09-21T01:00:00Z");
    expect(await queueDueReminders(env as never, new Date("2026-09-10T12:00:00Z"))).toBe(0);
  });

  it("ignores bookings already in the past", async () => {
    await seedBooking("2026-09-21T01:00:00Z");
    expect(await queueDueReminders(env as never, new Date("2026-09-22T12:00:00Z"))).toBe(0);
  });

  it("never reminds the same booking twice", async () => {
    await seedBooking("2026-09-21T01:00:00Z");
    const now = new Date("2026-09-20T12:00:00Z");
    expect(await queueDueReminders(env as never, now)).toBe(1);
    expect(await queueDueReminders(env as never, now)).toBe(0);
  });

  it("ignores cancelled bookings", async () => {
    const { host } = await seedBooking("2026-09-21T01:00:00Z");
    const list = await api("/api/bookings?scope=upcoming", { cookie: host.cookie });
    const { bookings } = await list.json<{ bookings: Array<{ id: number }> }>();
    await api(`/api/bookings/${bookings[0]!.id}/cancel`, { method: "POST", cookie: host.cookie });

    expect(await queueDueReminders(env as never, new Date("2026-09-20T12:00:00Z"))).toBe(0);
  });
});
