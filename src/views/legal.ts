import { layout } from "./layout";

/**
 * Static legal pages. Same design tokens as the rest of the product; the
 * theme toggle appears automatically because these pages use the "md" width.
 *
 * Section bodies are trusted author-controlled HTML (links, bold), so they
 * follow the `*Html` convention rather than being escaped.
 */

interface LegalSection {
  heading: string;
  bodyHtml: string;
}

interface LegalOptions {
  title: string;
  heading: string;
  updated: string;
  sections: LegalSection[];
  footerHtml: string;
}

function legalShell(options: LegalOptions): string {
  const sections = options.sections
    .map(
      (s) => `<section class="ui-card ui-card-pad">
        <h2 class="text-sm font-semibold text-ink">${s.heading}</h2>
        <p class="mt-2 text-[0.8125rem] leading-relaxed text-muted">${s.bodyHtml}</p>
      </section>`,
    )
    .join("");

  return layout({
    title: options.title,
    nav: "none",
    width: "md",
    body: `
      <div class="mx-auto max-w-2xl ui-rise">
        <header class="mb-8">
          <a href="/" class="flex items-center gap-2 text-ink" aria-label="MeetFlow home">
            <span class="flex size-6 items-center justify-center rounded-md bg-primary text-on-primary">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="size-3.5">
                <rect x="3" y="5" width="18" height="16" rx="4" stroke="currentColor" stroke-width="2"/>
                <path d="M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <rect x="7" y="12" width="5" height="4" rx="1.2" fill="currentColor"/>
              </svg>
            </span>
            <span class="text-[0.9375rem] font-semibold tracking-[-0.02em]">MeetFlow</span>
          </a>
          <h1 class="mt-6 text-2xl font-semibold tracking-[-0.02em] text-ink">${options.heading}</h1>
          <p class="mt-1.5 text-[0.8125rem] text-muted">Last updated: ${options.updated}</p>
        </header>

        <div class="space-y-4">${sections}</div>

        <footer class="mt-8 text-[0.8125rem] leading-relaxed text-muted">${options.footerHtml}</footer>
      </div>`,
  });
}

const UPDATED = "September 15, 2026";
const CONTACT =
  '<a class="font-medium text-ink underline underline-offset-4" href="mailto:bookings@mailr.my">bookings@mailr.my</a>';

export function privacyPage(): string {
  return legalShell({
    title: "Privacy Policy",
    heading: "Privacy Policy",
    updated: UPDATED,
    sections: [
      {
        heading: "What MeetFlow is",
        bodyHtml:
          "MeetFlow is a scheduling service. It turns a host's availability into a public booking page where guests can pick a time. This policy explains what data we collect, how we use it, and the choices you have.",
      },
      {
        heading: "Data we collect",
        bodyHtml:
          "<b>Account data:</b> when you sign up as a host, you give us your name, email address, password, username and timezone.<br><br>" +
          "<b>Scheduling data:</b> the event types you create, your weekly availability, and meeting locations or video links.<br><br>" +
          "<b>Booking data:</b> when a guest books, we store the guest's name, email address, timezone, the chosen time, and any optional notes they leave.<br><br>" +
          "<b>Google Calendar (optional):</b> if you connect Google Calendar, we store encrypted OAuth tokens and your calendar email to check your availability.<br><br>" +
          "<b>Technical data:</b> your IP address is processed for rate limiting and abuse protection. A session cookie keeps you signed in, and your theme preference is stored locally in your browser.",
      },
      {
        heading: "How we use data",
        bodyHtml:
          "We use this data to run the service: show real availability, accept and validate bookings, prevent double-bookings, and send confirmation and reminder emails. We do not sell personal data, and we do not use it for advertising.",
      },
      {
        heading: "Emails",
        bodyHtml:
          "Guests receive a confirmation and a 24-hour reminder for each booking, plus a confirmation when a booking is cancelled. Hosts receive notifications of new bookings and cancellations. These emails are part of the service; you can disable reminders in your settings.",
      },
      {
        heading: "Storage and security",
        bodyHtml:
          "Data is stored on Cloudflare infrastructure (D1 database and R2 storage) and is encrypted in transit via HTTPS. Passwords are stored as salted hashes — we never keep plaintext passwords. Google Calendar tokens are stored encrypted. Sessions use signed, httpOnly cookies.",
      },
      {
        heading: "Third-party services",
        bodyHtml:
          "MeetFlow runs on Cloudflare (hosting, database, storage, email queue). If you connect Google Calendar, Google receives only the requests needed to check busy times and manage events. Video links (Google Meet, Zoom and similar) are configured by the host and opened directly by the guest at meeting time.",
      },
      {
        heading: "Retention and deletion",
        bodyHtml:
          "We keep account, scheduling and booking data while your account is active. Cancelled bookings are retained so hosts keep an accurate history. You may request access to, correction of, or deletion of your data by contacting " +
          CONTACT +
          ". Deletion requests are completed within 30 days.",
      },
      {
        heading: "Your rights",
        bodyHtml:
          "You may ask us what data we hold about you, correct it, or have it deleted. Guests can cancel a booking through the link in their confirmation email at any time, which frees the slot for someone else.",
      },
      {
        heading: "Changes to this policy",
        bodyHtml:
          "We may update this policy as the service evolves. Material changes will be announced on this page and, where appropriate, by email. Continued use of MeetFlow after a change means you accept the updated policy.",
      },
      {
        heading: "Contact",
        bodyHtml: "Questions about privacy or this policy can be sent to " + CONTACT + ".",
      },
    ],
    footerHtml:
      "MeetFlow is operated by its owner. For questions, contact " +
      CONTACT +
      '. See also our <a class="font-medium text-ink underline underline-offset-4" href="/terms">Terms of Service</a>.',
  });
}

export function termsPage(): string {
  return legalShell({
    title: "Terms of Service",
    heading: "Terms of Service",
    updated: UPDATED,
    sections: [
      {
        heading: "Acceptance of these terms",
        bodyHtml:
          "By creating an account or using MeetFlow, you agree to these terms. If you book a meeting as a guest, you agree to them for the parts that apply to you. If you do not agree, please do not use the service.",
      },
      {
        heading: "What MeetFlow does",
        bodyHtml:
          "MeetFlow provides scheduling tools: hosts publish booking pages, guests book time on them, and both sides receive confirmation emails. MeetFlow is not a party to any meeting booked through it — it only provides the scheduling.",
      },
      {
        heading: "Accounts",
        bodyHtml:
          "Hosts must be at least 18 years old and provide accurate registration details. You are responsible for keeping your password secure and for everything that happens under your account. Usernames are public and appear in your booking page URL.",
      },
      {
        heading: "Acceptable use",
        bodyHtml:
          "You agree not to use MeetFlow to spam, defraud or harass others; to book slots you do not intend to use; to scrape or misuse other users' booking pages; or to interfere with the operation of the service. We may suspend accounts that violate these rules.",
      },
      {
        heading: "Your content",
        bodyHtml:
          "Event names, descriptions, availability and meeting links belong to you. You grant us the rights needed to display them on your public booking page and in booking emails. Do not publish content that is unlawful or infringes others' rights.",
      },
      {
        heading: "Bookings between hosts and guests",
        bodyHtml:
          "MeetFlow validates that a slot is free at the moment of booking, but the meeting itself is between host and guest. We are not responsible for missed meetings, cancellations or disputes between users.",
      },
      {
        heading: "Email delivery",
        bodyHtml:
          "Booking confirmations and reminders are sent by email. Delivery depends on third-party mail systems; MeetFlow is not liable if a message is delayed, filtered or undelivered.",
      },
      {
        heading: "Third-party connections",
        bodyHtml:
          "Connecting Google Calendar is optional and uses your own Google account. MeetFlow only requests the calendar scopes needed to check busy times and manage events. You can disconnect at any time from your settings.",
      },
      {
        heading: "Service availability",
        bodyHtml:
          "MeetFlow is provided on a best-effort basis, as-is and as-available. We aim for reliable uptime but make no guarantees about availability, and we may change, pause or discontinue features at any time.",
      },
      {
        heading: "Limitation of liability",
        bodyHtml:
          "To the maximum extent permitted by law, MeetFlow is not liable for indirect, incidental or consequential damages arising from the use of the service, including lost bookings or missed meetings. Our total liability for any claim is limited to the amounts you paid us, if any, in the twelve months before the claim.",
      },
      {
        heading: "Termination",
        bodyHtml:
          "You may stop using MeetFlow at any time and request deletion of your account. We may suspend or terminate accounts that violate these terms. Event types with booking history are deactivated rather than deleted so guests keep accurate records.",
      },
      {
        heading: "Changes to these terms",
        bodyHtml:
          "We may update these terms as the service evolves. Material changes will be announced on this page and, where appropriate, by email. Continued use after a change means you accept the updated terms.",
      },
      {
        heading: "Contact",
        bodyHtml: "Questions about these terms can be sent to " + CONTACT + ".",
      },
    ],
    footerHtml:
      "MeetFlow is operated by its owner. For questions, contact " +
      CONTACT +
      '. See also our <a class="font-medium text-ink underline underline-offset-4" href="/privacy">Privacy Policy</a>.',
  });
}
