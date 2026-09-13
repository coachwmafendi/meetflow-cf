import { Hono } from "hono";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.get("/healthz", (c) => c.json({ ok: true }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
