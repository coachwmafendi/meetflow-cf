import { SELF, env } from "cloudflare:test";

export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM bookings"),
    env.DB.prepare("DELETE FROM availability_rules"),
    env.DB.prepare("DELETE FROM event_types"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}

export interface TestHost {
  id: number;
  slug: string;
  cookie: string;
}

export async function createHost(slug: string, timezone = "Asia/Kuala_Lumpur"): Promise<TestHost> {
  const res = await SELF.fetch("https://example.com/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: slug,
      email: `${slug}@example.com`,
      password: "hunter2hunter2",
      slug,
      timezone,
    }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const { user } = await res.json<{ user: { id: number } }>();
  const raw = res.headers.get("set-cookie") ?? "";
  return { id: user.id, slug, cookie: raw.split(";")[0]! };
}

export function api(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const { cookie, headers, ...rest } = init;
  return SELF.fetch(`https://example.com${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });
}
