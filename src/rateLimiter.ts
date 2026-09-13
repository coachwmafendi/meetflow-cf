import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";

interface CounterWindow {
  /** Start of the fixed window, in epoch ms. */
  start: number;
  count: number;
}

export interface HitResult {
  success: boolean;
  remaining: number;
  /** Epoch ms when the current window rolls over. */
  resetAt: number;
}

const STORAGE_KEY = "window";

/**
 * Fixed-window counter, one instance per rate limit key.
 *
 * A Durable Object handles one request at a time, so the read-modify-write
 * below is atomic without any locking. This replaces the Workers Rate Limiting
 * binding, which is configurable on this account but never actually rejects —
 * verified in production at limit=2/60s with 8 requests from one IP.
 */
export class RateLimiter extends DurableObject<Env> {
  async hit(limit: number, periodSeconds: number, nowMs: number = Date.now()): Promise<HitResult> {
    const periodMs = periodSeconds * 1000;
    const start = Math.floor(nowMs / periodMs) * periodMs;
    const resetAt = start + periodMs;

    const stored = await this.ctx.storage.get<CounterWindow>(STORAGE_KEY);
    const window: CounterWindow = stored && stored.start === start ? stored : { start, count: 0 };

    if (window.count >= limit) {
      return { success: false, remaining: 0, resetAt };
    }

    window.count += 1;
    await this.ctx.storage.put(STORAGE_KEY, window);

    if (window.count === 1) {
      // Evict the instance's storage once the window is safely past, so idle keys
      // do not accumulate rows forever. Scheduled against the wall clock, never
      // against `nowMs` — that argument exists for deterministic tests and may be
      // an arbitrary epoch, which would put the alarm in the past and fire it
      // immediately, silently clearing the counter.
      await this.ctx.storage.setAlarm(Date.now() + periodMs * 2);
    }

    return { success: true, remaining: limit - window.count, resetAt };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
