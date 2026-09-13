import { Hono } from "hono";
import { loadUser } from "./middleware/auth";
import { authRoutes } from "./routes/api.auth";
import { availabilityRoutes } from "./routes/api.availability";
import { eventTypeRoutes } from "./routes/api.eventTypes";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", loadUser);

app.get("/healthz", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/event-types", eventTypeRoutes);
app.route("/api/availability", availabilityRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
