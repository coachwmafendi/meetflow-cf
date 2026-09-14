import { escapeHtml } from "../views/layout";
import { utcToZonedParts } from "./timezone";
import { zoneDisplay } from "./timezoneList";
import type { EmailMessage } from "./resend";

/**
 * Transactional email bodies. Pure functions — no bindings, no fetch — so the
 * wording and the timezone maths are testable without a network or a database.
 *
 * Every email is sent as HTML and plain text. The layout is deliberately plain:
 * tables and inline styles, because mail clients are not browsers.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

export interface BookingEmailContext {
  guestName: string;
  guestEmail: string;
  hostName: string;
  hostEmail: string;
  hostSlug: string;
  eventName: string;
  durationMinutes: number;
  /** Fixed-width UTC. */
  startAt: string;
  endAt: string;
  notes: string | null;
  appUrl: string;
  /** Signed guest cancellation link. Absent for host-facing mail. */
  cancelUrl?: string;
  /** Signed guest reschedule link. Absent for host-facing mail. */
  rescheduleUrl?: string;
}

/** "Monday, 14 September 2026 · 09:00–09:30 · Kuala Lumpur (GMT+8)" */
export function formatWhen(startAt: string, endAt: string, timeZone: string): string {
  const s = utcToZonedParts(new Date(startAt), timeZone);
  const e = utcToZonedParts(new Date(endAt), timeZone);
  const weekday = DAYS[new Date(Date.UTC(s.year, s.month - 1, s.day)).getUTCDay()]!;
  return (
    `${weekday}, ${s.day} ${MONTHS[s.month - 1]} ${s.year} · ` +
    `${pad(s.hour)}:${pad(s.minute)}–${pad(e.hour)}:${pad(e.minute)} · ${zoneDisplay(timeZone, new Date(startAt))}`
  );
}

interface Layout {
  heading: string;
  intro: string;
  rows: Array<[string, string]>;
  note?: string | null;
  cta?: { label: string; href: string };
  cta2?: { label: string; href: string };
  footer: string;
}

function render(layout: Layout): { html: string; text: string } {
  const rows = layout.rows
    .map(
      ([label, value]) =>
        `<tr>
           <td style="padding:6px 16px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap;">${escapeHtml(
             label,
           )}</td>
           <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:500;">${escapeHtml(
             value,
           )}</td>
         </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">MeetFlow</p>
      <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:#111827;">${escapeHtml(layout.heading)}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4b5563;">${escapeHtml(layout.intro)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
      ${
        layout.note
          ? `<p style="margin:20px 0 0;padding:12px 14px;background:#f9fafb;border-left:3px solid #e5e7eb;font-size:14px;color:#4b5563;">${escapeHtml(
              layout.note,
            )}</p>`
          : ""
      }
      ${
        layout.cta
          ? `<p style="margin:24px 0 4px;"><a href="${escapeHtml(layout.cta.href)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:8px;">${escapeHtml(
              layout.cta.label,
            )}</a></p>`
          : ""
      }
      ${
        layout.cta2
          ? `<p style="margin:12px 0 4px;"><a href="${escapeHtml(layout.cta2.href)}" style="display:inline-block;color:#111827;font-size:14px;font-weight:500;text-decoration:underline;">${escapeHtml(
              layout.cta2.label,
            )}</a></p>`
          : ""
      }
    </td></tr>
    <tr><td style="padding:16px 28px 24px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">${escapeHtml(layout.footer)}</p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    layout.heading,
    "",
    layout.intro,
    "",
    ...layout.rows.map(([label, value]) => `${label}: ${value}`),
    ...(layout.note ? ["", layout.note] : []),
    ...(layout.cta ? ["", `${layout.cta.label}: ${layout.cta.href}`] : []),
    ...(layout.cta2 ? ["", `${layout.cta2.label}: ${layout.cta2.href}`] : []),
    "",
    layout.footer,
  ].join("\n");

  return { html, text };
}

function baseRows(ctx: BookingEmailContext, timeZone: string): Array<[string, string]> {
  return [
    ["Event", ctx.eventName],
    ["When", formatWhen(ctx.startAt, ctx.endAt, timeZone)],
    ["Duration", `${ctx.durationMinutes} minutes`],
  ];
}

/** Sent to the guest when their booking is created. */
export function guestConfirmation(ctx: BookingEmailContext, guestTimeZone: string): EmailMessage {
  const { html, text } = render({
    heading: "Your booking is confirmed",
    intro: `You are booked with ${ctx.hostName}.`,
    rows: [...baseRows(ctx, guestTimeZone), ["Host", ctx.hostName]],
    note: ctx.notes ? `Your note: ${ctx.notes}` : null,
    cta: ctx.cancelUrl
      ? { label: "Cancel this booking", href: ctx.cancelUrl }
      : { label: `Book again with ${ctx.hostName}`, href: `${ctx.appUrl}/${ctx.hostSlug}` },
    cta2: ctx.rescheduleUrl
      ? { label: "Reschedule this booking", href: ctx.rescheduleUrl }
      : undefined,
    footer: ctx.cancelUrl
      ? "Cancelling is instant and frees the slot for someone else."
      : "Need to change it? Reply to this email and let your host know.",
  });

  return {
    to: ctx.guestEmail,
    subject: `Confirmed: ${ctx.eventName} with ${ctx.hostName}`,
    html,
    text,
    // The host is the person who can actually act on a reply.
    replyTo: ctx.hostEmail,
  };
}

/** Sent to the host when someone books them. */
export function hostNotification(ctx: BookingEmailContext, hostTimeZone: string): EmailMessage {
  const { html, text } = render({
    heading: "New booking",
    intro: `${ctx.guestName} booked ${ctx.eventName}.`,
    rows: [...baseRows(ctx, hostTimeZone), ["Guest", ctx.guestName], ["Email", ctx.guestEmail]],
    note: ctx.notes ? `Guest note: ${ctx.notes}` : null,
    cta: { label: "Open dashboard", href: `${ctx.appUrl}/dashboard/bookings` },
    footer: "You are receiving this because someone booked your MeetFlow page.",
  });

  return {
    to: ctx.hostEmail,
    subject: `New booking: ${ctx.guestName} — ${ctx.eventName}`,
    html,
    text,
    replyTo: ctx.guestEmail,
  };
}

/** Sent to the guest when the host cancels. */
export function guestCancellation(ctx: BookingEmailContext, guestTimeZone: string): EmailMessage {
  const { html, text } = render({
    heading: "Your booking was cancelled",
    intro: `${ctx.hostName} cancelled this meeting.`,
    rows: baseRows(ctx, guestTimeZone),
    cta: { label: "Pick another time", href: `${ctx.appUrl}/${ctx.hostSlug}` },
    footer: "No action is needed — the slot has been released.",
  });

  return {
    to: ctx.guestEmail,
    subject: `Cancelled: ${ctx.eventName} with ${ctx.hostName}`,
    html,
    text,
    replyTo: ctx.hostEmail,
  };
}

/** Sent to the guest roughly 24 hours before the meeting. */
export function guestReminder(ctx: BookingEmailContext, guestTimeZone: string): EmailMessage {
  const { html, text } = render({
    heading: "Reminder: your meeting is tomorrow",
    intro: `A reminder about your booking with ${ctx.hostName}.`,
    rows: [...baseRows(ctx, guestTimeZone), ["Host", ctx.hostName]],
    ...(ctx.cancelUrl ? { cta: { label: "Cancel this booking", href: ctx.cancelUrl } } : {}),
    footer: "See you then.",
  });

  return {
    to: ctx.guestEmail,
    subject: `Tomorrow: ${ctx.eventName} with ${ctx.hostName}`,
    html,
    text,
    replyTo: ctx.hostEmail,
  };
}

/** Sent to the host when the guest cancels through their signed link. */
export function hostCancellation(ctx: BookingEmailContext, hostTimeZone: string): EmailMessage {
  const { html, text } = render({
    heading: "Booking cancelled",
    intro: `${ctx.guestName} cancelled this meeting. The slot is free again.`,
    rows: [...baseRows(ctx, hostTimeZone), ["Guest", ctx.guestName], ["Email", ctx.guestEmail]],
    cta: { label: "Open dashboard", href: `${ctx.appUrl}/dashboard/bookings` },
    footer: "You are receiving this because it was a booking on your MeetFlow page.",
  });

  return {
    to: ctx.hostEmail,
    subject: `Cancelled: ${ctx.guestName} — ${ctx.eventName}`,
    html,
    text,
    replyTo: ctx.guestEmail,
  };
}
