import { Hono } from "hono";
import { loadUser } from "./middleware/auth";
import { authRoutes } from "./routes/api.auth";
import { bookingRoutes } from "./routes/api.bookings";
import { availabilityRoutes } from "./routes/api.availability";
import { eventTypeRoutes } from "./routes/api.eventTypes";
import { publicRoutes } from "./routes/api.public";
import { searchRoutes } from "./routes/api.search";
import { pageRoutes } from "./routes/pages";
import { handleEmailBatch, queueDueReminders, type EmailJob } from "./services/email";
import type { AppEnv, Env } from "./types";

const app = new Hono<AppEnv>();

app.use("*", loadUser);

app.get("/healthz", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/event-types", eventTypeRoutes);
app.route("/api/availability", availabilityRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/bookings", bookingRoutes);
app.route("/api/search", searchRoutes);

app.route("/", pageRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export { RateLimiter } from "./rateLimiter";

export default {
  fetch: app.fetch,

  /** Delivers queued transactional email. */
  async queue(batch: MessageBatch<EmailJob>, env: Env): Promise<void> {
    await handleEmailBatch(batch, env);
  },

  /** Hourly: queue 24-hour reminders for meetings that need one. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      queueDueReminders(env).then(
        (count) => count > 0 && console.log(`email: queued ${count} reminder(s)`),
        (err) => console.error("email: reminder sweep failed", err),
      ),
    );
  },
} satisfies ExportedHandler<Env, EmailJob>;
