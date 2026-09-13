import { describe, expect, it } from "vitest";
import {
  isEmail,
  isEventSlug,
  isHhmm,
  isSlug,
  isYmd,
  RESERVED_SLUGS,
} from "../../src/lib/validate";

describe("validate", () => {
  it("accepts sane slugs", () => {
    expect(isSlug("wan")).toBe(true);
    expect(isSlug("wan-mafendi")).toBe(true);
  });

  it("rejects bad slugs", () => {
    expect(isSlug("Wan")).toBe(false);
    expect(isSlug("a")).toBe(false);
    expect(isSlug("wan_mafendi")).toBe(false);
    expect(isSlug("-wan")).toBe(false);
  });

  it("allows short event slugs but keeps usernames at 3+ chars", () => {
    expect(isEventSlug("c")).toBe(true);
    expect(isEventSlug("30")).toBe(true);
    expect(isEventSlug("1-1")).toBe(true);
    expect(isSlug("c")).toBe(false);
    expect(isEventSlug("-c")).toBe(false);
    expect(isEventSlug("C")).toBe(false);
  });

  it("blocks reserved slugs", () => {
    expect(RESERVED_SLUGS.has("api")).toBe(true);
    expect(RESERVED_SLUGS.has("dashboard")).toBe(true);
  });

  it("checks emails, times and dates", () => {
    expect(isEmail("wan@example.com")).toBe(true);
    expect(isEmail("wan@")).toBe(false);
    expect(isHhmm("09:00")).toBe(true);
    expect(isHhmm("24:00")).toBe(false);
    expect(isYmd("2026-09-21")).toBe(true);
    expect(isYmd("2026-9-21")).toBe(false);
  });
});
