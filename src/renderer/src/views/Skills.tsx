// Skills & Commands (feature 6). Three sections share one search box:
//   1. Skills        — disk SKILL.md bundles via `window.omp.listSkills` (roots
//                       fixed in main). Unchanged grid, now in a Collapsible.
//   2. Session cmds   — the active session's live `availableCommands` (reduced
//                       off `available_commands_update`) merged with an
//                       on-demand `chat.getAvailableCommands(sessionId)` fetch on
//                       view open. Filterable, pinnable (→ settings.ui), and
//                       "Use in chat" routes to Chat with `/name ` prefilled.
//                       Explicit empty state when no session is loaded.
//   3. TUI-only cmds  — a static curated reference (tan/omfg/tree …), rendered
//                       READ-ONLY and badged "TUI only — not available in Studio".
//
// commandInsertText / commandName / filterCommands are reused from the shared
// slash-command helpers so the palette and this view stay one convention.

import type { AvailableCommand, AvailableSlashCommand } from "@shared/rpc";
import {
  Command,
  Pin,
  RefreshCw,
  Search,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Collapsible,
  EmptyState,
  IconButton,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  type CommandLike,
  commandInsertText,
  commandName,
  filterCommands,
} from "@/lib/slash-commands";
import { TUI_ONLY_COMMANDS } from "@/lib/tui-commands";
import { useAsync } from "@/lib/useAsync";
import { useAppStore } from "@/store/app";
import { useActiveSession } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";

/** Stable empty refs so the no-session / no-pins selectors keep a steady identity. */
const NO_COMMANDS: AvailableCommand[] = [];
const NO_PINS: string[] = [];

/**
 * Merge the session's live commands with the on-demand snapshot into one
 * deduped list keyed by bare name. Live order is kept; the snapshot augments
 * descriptions and appends any names the live stream hasn't delivered yet.
 */
function mergeSessionCommands(
  live: readonly AvailableCommand[],
  fetched: readonly AvailableSlashCommand[],
): CommandLike[] {
  const byName = new Map<string, CommandLike>();
  for (const c of live) {
    const name = commandName(c);
    byName.set(name, {
      name,
      description:
        typeof c.description === "string" ? c.description : undefined,
    });
  }
  for (const c of fetched) {
    const name = commandName(c);
    byName.set(name, {
      name,
      description: c.description ?? byName.get(name)?.description,
    });
  }
  return [...byName.values()];
}

export default function Skills() {
  const [query, setQuery] = useState("");

  // 1. Skills (disk).
  const {
    data: skillData,
    loading: skillsLoading,
    error: skillsError,
    reload,
  } = useAsync(() => window.omp.listSkills());

  // 2. Session commands: live stream merged with an on-open snapshot fetch.
  const activeSessionId = useActiveSession((s) => s?.sessionId ?? null);
  const liveCommands = useActiveSession(
    (s) => s?.availableCommands ?? NO_COMMANDS,
  );
  const { data: fetchedCommands } = useAsync(
    () =>
      activeSessionId
        ? window.omp.chat.getAvailableCommands(activeSessionId)
        : Promise.resolve<AvailableSlashCommand[]>([]),
    [activeSessionId],
  );
  const pinnedCommands = useSettingsStore(
    (s) => s.settings?.ui?.pinnedCommands ?? NO_PINS,
  );
  const togglePinnedCommand = useSettingsStore((s) => s.togglePinnedCommand);
  const prefillComposer = useAppStore((s) => s.prefillComposer);

  const skills = useMemo(() => {
    const list = skillData ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skillData, query]);

  const sessionCommands = useMemo(
    () => mergeSessionCommands(liveCommands, fetchedCommands ?? []),
    [liveCommands, fetchedCommands],
  );
  // Filter, then float pinned commands to the top (stable sort keeps order).
  const visibleCommands = useMemo(() => {
    const filtered = filterCommands(sessionCommands, query);
    return [...filtered].sort((a, b) => {
      const ap = pinnedCommands.includes(a.name) ? 0 : 1;
      const bp = pinnedCommands.includes(b.name) ? 0 : 1;
      return ap - bp;
    });
  }, [sessionCommands, query, pinnedCommands]);

  const visibleTui = useMemo(
    () => filterCommands(TUI_ONLY_COMMANDS, query),
    [query],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Skills & Commands</h1>
          <p className="truncate text-sm text-ink-muted">
            Disk skills, the active session's slash commands, and the TUI-only
            reference
          </p>
        </div>
        <IconButton label="Reload skills" onClick={reload}>
          <RefreshCw
            className={cn("h-4 w-4", skillsLoading && "animate-spin")}
          />
        </IconButton>
      </div>

      <div className="shrink-0 px-6 pt-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter skills and commands"
            className="w-full rounded-md border border-border bg-bg-raised py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="scrollbar min-h-0 flex-1 space-y-6 overflow-auto px-6 py-4">
        <Collapsible
          persistKey="skills:section:skills"
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              Skills
              <Badge variant="muted">{skills.length}</Badge>
            </span>
          }
          bodyClassName="pt-3"
        >
          {skillsLoading ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : skillsError ? (
            <EmptyState
              icon={<TriangleAlert className="h-6 w-6" />}
              title="Failed to load skills"
              hint={skillsError}
            />
          ) : skills.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="h-6 w-6" />}
              title={query ? "No matching skills" : "No skills found"}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {skills.map((skill) => (
                <Card key={skill.path} className="flex flex-col gap-2 p-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0 text-accent" />
                    <span className="truncate font-mono text-sm text-ink">
                      {skill.name}
                    </span>
                    <Badge
                      variant={
                        skill.source === "project"
                          ? "accent"
                          : skill.source === "user"
                            ? "success"
                            : "muted"
                      }
                      className="ml-auto"
                    >
                      {skill.source}
                    </Badge>
                  </div>
                  <p className="line-clamp-4 text-xs text-ink-muted">
                    {skill.description}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </Collapsible>

        <Collapsible
          persistKey="skills:section:session"
          title={
            <span className="flex items-center gap-2">
              <Command className="h-4 w-4 text-accent" />
              Session commands
              <Badge variant="muted">{visibleCommands.length}</Badge>
            </span>
          }
          bodyClassName="pt-3"
        >
          {!activeSessionId ? (
            <EmptyState
              icon={<Command className="h-6 w-6" />}
              title="No session loaded"
              hint="Start or open a session to load its commands."
            />
          ) : visibleCommands.length === 0 ? (
            <EmptyState
              icon={<Command className="h-6 w-6" />}
              title={
                query ? "No matching commands" : "No commands for this session"
              }
            />
          ) : (
            <ul className="space-y-1.5">
              {visibleCommands.map((cmd) => {
                const pinned = pinnedCommands.includes(cmd.name);
                return (
                  <li
                    key={cmd.name}
                    className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-raised px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-sm text-ink">
                          /{cmd.name}
                        </span>
                        {pinned && <Badge variant="accent">Pinned</Badge>}
                      </div>
                      {cmd.description && (
                        <p className="truncate text-xs text-ink-muted">
                          {cmd.description}
                        </p>
                      )}
                    </div>
                    <IconButton
                      label={pinned ? "Unpin command" : "Pin command"}
                      aria-pressed={pinned}
                      onClick={() => void togglePinnedCommand(cmd.name)}
                    >
                      <Pin
                        className={cn(
                          "h-4 w-4",
                          pinned ? "fill-accent text-accent" : "text-ink-faint",
                        )}
                      />
                    </IconButton>
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => prefillComposer(commandInsertText(cmd))}
                    >
                      Use in chat
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Collapsible>

        <Collapsible
          persistKey="skills:section:tui"
          defaultOpen={false}
          title={
            <span className="flex items-center gap-2">
              <SquareTerminal className="h-4 w-4 text-ink-muted" />
              TUI-only commands
              <Badge variant="muted">reference</Badge>
            </span>
          }
          bodyClassName="pt-3"
        >
          <p className="mb-2 text-xs text-ink-muted">
            These run only in the omp terminal client — they are not available
            in Studio and cannot be sent from chat.
          </p>
          {visibleTui.length === 0 ? (
            <EmptyState
              icon={<SquareTerminal className="h-6 w-6" />}
              title="No matching commands"
            />
          ) : (
            <ul className="space-y-1.5">
              {visibleTui.map((cmd) => (
                <li
                  key={cmd.name}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-raised/50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <span className="truncate font-mono text-sm text-ink-muted">
                      /{cmd.name}
                    </span>
                    <p className="truncate text-xs text-ink-faint">
                      {cmd.description}
                    </p>
                  </div>
                  <Badge variant="warn">
                    TUI only — not available in Studio
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Collapsible>
      </div>
    </div>
  );
}
