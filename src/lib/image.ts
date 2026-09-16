/**
 * Image validation for avatar uploads.
 *
 * The declared Content-Type and the filename both come from the client and are
 * never trusted. The format is decided by sniffing magic bytes, and only raster
 * formats are allowed — SVG is deliberately excluded because it can carry script
 * and would execute if a browser ever rendered it from our origin.
 */

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_EVENT_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export type ImageFormat = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const EXTENSIONS: Record<ImageFormat, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/** Returns the real format of `bytes`, or null if it is not an allowed image. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // WEBP is "RIFF" + 4 size bytes + "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

export function extensionFor(format: ImageFormat): string {
  return EXTENSIONS[format];
}

/**
 * Object key for a host's avatar. Server-generated and random, so a client can
 * never influence the path, and changing avatars busts any downstream cache.
 */
export function avatarKey(userId: number, format: ImageFormat): string {
  return `avatars/${userId}/${crypto.randomUUID()}.${extensionFor(format)}`;
}

/**
 * Object key for an event type cover image. Includes user and event type ids so
 * orphaned objects are easy to identify and cleanup, and the random filename
 * busts caches when the image changes.
 */
export function eventImageKey(userId: number, eventTypeId: number, format: ImageFormat): string {
  return `event-images/${userId}/${eventTypeId}/${crypto.randomUUID()}.${extensionFor(format)}`;
}

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
  }
}

/** Validates an uploaded file and returns its bytes plus the sniffed format. */
export async function validateAvatar(
  file: unknown,
): Promise<{ bytes: Uint8Array; format: ImageFormat }> {
  return validateImageFile(file, MAX_AVATAR_BYTES, "2 MB");
}

/** Validates an uploaded event cover image. */
export async function validateEventImage(
  file: unknown,
): Promise<{ bytes: Uint8Array; format: ImageFormat }> {
  return validateImageFile(file, MAX_EVENT_IMAGE_BYTES, "5 MB");
}

async function validateImageFile(
  file: unknown,
  maxBytes: number,
  maxLabel: string,
): Promise<{ bytes: Uint8Array; format: ImageFormat }> {
  if (!(file instanceof File) || file.size === 0) {
    throw new ImageError("Choose an image file to upload.");
  }
  if (file.size > maxBytes) {
    throw new ImageError(`That image is larger than ${maxLabel}.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Re-check after reading: `size` is client-reported metadata.
  if (bytes.byteLength > maxBytes) {
    throw new ImageError(`That image is larger than ${maxLabel}.`);
  }

  const format = sniffImageFormat(bytes);
  if (!format) {
    throw new ImageError("Only PNG, JPEG, WebP or GIF images are supported.");
  }

  return { bytes, format };
}
