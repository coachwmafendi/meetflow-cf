import { Hono } from "hono";
import { clearSession, issueSession } from "../middleware/auth";
import { LIMITS, rateLimit } from "../middleware/rateLimit";
import { AuthError, login, register } from "../services/auth";
import type { AppEnv } from "../types";

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/register", rateLimit(LIMITS.register), async (c) => {
  const body = await c.req
    .json<Record<string, string>>()
    .catch(() => ({}) as Record<string, string>);
  try {
    const user = await register(c.env.DB, {
      name: body.name ?? "",
      email: body.email ?? "",
      password: body.password ?? "",
      slug: body.slug ?? "",
      timezone: body.timezone ?? "UTC",
    });
    await issueSession(c, user.id);
    return c.json({ user }, 201);
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

authRoutes.post("/login", rateLimit(LIMITS.login), async (c) => {
  const body = await c.req
    .json<Record<string, string>>()
    .catch(() => ({}) as Record<string, string>);
  const user = await login(c.env.DB, body.email ?? "", body.password ?? "");
  if (!user) return c.json({ error: "Invalid email or password" }, 401);
  await issueSession(c, user.id);
  return c.json({ user });
});

authRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});
