import { describe, expect, it } from "vitest";
import {
  formatWhen,
  guestCancellation,
  guestConfirmation,
  guestReminder,
  hostNotification,
  type BookingEmailContext,
} from "../../src/lib/emailTemplates";

const ctx: BookingEmailContext = {
  guestName: "Ahmad",
  guestEmail: "ahmad@example.com",
  hostName: "Wan",
  hostEmail: "wan@example.com",
  hostSlug: "wan",
  eventName: "Consultation",
  durationMinutes: 30,
  startAt: "2026-09-14T01:00:00Z",
  endAt: "2026-09-14T01:30:00Z",
  notes: null,
  appUrl: "https://meetflow.example",
};

describe("formatWhen", () => {
  it("renders the local day and range", () => {
    expect(formatWhen(ctx.startAt, ctx.endAt, "Asia/Kuala_Lumpur")).toBe(
      "Monday, 14 September 2026 · 09:00–09:30 · Kuala Lumpur (GMT+8)",
    );
  });

  it("renders the same instant differently per timezone", () => {
    expect(formatWhen(ctx.startAt, ctx.endAt, "UTC")).toContain("01:00–01:30 · UTC (GMT)");
    expect(formatWhen(ctx.startAt, ctx.endAt, "America/New_York")).toContain("21:00–21:30");
  });

  it("rolls the date back when the zone is behind UTC", () => {
    // 01:00Z on the 14th is still the 13th in New York.
    expect(formatWhen(ctx.startAt, ctx.endAt, "America/New_York")).toContain(
      "Sunday, 13 September",
    );
  });
});

describe("guestConfirmation", () => {
  it("addresses the guest and lets them reply to the host", () => {
    const mail = guestConfirmation(ctx, "Asia/Kuala_Lumpur");
    expect(mail.to).toBe("ahmad@example.com");
    expect(mail.replyTo).toBe("wan@example.com");
    expect(mail.subject).toBe("Confirmed: Consultation with Wan");
  });

  it("shows the time in the guest's own timezone", () => {
    const mail = guestConfirmation(ctx, "America/New_York");
    expect(mail.text).toContain("21:00–21:30 · New York (GMT-4)");
  });

  it("ships both html and plain text", () => {
    const mail = guestConfirmation(ctx, "UTC");
    expect(mail.html).toContain("<!doctype html>");
    expect(mail.text).toContain("Your booking is confirmed");
    expect(mail.text).not.toContain("<");
  });

  it("includes the guest note when there is one", () => {
    const mail = guestConfirmation({ ...ctx, notes: "Discuss Q4 ads" }, "UTC");
    expect(mail.text).toContain("Discuss Q4 ads");
  });
});

describe("hostNotification", () => {
  it("goes to the host in the host's timezone, replying to the guest", () => {
    const mail = hostNotification(ctx, "Asia/Kuala_Lumpur");
    expect(mail.to).toBe("wan@example.com");
    expect(mail.replyTo).toBe("ahmad@example.com");
    expect(mail.subject).toBe("New booking: Ahmad — Consultation");
    expect(mail.text).toContain("09:00–09:30 · Kuala Lumpur (GMT+8)");
    expect(mail.text).toContain("ahmad@example.com");
  });
});

describe("guestCancellation and guestReminder", () => {
  it("cancellation points back at the booking page", () => {
    const mail = guestCancellation(ctx, "UTC");
    expect(mail.subject).toBe("Cancelled: Consultation with Wan");
    expect(mail.text).toContain("https://meetflow.example/wan");
  });

  it("reminder is addressed to the guest", () => {
    const mail = guestReminder(ctx, "UTC");
    expect(mail.to).toBe("ahmad@example.com");
    expect(mail.subject).toBe("Tomorrow: Consultation with Wan");
  });
});

describe("escaping", () => {
  it("never lets a guest name inject markup into the html body", () => {
    const mail = hostNotification({ ...ctx, guestName: "<script>alert(1)</script>" }, "UTC");
    expect(mail.html).not.toContain("<script>alert(1)</script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("escapes notes too", () => {
    const mail = hostNotification({ ...ctx, notes: '"><img onerror=alert(1)>' }, "UTC");
    expect(mail.html).not.toContain("<img onerror");
  });
});
