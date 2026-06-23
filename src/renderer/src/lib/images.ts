// Renderer-side image attachment helpers for the prompt composer. Reads picked /
// pasted / dropped files into the wire `ImageContent` shape (base64 with the
// `data:*;base64,` prefix stripped) and enforces conservative client-side limits
// so the composer never ships oversized or non-image payloads to the bridge.
// Main should re-validate too; these limits are the first, cheap line of defense.

import type { ImageContent } from "@shared/rpc";
import { formatBytes } from "./format";

/** Hard cap on attachments per prompt. */
export const MAX_IMAGES = 10;
/** Hard cap on the decoded size of any single attachment. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** A composer-local attachment: the wire payload plus UI metadata + a stable id. */
export interface ImageAttachment {
  /** Stable client id for React keys + targeted removal. */
  id: string;
  /** The `ImageContent` that ships in `PromptOptions.images`. */
  content: ImageContent;
  /** Original file name (for tooltips / alt text), falls back to a generic label. */
  name: string;
  /** Original byte size, for the validation messages and the strip label. */
  size: number;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `img-${Date.now().toString(36)}-${counter}`;
}

/**
 * Read a `File` into an `ImageContent`. Uses `readAsDataURL` then strips the
 * `data:<mime>;base64,` prefix so only the raw base64 payload is sent on the wire.
 */
export function fileToImageContent(file: File): Promise<ImageContent> {
  const { promise, resolve, reject } = Promise.withResolvers<ImageContent>();
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;
    if (typeof result !== "string") {
      reject(new Error("Could not read image data"));
      return;
    }
    // result === "data:<mimeType>;base64,<payload>" — keep only the payload.
    const comma = result.indexOf(",");
    const data = comma >= 0 ? result.slice(comma + 1) : result;
    resolve({
      type: "image",
      data,
      mimeType: file.type || "image/png",
    });
  };
  reader.onerror = () =>
    reject(reader.error ?? new Error("Could not read image data"));
  reader.readAsDataURL(file);
  return promise;
}

export interface ReadImagesResult {
  accepted: ImageAttachment[];
  errors: string[];
}

/**
 * Validate + read a batch of picked/pasted/dropped files, given how many
 * attachments are already present. Non-images, oversized files, and overflow
 * past `MAX_IMAGES` are reported as human-readable errors instead of throwing.
 */
export async function readImageFiles(
  files: readonly File[],
  existingCount: number,
): Promise<ReadImagesResult> {
  const accepted: ImageAttachment[] = [];
  const errors: string[] = [];
  let count = existingCount;

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      errors.push(`${file.name || "File"} is not an image`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(
        `${file.name || "Image"} is ${formatBytes(file.size)} (max ${formatBytes(MAX_IMAGE_BYTES)})`,
      );
      continue;
    }
    if (count >= MAX_IMAGES) {
      errors.push(`Up to ${MAX_IMAGES} images per message`);
      break;
    }
    try {
      const content = await fileToImageContent(file);
      accepted.push({
        id: nextId(),
        content,
        name: file.name || "image",
        size: file.size,
      });
      count += 1;
    } catch {
      errors.push(`Could not read ${file.name || "image"}`);
    }
  }

  return { accepted, errors };
}

/**
 * Build a renderable `src` from a transcript `ImageBlock`, which may carry either
 * a base64 `data` payload or a pre-formed `image` value (data URL / http URL).
 * Returns null when neither is present.
 */
export function imageBlockSrc(block: {
  image?: string;
  data?: string;
  mimeType?: string;
}): string | null {
  if (block.data) {
    return `data:${block.mimeType || "image/png"};base64,${block.data}`;
  }
  if (block.image) {
    if (block.image.startsWith("data:") || /^https?:\/\//.test(block.image)) {
      return block.image;
    }
    return `data:${block.mimeType || "image/png"};base64,${block.image}`;
  }
  return null;
}
