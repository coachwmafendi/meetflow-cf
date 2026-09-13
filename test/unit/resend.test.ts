import { describe, expect, it } from "vitest";
import { sendEmail, type EmailMessage } from "../../src/lib/resend";

const message: EmailMessage = {
  to: "ahmad@example.com",
  subject: "Hello",
  html: "<p>hi</p>",
  text: "hi",
  replyTo: "wan@example.com",
};

const config = { apiKey: "re_test_key", from: "MeetFlow <bookings@example.com>" };

function stub(status: number, body: unknown = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("sendEmail", () => {
  it("posts the expected payload to Resend", async () => {
    const { impl, calls } = stub(200, { id: "msg_123" });
    const outcome = await sendEmail(config, message, impl);

    expect(outcome).toEqual({ status: "sent", id: "msg_123" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_key");

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      from: config.from,
      to: ["ahmad@example.com"],
      subject: "Hello",
      reply_to: "wan@example.com",
    });
  });

  it("omits reply_to when there is none", async () => {
    const { impl, calls } = stub(200, { id: "x" });
    await sendEmail(config, { ...message, replyTo: undefined }, impl);
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty("reply_to");
  });

  it("skips without sending when no API key is configured", async () => {
    const { impl, calls } = stub(200);
    const outcome = await sendEmail({ ...config, apiKey: undefined }, message, impl);
    expect(outcome.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("asks for a retry on rate limiting and server errors", async () => {
    for (const status of [429, 500, 502, 503]) {
      const { impl } = stub(status, { message: "nope" });
      expect((await sendEmail(config, message, impl)).status).toBe("retry");
    }
  });

  it("fails permanently on a client error so it does not loop", async () => {
    const { impl } = stub(422, { message: "Invalid `to` field" });
    const outcome = await sendEmail(config, message, impl);
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.reason).toContain("422");
  });

  it("treats a network failure as retryable", async () => {
    const impl = (async () => {
      throw new Error("connection reset");
    }) as unknown as typeof fetch;
    const outcome = await sendEmail(config, message, impl);
    expect(outcome.status).toBe("retry");
    expect(outcome.status === "retry" && outcome.reason).toContain("connection reset");
  });

  it("still counts as sent when the response body has no id", async () => {
    const { impl } = stub(200, {});
    expect((await sendEmail(config, message, impl)).status).toBe("sent");
  });
});
