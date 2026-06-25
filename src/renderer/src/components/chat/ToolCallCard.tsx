// A single tool invocation card (AGE-704 restyle): a 1px-bordered card whose
// header row carries a status dot + icon + mono title + "+N −M" edit counts.
// Edit-family calls render a compact 2-line mono diff (adds in diff-add on a
// faint add bg, removes in diff-remove). While the session is running, an
// in-flight call (no result yet) borders in the workspace color, pulses its
// header dot, and blinks a "running…" label. The header expands to the full
// arguments and the matched result content.

import type { WorkspaceColorKey } from "@shared/ipc";
import type { TextBlock, ToolCallBlock, ToolResultMessage } from "@shared/rpc";
import { ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";
import { WorkspaceColorDot } from "@/components/workspace/WorkspaceColor";
import { cn } from "@/lib/cn";
import { workspaceColor } from "@/lib/workspaces";
import { toContentBlocks } from "@/store/session-reducer";

// Tool names whose arguments/results describe a file edit. Matched
// case-insensitively; any name containing "edit" also counts (e.g. multi_edit).
const EDIT_TOOL_NAMES: Record<string, true> = {
  edit: true,
  ast_edit: true,
  write: true,
  str_replace: true,
};

export interface EditDiff {
  /** Added line count — the header's "+N" counter. */
  added: number;
  /** Removed line count — the header's "−M" counter. */
  removed: number;
  /** Parsed diff lines in source order, for the compact card preview. */
  lines: { kind: "add" | "remove"; text: string }[];
}

function isEditTool(name: string): boolean {
  const n = name.toLowerCase();
  return EDIT_TOOL_NAMES[n] === true || n.includes("edit");
}

// First non-empty string field that plausibly holds a patch/diff/body. Tools
// name it differently (edit -> input, write -> content, ast_edit -> diff), so we
// probe a known set and otherwise fall back to the result text.
function diffSource(args: unknown, fallback: string): string {
  if (typeof args === "string") return args;
  if (args && typeof args === "object") {
    for (const key of [
      "input",
      "_input",
      "patch",
      "diff",
      "content",
      "new_str",
      "text",
    ]) {
      const v = (args as Record<string, unknown>)[key];
      if (typeof v === "string" && v !== "") return v;
    }
  }
  return fallback;
}

/**
 * Derive an edit card's diff summary from a tool call + its result text, or
 * null for non-edit tools / no parseable diff. Pure and framework-free so it
 * unit-tests directly. `write` adds its whole body; other edit tools parse
 * unified-diff style `+`/`-` prefixed lines (ignoring `+++`/`---` file headers).
 */
export function editDiff(
  call: ToolCallBlock,
  resultText = "",
): EditDiff | null {
  if (!isEditTool(call.name)) return null;
  const text = diffSource(call.arguments, resultText);
  if (!text) return null;
  const lines: EditDiff["lines"] = [];
  let added = 0;
  let removed = 0;
  const writeAll = call.name.toLowerCase() === "write";
  const rows = text.split("\n");
  if (writeAll && rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
  for (const raw of rows) {
    if (writeAll) {
      added++;
      lines.push({ kind: "add", text: raw });
    } else if (raw.startsWith("+") && !raw.startsWith("+++")) {
      added++;
      lines.push({ kind: "add", text: raw.slice(1) });
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      removed++;
      lines.push({ kind: "remove", text: raw.slice(1) });
    }
  }
  if (added === 0 && removed === 0) return null;
  return { added, removed, lines };
}

export function ToolCallCard({
  call,
  result,
  sessionRunning = false,
  workspaceColorKey,
}: {
  call: ToolCallBlock;
  result?: ToolResultMessage;
  /** The active session is live and currently streaming a turn. */
  sessionRunning?: boolean;
  /** Workspace hue for the running card's border + pulsing dot. */
  workspaceColorKey?: WorkspaceColorKey;
}) {
  const [open, setOpen] = useState(false);

  const status = !result ? "running" : result.isError ? "error" : "success";
  // The card only animates as "running" while the session itself is streaming;
  // a result-less call in a closed/hibernated transcript reads as neutral.
  const running = status === "running" && sessionRunning;
  const tokens = workspaceColor(workspaceColorKey);

  let fullArgs = "";
  try {
    fullArgs = JSON.stringify(call.arguments, null, 2);
  } catch {
    fullArgs = String(call.arguments);
  }

  const resultText = toContentBlocks(result?.content)
    .map((b) => (b.type === "text" ? String((b as TextBlock).text ?? "") : ""))
    .filter(Boolean)
    .join("\n");

  const diff = editDiff(call, resultText);
  const diffPreview = diff?.lines.slice(0, 2) ?? [];

  // Non-edit cards keep a muted one-line argument preview for context.
  let preview = "";
  if (!diff) {
    try {
      const serialized = JSON.stringify(call.arguments);
      if (serialized && serialized !== "{}") {
        preview =
          serialized.length > 80 ? `${serialized.slice(0, 80)}…` : serialized;
      }
    } catch {
      preview = "";
    }
  }

  return (
    <div
      data-running={running || undefined}
      className={cn(
        "my-1.5 overflow-hidden rounded-lg border bg-bg-panel/60",
        running && tokens ? "border-transparent" : "border-border-subtle",
      )}
      style={running && tokens ? { borderColor: tokens.value } : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover/40"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform",
            open && "rotate-90",
          )}
        />
        {running ? (
          workspaceColorKey ? (
            <WorkspaceColorDot color={workspaceColorKey} status="running" />
          ) : (
            <span
              aria-hidden
              data-status="running"
              className="h-2 w-2 shrink-0 animate-omp-pulse rounded-full bg-warn"
            />
          )
        ) : (
          <span
            aria-hidden
            data-status={status}
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              status === "error" ? "bg-danger" : "bg-success",
            )}
          />
        )}
        <Wrench className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
        <span className="shrink-0 font-mono text-xs font-medium text-ink">
          {call.name}
        </span>
        {diff ? (
          <span className="shrink-0 font-mono text-xs tabular-nums">
            <span className="text-success">+{diff.added}</span>{" "}
            <span className="text-danger">−{diff.removed}</span>
          </span>
        ) : (
          preview && (
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-faint">
              {preview}
            </span>
          )
        )}
        {running && (
          <span className="ml-auto shrink-0 animate-omp-blink font-mono text-[0.7rem] tracking-wide text-ink-muted">
            running…
          </span>
        )}
      </button>
      {diffPreview.length > 0 && (
        <div className="border-t border-border-subtle font-mono text-xs">
          {diffPreview.map((line, i) => (
            <div
              key={i}
              data-diff={line.kind}
              className={cn(
                "truncate px-3 py-0.5",
                line.kind === "add"
                  ? "bg-success/10 text-success"
                  : "bg-danger/10 text-danger",
              )}
            >
              <span aria-hidden className="select-none pr-1.5 opacity-70">
                {line.kind === "add" ? "+" : "−"}
              </span>
              {line.text}
            </div>
          ))}
        </div>
      )}
      {open && (
        <div className="space-y-2 border-t border-border-subtle px-3 py-2">
          <div>
            <div className="mb-1 text-[0.7rem] font-medium uppercase tracking-wide text-ink-faint">
              Arguments
            </div>
            <pre className="scrollbar max-h-56 overflow-auto whitespace-pre-wrap rounded bg-bg-raised p-2 font-mono text-xs text-ink-muted">
              {fullArgs}
            </pre>
          </div>
          {result && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-ink-faint">
                Result
                {result.isError && <span className="text-danger">error</span>}
              </div>
              <pre
                className={cn(
                  "scrollbar max-h-72 overflow-auto whitespace-pre-wrap rounded bg-bg-raised p-2 font-mono text-xs",
                  result.isError ? "text-danger" : "text-ink-muted",
                )}
              >
                {resultText || "(no output)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
