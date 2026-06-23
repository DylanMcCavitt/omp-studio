// Pure, DOM-free helpers for the slash-command palette. Kept framework-free so
// the filter/insert logic can be unit-tested directly under `bun test`
// (test/slash-commands.test.ts) and reused by the SlashCommandPalette without
// dragging in React or the store.
//
// omp advertises commands via `available_commands_update` with bare names (no
// leading slash, e.g. "compact"). The palette inserts `/<name> ` into the
// composer — always with a trailing space, and we NEVER infer a no-arg command
// from its name, so every selection leaves the cursor ready to type arguments.

import type { AvailableCommand } from "@shared/rpc";

/**
 * A command's bare token without a leading slash. omp emits names without one,
 * but we strip defensively so a build that ever prefixes a slash can't produce
 * `//name`.
 */
export function commandName(command: AvailableCommand): string {
  return command.name.replace(/^\/+/, "");
}

/**
 * The text inserted into the composer when a command is chosen: `/<name> `.
 * Always slash-prefixed with a trailing space — never infer no-arg from the
 * name, so commands that take arguments stay typeable immediately.
 */
export function commandInsertText(command: AvailableCommand): string {
  return `/${commandName(command)} `;
}

/**
 * Filter commands by the query typed after `/`. Case-insensitive substring match
 * against the command name first, then its description; a leading slash on the
 * query is ignored. An empty query returns the list unchanged. Input order is
 * preserved (omp already orders commands sensibly).
 */
export function filterCommands(
  commands: AvailableCommand[],
  query: string,
): AvailableCommand[] {
  const q = query.trim().toLowerCase().replace(/^\/+/, "");
  if (q === "") return commands;
  return commands.filter((c) => {
    if (commandName(c).toLowerCase().includes(q)) return true;
    const desc = typeof c.description === "string" ? c.description : "";
    return desc.toLowerCase().includes(q);
  });
}
