// Pure, DOM-free helpers for the slash-command palette. Kept framework-free so
// the filter/insert logic can be unit-tested directly under `bun test`
// (test/slash-commands.test.ts) and reused by the SlashCommandPalette without
// dragging in React or the store.
//
// omp advertises commands via `available_commands_update` with bare names (no
// leading slash, e.g. "compact"). The palette inserts `/<name> ` into the
// composer — always with a trailing space, and we NEVER infer a no-arg command
// from its name, so every selection leaves the cursor ready to type arguments.

/**
 * Minimal command shape these helpers need: a bare name and an optional
 * description. Both the legacy `AvailableCommand` (live `available_commands_update`)
 * and the richer `AvailableSlashCommand` (the `get_available_commands` snapshot),
 * as well as the Skills view's merged session commands, satisfy it — so the
 * palette and the Commands section reuse one insert/filter convention.
 */
export interface CommandLike {
  name: string;
  description?: string;
}

/**
 * A command's bare token without a leading slash. omp emits names without one,
 * but we strip defensively so a build that ever prefixes a slash can't produce
 * `//name`.
 */
export function commandName(command: Pick<CommandLike, "name">): string {
  return command.name.replace(/^\/+/, "");
}

/**
 * The text inserted into the composer when a command is chosen: `/<name> `.
 * Always slash-prefixed with a trailing space — never infer no-arg from the
 * name, so commands that take arguments stay typeable immediately.
 */
export function commandInsertText(command: Pick<CommandLike, "name">): string {
  return `/${commandName(command)} `;
}

/**
 * Filter commands by the query typed after `/`. Case-insensitive substring match
 * against the command name first, then its description; a leading slash on the
 * query is ignored. An empty query returns the list unchanged. Input order is
 * preserved (omp already orders commands sensibly).
 */
export function filterCommands<T extends CommandLike>(
  commands: readonly T[],
  query: string,
): readonly T[] {
  const q = query.trim().toLowerCase().replace(/^\/+/, "");
  if (q === "") return commands;
  return commands.filter((c) => {
    if (commandName(c).toLowerCase().includes(q)) return true;
    const desc = typeof c.description === "string" ? c.description : "";
    return desc.toLowerCase().includes(q);
  });
}

/**
 * Resolve a stored cursor index against the current result length: clamp into
 * range, or 0 when the list is empty. The palette renders and selects from this
 * resolved value (never the raw stored index) so a stale index left over from a
 * longer, pre-filter list can never point past the end.
 */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

/**
 * Next cursor index for an arrow key, computed from the resolved (clamped)
 * current index so navigation stays correct even after the result set shrank.
 * Returns 0 for an empty list.
 */
export function moveIndex(
  current: number,
  direction: "up" | "down",
  length: number,
): number {
  if (length <= 0) return 0;
  const here = clampIndex(current, length);
  return direction === "down"
    ? Math.min(length - 1, here + 1)
    : Math.max(0, here - 1);
}
