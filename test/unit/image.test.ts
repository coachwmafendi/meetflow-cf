import { describe, expect, it } from "vitest";
import {
  MAX_AVATAR_BYTES,
  avatarKey,
  extensionFor,
  sniffImageFormat,
  validateAvatar,
} from "../../src/lib/image";

const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const gif = () => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1]);
const webp = () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

function file(bytes: Uint8Array, name = "a.png", type = "image/png"): File {
  return new File([bytes], name, { type });
}

describe("sniffImageFormat", () => {
  it("recognises the allowed raster formats", () => {
    expect(sniffImageFormat(png())).toBe("image/png");
    expect(sniffImageFormat(jpeg())).toBe("image/jpeg");
    expect(sniffImageFormat(gif())).toBe("image/gif");
    expect(sniffImageFormat(webp())).toBe("image/webp");
  });

  it("rejects SVG, which could carry script", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffImageFormat(svg)).toBeNull();
  });

  it("rejects HTML disguised with an image extension", () => {
    const htmlBytes = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
    expect(sniffImageFormat(htmlBytes)).toBeNull();
  });

  it("rejects RIFF containers that are not WEBP", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffImageFormat(wav)).toBeNull();
  });

  it("rejects truncated input without throwing", () => {
    expect(sniffImageFormat(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array())).toBeNull();
  });
});

describe("validateAvatar", () => {
  it("accepts a real PNG and reports the sniffed format", async () => {
    const result = await validateAvatar(file(png()));
    expect(result.format).toBe("image/png");
    expect(result.bytes.byteLength).toBe(11);
  });

  it("trusts magic bytes over the declared content type", async () => {
    // Client claims PNG, bytes are actually JPEG. The truth wins.
    const result = await validateAvatar(file(jpeg(), "evil.png", "image/png"));
    expect(result.format).toBe("image/jpeg");
  });

  it("rejects a script payload claiming to be an image", async () => {
    const payload = new TextEncoder().encode("<script>alert(document.cookie)</script>");
    await expect(validateAvatar(file(payload, "x.png", "image/png"))).rejects.toThrow(
      "Only PNG, JPEG, WebP or GIF images are supported.",
    );
  });

  it("rejects files over the size cap", async () => {
    const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
    big.set(png().slice(0, 8));
    await expect(validateAvatar(file(big))).rejects.toThrow("larger than 2 MB");
  });

  it("rejects a missing or empty upload", async () => {
    await expect(validateAvatar(undefined)).rejects.toThrow("Choose an image file");
    await expect(validateAvatar("not-a-file")).rejects.toThrow("Choose an image file");
    await expect(validateAvatar(file(new Uint8Array()))).rejects.toThrow("Choose an image file");
  });
});

describe("avatarKey", () => {
  it("is server-generated, namespaced by user, and never repeats", () => {
    const a = avatarKey(7, "image/png");
    const b = avatarKey(7, "image/png");
    expect(a).toMatch(/^avatars\/7\/[0-9a-f-]{36}\.png$/);
    expect(a).not.toBe(b);
  });

  it("uses the sniffed format for the extension", () => {
    expect(avatarKey(1, "image/jpeg").endsWith(".jpg")).toBe(true);
    expect(extensionFor("image/webp")).toBe("webp");
  });
});
