import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { findUserById } from "../db/users";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "../lib/session";
import type { AppEnv } from "../types";
import type { Context } from "hono";

export async function issueSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = await signSession(userId, c.env.SESSION_SECRET);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSession(c: Context<AppEnv>): void {
  setCookie(c, SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

/** Populates c.var.user when a valid cookie is present. Never rejects. */
export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const userId = await verifySession(token, c.env.SESSION_SECRET);
    if (userId) {
      const user = await findUserById(c.env.DB, userId);
      if (user) c.set("user", user);
    }
  }
  await next();
});

/** 401 for API routes when there is no session. Must run after loadUser. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Unauthorized" }, 401);
  await next();
});
