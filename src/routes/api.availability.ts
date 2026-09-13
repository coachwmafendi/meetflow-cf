import { Hono } from "hono";
import { listRules, replaceRules, type RuleInput } from "../db/availability";
import { toMinutes } from "../lib/slots";
import { nowIso } from "../lib/time";
import { isHhmm } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const availabilityRoutes = new Hono<AppEnv>();

availabilityRoutes.use("*", requireAuth);

availabilityRoutes.get("/", async (c) => {
  const rules = await listRules(c.env.DB, c.get("user").id);
  return c.json({ rules });
});

availabilityRoutes.put("/", async (c) => {
  const body = await c.req.json<{ rules?: unknown }>().catch(() => ({}) as { rules?: unknown });
  if (!Array.isArray(body.rules)) return c.json({ error: "rules must be an array" }, 400);
  if (body.rules.length > 70) return c.json({ error: "Too many availability rules" }, 400);

  const parsed: RuleInput[] = [];
  for (const raw of body.rules as Array<Record<string, unknown>>) {
    const dayOfWeek = Number(raw.day_of_week);
    const startTime = String(raw.start_time ?? "");
    const endTime = String(raw.end_time ?? "");

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return c.json({ error: "day_of_week must be 0-6" }, 400);
    }
    if (!isHhmm(startTime) || !isHhmm(endTime)) {
      return c.json({ error: "start_time and end_time must be HH:MM" }, 400);
    }
    if (toMinutes(startTime) >= toMinutes(endTime)) {
      return c.json({ error: "end_time must be after start_time" }, 400);
    }
    parsed.push({ dayOfWeek, startTime, endTime });
  }

  await replaceRules(c.env.DB, c.get("user").id, parsed, nowIso());
  const rules = await listRules(c.env.DB, c.get("user").id);
  return c.json({ rules });
});
