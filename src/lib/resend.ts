/**
 * Minimal Resend client over its REST API.
 *
 * No SDK: the API is one POST, and keeping the dependency list at two runtime
 * packages matters more than the convenience.
 */

const ENDPOINT = "https://api.resend.com/emails";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export type SendOutcome =
  | { status: "sent"; id: string }
  /** Transient — the queue should retry. */
  | { status: "retry"; reason: string }
  /** Permanent (bad address, rejected content). Retrying would loop forever. */
  | { status: "failed"; reason: string }
  /** No API key configured, so email is switched off. Not an error. */
  | { status: "skipped"; reason: string };

export interface ResendConfig {
  apiKey: string | undefined;
  from: string;
}

export async function sendEmail(
  config: ResendConfig,
  message: EmailMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  if (!config.apiKey) {
    return { status: "skipped", reason: "RESEND_API_KEY is not set" };
  }

  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });
  } catch (err) {
    // Network-level failure: worth another attempt.
    return { status: "retry", reason: `network error: ${String(err)}` };
  }

  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", id: body.id ?? "unknown" };
  }

  const detail = await response.text().catch(() => "");
  // 429 is rate limiting and 5xx is Resend being unwell; both pass later.
  if (response.status === 429 || response.status >= 500) {
    return { status: "retry", reason: `HTTP ${response.status}: ${detail.slice(0, 200)}` };
  }
  return { status: "failed", reason: `HTTP ${response.status}: ${detail.slice(0, 200)}` };
}
