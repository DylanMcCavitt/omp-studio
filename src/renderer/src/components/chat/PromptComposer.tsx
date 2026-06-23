// Reusable prompt input shared by the active-chat composer and the new-session
// StartPanel. Owns the textarea (auto-grow, optional Enter-to-submit) plus image
// attachment input via three routes — clipboard paste, drag/drop (with a drop
// overlay), and an attach button — building `ImageContent[]` for the caller.
//
// The caller supplies `onSubmit(text, images)` and renders its own action
// button(s) via `renderActions`, so this component stays layout-agnostic and easy
// to extend (e.g. the slash-command palette will hang off the same textarea).
// Attachments + text are cleared ONLY after `onSubmit` resolves truthy; a falsy
// result leaves them in place so a failed send can be retried.

import type { ImageContent } from "@shared/rpc";
import { ImagePlus } from "lucide-react";
import type { ClipboardEvent, DragEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { type ImageAttachment, MAX_IMAGES, readImageFiles } from "@/lib/images";
import { ImageAttachmentStrip } from "./ImageAttachmentStrip";

export interface PromptComposerActionContext {
  /** Trigger a submit (clears on success, restores on failure). */
  submit: () => void;
  /** Enabled, idle, and has text or at least one image. */
  canSubmit: boolean;
  /** True while an `onSubmit` call is in flight. */
  busy: boolean;
  /** True when there is any text or image content (ignores disabled/busy). */
  hasContent: boolean;
}

/**
 * Controls handed to an overlay rendered above the input (the slash-command
 * palette). The overlay opens on `/` typed at an empty composer or
 * Cmd/Ctrl+Shift+P; it reads/replaces the composer text without touching the
 * image-attachment state.
 */
export interface PromptComposerOverlayContext {
  /** Whether the overlay has been requested open. */
  open: boolean;
  /** Close the overlay and refocus the textarea. */
  close: () => void;
  /** Replace the composer text, refocus, and move the cursor to the end. */
  setText: (text: string) => void;
  /** Current composer text. */
  text: string;
}

export interface PromptComposerProps {
  /** Send the prompt. Resolve `true` to clear the composer, `false` to keep it. */
  onSubmit: (
    text: string,
    images: ImageContent[],
  ) => boolean | Promise<boolean>;
  /** Render the action button(s); receives submit + derived state. */
  renderActions: (ctx: PromptComposerActionContext) => ReactNode;
  /**
   * Optional overlay rendered above the input — the slash-command palette. When
   * provided, the composer opens it on `/` at an empty composer or
   * Cmd/Ctrl+Shift+P and hands it controls via `PromptComposerOverlayContext`.
   */
  renderOverlay?: (ctx: PromptComposerOverlayContext) => ReactNode;
  disabled?: boolean;
  placeholder?: string;
  /** Submit on Enter (Shift+Enter always newlines). Default true. */
  submitOnEnter?: boolean;
  /** Textarea baseline row count (drives the min height). Default 1. */
  rows?: number;
  /** Auto-grow ceiling in px. Default 200. */
  maxHeight?: number;
  /** Where the actions render relative to the input. Default "inline". */
  actionsPlacement?: "inline" | "below";
  className?: string;
}

export function PromptComposer({
  onSubmit,
  renderActions,
  renderOverlay,
  disabled = false,
  placeholder,
  submitOnEnter = true,
  rows = 1,
  maxHeight = 200,
  actionsPlacement = "inline",
  className,
}: PromptComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const hasOverlay = renderOverlay !== undefined;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const hasContent = text.trim() !== "" || attachments.length > 0;
  const canSubmit = hasContent && !disabled && !busy;

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  };

  // Replace the composer text (slash-command insertion), then refocus and put
  // the cursor at the end so arguments are immediately typeable. rAF waits for
  // the controlled value to commit before reading/setting the caret + height.
  const applyText = (value: string) => {
    setText(value);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
      resize();
    });
  };

  const closeOverlay = () => {
    setOverlayOpen(false);
    textareaRef.current?.focus();
  };

  // Cmd/Ctrl+Shift+P toggles the overlay (slash palette) when one is wired.
  useEffect(() => {
    if (!hasOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "p" || e.key === "P")
      ) {
        e.preventDefault();
        setOverlayOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasOverlay]);

  const addFiles = async (files: File[]) => {
    if (disabled || files.length === 0) return;
    const result = await readImageFiles(files, attachments.length);
    if (result.accepted.length > 0) {
      setAttachments((prev) =>
        [...prev, ...result.accepted].slice(0, MAX_IMAGES),
      );
    }
    setErrors(result.errors);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    setErrors([]);
  };

  const submit = async () => {
    if (busy || disabled) return;
    const value = text;
    const images = attachments.map((a) => a.content);
    if (value.trim() === "" && images.length === 0) return;
    setBusy(true);
    try {
      const ok = await onSubmit(value, images);
      if (ok) {
        setText("");
        setAttachments([]);
        setErrors([]);
        const el = textareaRef.current;
        if (el) el.style.height = "auto";
      }
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      // Don't also paste the binary/text representation into the textarea.
      e.preventDefault();
      void addFiles(files);
    }
  };

  const hasDraggedFiles = (e: DragEvent) =>
    e.dataTransfer?.types?.includes("Files") ?? false;

  const onDragEnter = (e: DragEvent) => {
    if (disabled || !hasDraggedFiles(e)) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragOver = (e: DragEvent) => {
    if (disabled || !hasDraggedFiles(e)) return;
    // preventDefault marks this as a valid drop target.
    e.preventDefault();
  };

  const onDragLeave = (e: DragEvent) => {
    if (disabled || !hasDraggedFiles(e)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) void addFiles(Array.from(files));
  };

  const actions = renderActions({ submit, canSubmit, busy, hasContent });
  const inline = actionsPlacement === "inline";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop-zone wrapper; textarea paste + attach button are the keyboard paths
    <div
      className={cn("relative", className)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {renderOverlay?.({
        open: overlayOpen,
        close: closeOverlay,
        setText: applyText,
        text,
      })}

      <ImageAttachmentStrip
        attachments={attachments}
        errors={errors}
        onRemove={removeAttachment}
      />

      <div className={inline ? "flex items-end gap-2" : undefined}>
        <div className="flex flex-1 items-end gap-2">
          <IconButton
            label="Attach images"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || busy}
            className="mb-0.5 shrink-0"
          >
            <ImagePlus className="h-4 w-4" />
          </IconButton>
          <textarea
            ref={textareaRef}
            value={text}
            rows={rows}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              resize();
            }}
            onPaste={onPaste}
            onKeyDown={(e) => {
              // `/` at an empty composer opens the overlay (slash palette)
              // instead of typing a literal slash.
              if (hasOverlay && e.key === "/" && text === "") {
                e.preventDefault();
                setOverlayOpen(true);
                return;
              }
              if (submitOnEnter && e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            style={{ minHeight: `${rows * 1.5 + 1}rem`, maxHeight }}
            className="scrollbar flex-1 resize-none rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </div>
        {inline && <div className="flex items-end gap-2">{actions}</div>}
      </div>

      {!inline && <div className="mt-2">{actions}</div>}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) void addFiles(Array.from(files));
          // Reset so picking the same file again still fires onChange.
          e.target.value = "";
        }}
      />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-accent bg-bg/85 text-sm font-medium text-accent">
          <ImagePlus className="h-5 w-5" />
          Drop images to attach
        </div>
      )}
    </div>
  );
}
