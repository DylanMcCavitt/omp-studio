import type {
  KeybindingActionId,
  KeybindingChord,
  KeybindingSettings,
} from "@shared/ipc";

export interface ShortcutAction {
  id: KeybindingActionId;
  label: string;
  description: string;
  defaultChords: KeybindingChord[];
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "newChat",
    label: "New chat",
    description: "Start a new chat session.",
    defaultChords: [
      { key: "t", mod: true },
      { key: "n", mod: true },
    ],
  },
  {
    id: "closeSession",
    label: "Close active session",
    description: "Close the active chat session.",
    defaultChords: [{ key: "w", mod: true }],
  },
  {
    id: "toggleSidebar",
    label: "Toggle sidebar",
    description: "Collapse or expand the left sidebar.",
    defaultChords: [{ key: "b", mod: true }],
  },
  {
    id: "toggleNavPalette",
    label: "Command palette",
    description: "Open or close the navigation palette.",
    defaultChords: [{ key: "k", mod: true }],
  },
  {
    id: "toggleSearch",
    label: "Global search",
    description: "Open or close full-text search.",
    defaultChords: [{ key: "f", mod: true, shift: true }],
  },
  {
    id: "toggleSlashPalette",
    label: "Slash command palette",
    description: "Toggle slash commands in the active composer.",
    defaultChords: [{ key: "p", mod: true, shift: true }],
  },
  {
    id: "closeOverlay",
    label: "Close overlay",
    description: "Close the topmost soft overlay.",
    defaultChords: [{ key: "Escape" }],
  },
  ...Array.from({ length: 9 }, (_, index) => {
    const slot = index + 1;
    return {
      id: `openSession${slot}` as KeybindingActionId,
      label: `Open session ${slot}`,
      description: `Switch to open session ${slot}.`,
      defaultChords: [{ key: String(slot), mod: true }],
    };
  }),
];

const ACTION_BY_ID = new Map(
  SHORTCUT_ACTIONS.map((action) => [action.id, action]),
);

export function chordKey(chord: KeybindingChord): string {
  return [chord.mod ? "mod" : "", chord.shift ? "shift" : "", chord.key]
    .filter(Boolean)
    .join("+")
    .toLowerCase();
}

export function chordsEqual(
  left: KeybindingChord,
  right: KeybindingChord,
): boolean {
  return chordKey(left) === chordKey(right);
}

export function displayChord(chord: KeybindingChord): string {
  const parts: string[] = [];
  if (chord.mod) parts.push("Cmd/Ctrl");
  if (chord.shift) parts.push("Shift");
  parts.push(chord.key === "Escape" ? "Esc" : chord.key.toUpperCase());
  return parts.join("+");
}

export function displayActionBinding(
  action: ShortcutAction,
  custom: KeybindingSettings | undefined,
): string {
  const chord = custom?.[action.id];
  if (chord) return displayChord(chord);
  return action.defaultChords.map(displayChord).join(" / ");
}

export function effectiveChords(
  action: ShortcutAction,
  custom: KeybindingSettings | undefined,
): KeybindingChord[] {
  const chord = custom?.[action.id];
  return chord ? [chord] : action.defaultChords;
}

export function resolveShortcutAction(
  event: KeyboardEvent,
  custom: KeybindingSettings | undefined,
): KeybindingActionId | undefined {
  const chord = chordFromKeyboardEvent(event);
  if (!chord) return undefined;
  for (const action of SHORTCUT_ACTIONS) {
    if (
      effectiveChords(action, custom).some((item) => chordsEqual(item, chord))
    ) {
      return action.id;
    }
  }
  return undefined;
}

export interface KeybindingConflict {
  action: ShortcutAction;
  chord: KeybindingChord;
}

export function findKeybindingConflict(
  actionId: KeybindingActionId,
  chord: KeybindingChord,
  custom: KeybindingSettings | undefined,
): KeybindingConflict | undefined {
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === actionId) continue;
    const conflict = effectiveChords(action, custom).find((item) =>
      chordsEqual(item, chord),
    );
    if (conflict) return { action, chord: conflict };
  }
  return undefined;
}

export function canAssignChord(
  actionId: KeybindingActionId,
  chord: KeybindingChord,
): boolean {
  if (chord.key === "Escape") return actionId === "closeOverlay";
  return chord.mod === true;
}

export function chordFromKeyboardEvent(
  event: KeyboardEvent,
): KeybindingChord | undefined {
  if (event.altKey) return undefined;
  if (
    event.key === "Meta" ||
    event.key === "Control" ||
    event.key === "Shift"
  ) {
    return undefined;
  }
  if (event.key === "Escape") return { key: "Escape" };
  if (!(event.metaKey || event.ctrlKey)) return undefined;
  const key = event.key.toLowerCase();
  if (!/^[a-z0-9]$/.test(key)) return undefined;
  return {
    key,
    mod: true,
    ...(event.shiftKey ? { shift: true } : {}),
  };
}

export function invalidChordMessage(
  actionId: KeybindingActionId,
  chord: KeybindingChord | undefined,
): string {
  if (chord?.key === "Escape" && actionId !== "closeOverlay") {
    return "Escape is reserved for closing overlays.";
  }
  return "Use Cmd/Ctrl with a letter or digit.";
}

export function shortcutActionById(
  id: KeybindingActionId,
): ShortcutAction | undefined {
  return ACTION_BY_ID.get(id);
}
