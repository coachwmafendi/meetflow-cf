import { Hono } from "hono";
import { loadUser } from "./middleware/auth";
import { authRoutes } from "./routes/api.auth";
import { bookingRoutes } from "./routes/api.bookings";
import { availabilityRoutes } from "./routes/api.availability";
import { eventTypeRoutes } from "./routes/api.eventTypes";
import { publicRoutes } from "./routes/api.public";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", loadUser);

app.get("/healthz", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/event-types", eventTypeRoutes);
app.route("/api/availability", availabilityRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/bookings", bookingRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
