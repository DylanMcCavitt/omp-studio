// Hand-rolled HTML5 drag-and-drop reorder for the sidebar nav and chat rail
// (feature 5 — no dnd library). Returns prop bundles for the drag handle (the
// source) and each row (the drop zone), plus the current drag/drop-over indices
// so the caller can style the dragged row and the insertion target. The pure
// index→index move lives in `lib/layout.ts` (`reorder`); this hook only tracks
// the transient pointer state.

import { type DragEvent, useState } from "react";

export interface DragHandleProps {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}

export interface DropZoneProps {
  onDragEnter: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

export interface DragReorder {
  /** Index currently being dragged, or null. */
  dragIndex: number | null;
  /** Index the pointer is hovering over as a drop target, or null. */
  overIndex: number | null;
  /** Spread onto the drag handle of the item at `index`. */
  handleProps: (index: number) => DragHandleProps;
  /** Spread onto the drop zone wrapper of the item at `index`. */
  zoneProps: (index: number) => DropZoneProps;
}

export function useDragReorder(
  onReorder: (from: number, to: number) => void,
): DragReorder {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const clear = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return {
    dragIndex,
    overIndex,
    handleProps: (index) => ({
      draggable: true,
      onDragStart: (e) => {
        setDragIndex(index);
        e.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag unless some data is set.
        e.dataTransfer.setData("text/plain", String(index));
      },
      onDragEnd: clear,
    }),
    zoneProps: (index) => ({
      onDragEnter: () => {
        if (dragIndex !== null && dragIndex !== index) setOverIndex(index);
      },
      onDragOver: (e) => {
        if (dragIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      },
      onDrop: (e) => {
        e.preventDefault();
        if (dragIndex !== null && dragIndex !== index) {
          onReorder(dragIndex, index);
        }
        clear();
      },
    }),
  };
}
