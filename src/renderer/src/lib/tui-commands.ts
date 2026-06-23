// Static, curated reference of omp **TUI-only** commands — the literal answer to
// the "I don't see tan/omfg/tree in Studio" report. These are interactive-mode
// commands of the `omp` terminal client; they are NOT disk `SKILL.md` skills and
// NOT live Studio slash commands (they don't apply outside the TUI), so they
// never arrive over `available_commands_update`. The Skills & Commands view
// renders them READ-ONLY and badged "TUI only — not available in Studio" so they
// are visible-but-clearly-non-actionable rather than silently absent.
//
// Kept as plain data (no channel, no fetch): the set is curated by hand and only
// holds entries confirmed to be TUI-only by PlatformArchitect + Main. New entries
// are added here, not discovered at runtime.

/** A single TUI-only command shown in the read-only reference section. */
export interface TuiCommand {
  /** Bare command name (no leading slash); the view prefixes the slash. */
  name: string;
  /** One-line summary of what the command does in the omp TUI. */
  description: string;
}

/** The curated TUI-only command reference (stable order). */
export const TUI_ONLY_COMMANDS: readonly TuiCommand[] = [
  {
    name: "tan",
    description: "Run a full background agent on tangential work",
  },
  { name: "omfg", description: "Forge a TTSR rule" },
  { name: "tree", description: "Navigate the session tree" },
];
