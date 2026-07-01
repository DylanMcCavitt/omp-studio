// Reusable prompt input for the active-chat composer. Owns the textarea
// (auto-grow, optional Enter-to-submit) plus image
// attachment input via three routes — clipboard paste, drag/drop (with a drop
// overlay), and an attach button — building `ImageContent[]` for the caller.
//
// The caller supplies `onSubmit(text, images)` and renders its own action
// button(s) via `renderActions`, so this component stays layout-agnostic and easy
// to extend (e.g. the slash-command palette will hang off the same textarea).
// Attachments + text are cleared ONLY after `onSubmit` resolves truthy; a falsy
// result leaves them in place so a failed send can be retried.

import type { ImageContent } from "@shared/rpc";
import { Bot, ImagePlus, Paperclip } from "lucide-react";
import type { ClipboardEvent, DragEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import {
  AGENT_DRAG_MIME,
  agentSteeringText,
  parseAgentDrag,
} from "@/lib/agentDrag";
import { cn } from "@/lib/cn";
import { type ImageAttachment, MAX_IMAGES, readImageFiles } from "@/lib/images";
import { useUiStore } from "@/store/ui";
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

type DragKind = "agent" | "images";

export interface PromptComposerProps {
  /** Send the prompt. Resolve `true` to clear the composer, `false` to keep it. */
  onSubmit: (
    text: string,
    images: ImageContent[],
  ) => boolean | Promise<boolean>;
  /** Render the action button(s) on the right of the controls row. */
  renderActions: (ctx: PromptComposerActionContext) => ReactNode;
  /**
   * Optional controls rendered in the bottom controls row between the attach
   * button and the trailing actions (the chat composer's model chip). Receives
   * the disabled/busy state so it can mirror the composer's enablement.
   */
  renderControls?: (ctx: { disabled: boolean; busy: boolean }) => ReactNode;
  /**
   * Optional overlay rendered above the input — the slash-command palette. When
   * provided, the composer opens it on `/` at an empty composer or
   * Cmd/Ctrl+Shift+P and hands it controls via `PromptComposerOverlayContext`.
   */
  renderOverlay?: (ctx: PromptComposerOverlayContext) => ReactNode;
  disabled?: boolean;
  placeholder?: string;
  /** Accessible name for the textarea (placeholder is not a reliable label). Default "Message". */
  ariaLabel?: string;
  /** Submit on Enter (Shift+Enter always newlines). Default true. */
  submitOnEnter?: boolean;
  /** Textarea baseline row count (drives the min height). Default 1. */
  rows?: number;
  /** Auto-grow ceiling in px. Default 200. */
  maxHeight?: number;
  /**
   * One-shot text to inject into the composer (slash-command prefill from the
   * Skills & Commands "Use in chat" action). When it transitions to a non-null
   * value the composer adopts it via `applyText` (replace + focus + caret at
   * end), then signals `onInjectConsumed` so the caller can clear it.
   */
  injectText?: string | null;
  /** Called right after a non-null `injectText` is adopted, to clear it. */
  onInjectConsumed?: () => void;
  /**
   * Whether this composer answers GLOBAL chords (Cmd/Ctrl+Shift+P slash
   * palette). With multiple panes mounted only the ACTIVE pane's composer
   * may react — background panes pass false (AGE-801). Focus-driven keys
   * (leading "/") are unaffected. Default true.
   */
  globalShortcuts?: boolean;
  className?: string;
}

export function PromptComposer({
  onSubmit,
  renderActions,
  renderControls,
  renderOverlay,
  disabled = false,
  placeholder,
  ariaLabel = "Message",
  submitOnEnter = true,
  rows = 1,
  maxHeight = 200,
  injectText,
  onInjectConsumed,
  globalShortcuts = true,
  className,
}: PromptComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<DragKind | null>(null);
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

  // Adopt a one-shot prefill (Skills "Use in chat"): when injectText becomes
  // non-null, replace the composer text and tell the caller to clear it so the
  // same command can be re-injected later (null → value transition re-fires).
  useEffect(() => {
    if (injectText == null) return;
    applyText(injectText);
    onInjectConsumed?.();
  }, [injectText]);

  const closeOverlay = () => {
    setOverlayOpen(false);
    textareaRef.current?.focus();
  };

  // The global shortcut manager (lib/useShortcuts) bumps this counter on
  // Cmd/Ctrl+Shift+P; toggle the overlay when it changes. Only the composer
  // wired with an overlay AND opted into global chords (the focused/active
  // pane's composer) reacts, so the chord is a no-op for any other composer.
  // No window listener lives here — manager is the single source of truth.
  const slashToggle = useUiStore((s) => s.slashPaletteToggle);
  const slashToggleSeen = useRef(slashToggle);
  useEffect(() => {
    if (!hasOverlay || !globalShortcuts) {
      // Keep the cursor current while ineligible so gaining eligibility later
      // never replays a stale toggle.
      slashToggleSeen.current = slashToggle;
      return;
    }
    if (slashToggle === slashToggleSeen.current) return;
    slashToggleSeen.current = slashToggle;
    setOverlayOpen((o) => !o);
  }, [slashToggle, hasOverlay, globalShortcuts]);

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
      if (!item) continue;
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

  const dragKind = (e: DragEvent): DragKind | null => {
    const types = e.dataTransfer?.types;
    if (!types) return null;
    if (types.includes(AGENT_DRAG_MIME)) return "agent";
    if (types.includes("Files")) return "images";
    return null;
  };

  const onDragEnter = (e: DragEvent) => {
    const kind = dragKind(e);
    if (disabled || !kind) return;
    dragDepth.current += 1;
    setDragging(kind);
  };

  const onDragOver = (e: DragEvent) => {
    const kind = dragKind(e);
    if (disabled || !kind) return;
    // preventDefault marks this as a valid drop target.
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (e: DragEvent) => {
    if (disabled || !dragKind(e)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(null);
    }
  };

  const onDrop = (e: DragEvent) => {
    if (disabled) return;
    const kind = dragKind(e);
    if (!kind) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(null);
    if (kind === "agent") {
      const payload = parseAgentDrag(e.dataTransfer.getData(AGENT_DRAG_MIME));
      if (payload) {
        applyText(agentSteeringText(payload));
        setErrors([]);
      }
      return;
    }
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) void addFiles(Array.from(files));
  };

  const actions = renderActions({ submit, canSubmit, busy, hasContent });

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

      {/* Rounded composer box: textarea above a controls row (attach · controls · spacer · actions). */}
      <div
        className={cn(
          "rounded-xl border border-border bg-bg-raised px-3 pb-2 pt-2.5 transition-colors focus-within:border-accent",
          disabled && "opacity-60",
        )}
      >
        <ImageAttachmentStrip
          attachments={attachments}
          errors={errors}
          onRemove={removeAttachment}
        />

        <textarea
          ref={textareaRef}
          aria-label={ariaLabel}
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
          className="scrollbar w-full resize-none bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none disabled:cursor-not-allowed"
        />

        <div className="mt-1.5 flex items-center gap-1.5">
          <IconButton
            label="Attach images"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || busy}
            className="shrink-0"
          >
            <Paperclip className="h-4 w-4" />
          </IconButton>
          {renderControls?.({ disabled, busy })}
          <div className="flex-1" />
          {actions}
        </div>
      </div>

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
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-accent bg-bg/85 text-sm font-medium text-accent">
          {dragging === "agent" ? (
            <>
              <Bot className="h-5 w-5" />
              Drop agent to add steering text
            </>
          ) : (
            <>
              <ImagePlus className="h-5 w-5" />
              Drop images to attach
            </>
          )}
        </div>
      )}
    </div>
  );
}
