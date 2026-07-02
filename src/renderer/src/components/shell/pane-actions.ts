// AGE-777 — pane-opening UX glue shared by the pane host (CenterTabs), the
// chat header's split affordance, and the Subagent tree's open-in-pane /
// drag-and-drop sources. Two lanes live here:
//
//   1. `openPaneWithFeedback` — the ONE place the MAX_PANES cap turns into
//      user-visible feedback (a toast). Every affordance that opens a pane
//      routes through it so the limit message stays uniform.
//   2. The subagent drag contract — the custom dataTransfer MIME + payload
//      (de)serializers. AGE-779's richer drop routing (steer/queue/parallel)
//      extends this same payload, so keep it minimal and versionless: a JSON
//      `{ sessionId, subagentId }`.

import { MAX_PANES, usePaneStore } from "@/store/panes";
import { toast } from "@/store/toast";

type OpenPaneEntry =
  | { kind: "chat"; sessionId?: string }
  | { kind: "file"; path: string }
  | { kind: "subagent"; sessionId: string; subagentId: string };

/**
 * Open a pane, surfacing the pane cap as a toast. Returns the paneId, or null
 * when the cap blocked the open (after notifying the user).
 */
export function openPaneWithFeedback(
  entry: OpenPaneEntry,
  opts?: { besideId?: string; direction?: "row" | "column" },
): string | null {
  const id = usePaneStore.getState().openPane(entry, opts);
  if (id === null) {
    toast.error("Pane limit reached", {
      detail: `Up to ${MAX_PANES} panes can be open — close one first.`,
    });
  }
  return id;
}

/** dataTransfer MIME for a subagent dragged out of the Subagent tree. */
export const SUBAGENT_DRAG_MIME = "application/x-omp-subagent";

export interface SubagentDragPayload {
  sessionId: string;
  subagentId: string;
}

/** Arm a drag with the subagent payload (called from the source's onDragStart). */
export function setSubagentDragData(
  dt: DataTransfer,
  payload: SubagentDragPayload,
): void {
  dt.setData(SUBAGENT_DRAG_MIME, JSON.stringify(payload));
  dt.effectAllowed = "copy";
}

// NOTE: drop targets check `dt.types.includes(SUBAGENT_DRAG_MIME)` inline —
// during dragover the payload itself is unreadable (protected mode); only the
// type list is.

/** Read the payload on drop; null when absent or malformed. */
export function readSubagentDragData(
  dt: DataTransfer | null,
): SubagentDragPayload | null {
  const raw = dt?.getData(SUBAGENT_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as SubagentDragPayload).sessionId === "string" &&
      typeof (parsed as SubagentDragPayload).subagentId === "string"
    ) {
      return parsed as SubagentDragPayload;
    }
  } catch {
    // Malformed foreign payload — ignore the drop.
  }
  return null;
}
