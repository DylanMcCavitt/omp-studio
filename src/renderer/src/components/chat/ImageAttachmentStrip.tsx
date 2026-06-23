// Horizontal strip of pending image attachments shown above the composer input.
// Each thumbnail has an aria-labeled remove button; validation errors (oversized
// files, non-images, too many) render inline beneath the thumbnails.

import { X } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { type ImageAttachment, imageBlockSrc } from "@/lib/images";

interface Props {
  attachments: ImageAttachment[];
  errors: string[];
  onRemove: (id: string) => void;
}

export function ImageAttachmentStrip({ attachments, errors, onRemove }: Props) {
  if (attachments.length === 0 && errors.length === 0) return null;

  return (
    <div className="mb-2 space-y-1.5">
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((a) => {
            const src = imageBlockSrc(a.content);
            return (
              <li key={a.id} className="relative">
                <img
                  src={src ?? ""}
                  alt={a.name}
                  title={`${a.name} · ${formatBytes(a.size)}`}
                  className="h-16 w-16 rounded-md border border-border-subtle object-cover"
                />
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => onRemove(a.id)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-bg-raised text-ink-muted shadow-sm transition-colors hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-0.5">
          {errors.map((message, i) => (
            <li key={i} className="text-xs text-danger">
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
