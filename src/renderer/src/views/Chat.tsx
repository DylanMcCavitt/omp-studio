// The live agent chat view. With no active session it shows a start panel
// (project picker, model select, initial prompt). With an active session it
// shows the transcript + composer on the left and model / thinking / plan /
// subagent rails on the right, reading the active session's slice from the
// normalized multi-session store.

import type { ChatUiRequestEvent } from "@shared/ipc";
import type { ImageContent, RpcModel, ThinkingLevel } from "@shared/rpc";
import { FolderOpen, MessageSquarePlus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { PromptComposer } from "@/components/chat/PromptComposer";
import { SessionRail, SessionStatusBadge } from "@/components/chat/SessionRail";
import {
  ContextMeterChip,
  SessionStatsPanel,
} from "@/components/chat/SessionStatsPanel";
import { SubagentTree } from "@/components/chat/SubagentTree";
import { TodoPanel } from "@/components/chat/TodoPanel";
import { UiRequestLayer } from "@/components/chat/UiRequestLayer";
import { Badge, Button, Panel, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAsync } from "@/lib/useAsync";
import { useAppStore } from "@/store/app";
import { useActiveSession, useChatStore } from "@/store/chat";
import { useSettingsStore } from "@/store/settings";

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/** Stable empty queue so the no-active-session selectors keep a steady ref. */
const NO_UI: ChatUiRequestEvent[] = [];

export default function ChatWorkspace() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  // Cmd/Ctrl+W (close active session) is handled by the global shortcut manager
  // (lib/useShortcuts), wired once in App — no per-view listener here.
  return (
    <div className="flex h-full min-h-0">
      {/* Mounted at the workspace root so the active session's pending UI
          requests survive session switches and render as focused modals. */}
      <UiRequestLayer />
      <SessionRail />
      <div className="flex min-w-0 flex-1 flex-col">
        {activeSessionId ? (
          <ChatSession key={activeSessionId} sessionId={activeSessionId} />
        ) : (
          <StartPanel />
        )}
      </div>
    </div>
  );
}

function StartPanel() {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const settings = useSettingsStore((s) => s.settings);
  const settingsLoading = useSettingsStore((s) => s.loading);
  const start = useChatStore((s) => s.start);
  const send = useChatStore((s) => s.send);
  const { data: models, loading } = useAsync(() => window.omp.listModels(), []);
  const [model, setModel] = useState("");

  // Seed the project picker from the saved default the first time it is unset.
  useEffect(() => {
    if (!selectedProject && settings?.defaultProject) {
      setSelectedProject(settings.defaultProject);
    }
  }, [selectedProject, settings?.defaultProject, setSelectedProject]);

  // Seed the model once BOTH the model list and persisted settings have
  // loaded: prefer the saved default, else fall back to the first available.
  // Gating on `settingsLoading` avoids racing in the first model before
  // `defaultModel` is known (which would then stick via the early return).
  useEffect(() => {
    if (model || settingsLoading || !models || models.length === 0) return;
    const defaultModel = settings?.defaultModel ?? null;
    const preferred =
      defaultModel && models.some((m) => m.selector === defaultModel)
        ? defaultModel
        : (models[0]?.selector ?? "");
    setModel(preferred);
  }, [models, model, settingsLoading, settings?.defaultModel]);

  const handleStart = async (
    text: string,
    images: ImageContent[],
  ): Promise<boolean> => {
    if (!selectedProject) return false;
    const ok = await start({
      cwd: selectedProject,
      model: model || undefined,
      thinkingLevel: settings?.defaultThinkingLevel,
      approvalPolicy: settings
        ? {
            mode: settings.defaultApprovalMode,
            autoApprove: settings.defaultAutoApprove,
          }
        : undefined,
    });
    if (!ok) return false;
    // Return the prompt's acceptance: if session creation succeeds but the
    // initial send is rejected, the composer keeps text + attachments to retry.
    return await send(text, images);
  };

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-xl animate-fade-in space-y-5">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-ink">
            Start a new session
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Pick a project directory, choose a model, and describe the task.
          </p>
        </div>

        <Panel title="New session" bodyClassName="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">
              Project directory
            </label>
            <button
              type="button"
              onClick={() => {
                void window.omp.pickDirectory().then((dir) => {
                  if (dir) setSelectedProject(dir);
                });
              }}
              className="flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-left text-sm hover:bg-bg-hover"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-ink-muted" />
              <span
                className={cn(
                  "truncate",
                  selectedProject ? "text-ink" : "text-ink-faint",
                )}
              >
                {selectedProject ?? "Choose a project directory"}
              </span>
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">
              Model
            </label>
            <select
              value={model}
              disabled={loading || !models}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50"
            >
              {loading && <option value="">Loading models…</option>}
              {models?.map((m) => (
                <option key={m.selector} value={m.selector}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">
              Prompt
            </label>
            <PromptComposer
              rows={5}
              submitOnEnter={false}
              placeholder="Describe what you want the agent to do…"
              onSubmit={handleStart}
              actionsPlacement="below"
              renderActions={({ submit, canSubmit, busy }) => (
                <Button
                  variant="primary"
                  onClick={submit}
                  disabled={!canSubmit || !selectedProject}
                  className="w-full justify-center"
                >
                  <span className="flex items-center justify-center gap-1.5">
                    {busy ? (
                      <Spinner size={14} />
                    ) : (
                      <MessageSquarePlus className="h-4 w-4" />
                    )}
                    Start session
                  </span>
                </Button>
              )}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ChatSession({ sessionId }: { sessionId: string }) {
  const open = useChatStore((s) => Boolean(s.openSessions[sessionId]));
  const openSession = useChatStore((s) => s.openSession);
  const status = useActiveSession((s) => s?.status ?? "idle");
  const model = useActiveSession((s) => s?.model ?? null);
  const thinkingLevel = useActiveSession((s) => s?.thinkingLevel ?? "medium");
  const setModel = useChatStore((s) => s.setModel);
  const setThinking = useChatStore((s) => s.setThinking);
  const error = useActiveSession((s) => s?.error);
  const uiRequests = useActiveSession((s) => s?.uiRequests ?? NO_UI);
  const isCompacting = useActiveSession((s) => s?.isCompacting ?? false);

  // Safety net: if the active session isn't registered yet (e.g. selected from
  // another surface), open it now. start() registers before activating, so this
  // no-ops for freshly created chats and on session switches.
  useEffect(() => {
    if (open) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await window.omp.chat.getState(sessionId);
        if (!cancelled) await openSession(sessionId, state);
      } catch {
        // The bridge may not hold this session id; leave the store untouched.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, open, openSession]);

  const modelName = model
    ? (model.name ?? `${model.provider}/${model.id}`)
    : "—";

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
          <span className="truncate font-mono text-sm text-ink">
            {modelName}
          </span>
          <Badge variant="muted" className="capitalize">
            {thinkingLevel}
          </Badge>
          <SessionStatusBadge
            status={status}
            uiRequests={uiRequests}
            isCompacting={isCompacting}
          />
          <ContextMeterChip />
        </header>
        {error && status === "error" && (
          <div className="border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger">
            {error}
          </div>
        )}
        <MessageList />
        <Composer />
      </div>

      <aside className="scrollbar w-80 shrink-0 space-y-4 overflow-y-auto border-l border-border-subtle bg-bg-panel/40 p-4">
        <ModelPanel model={model} onChange={setModel} />
        <ThinkingPanel level={thinkingLevel} onChange={setThinking} />
        <SessionStatsPanel sessionId={sessionId} />
        <TodoPanel />
        <SubagentTree />
      </aside>
    </div>
  );
}

function ModelPanel({
  model,
  onChange,
}: {
  model: RpcModel | null;
  onChange: (provider: string, id: string) => void;
}) {
  const { data: models } = useAsync(() => window.omp.listModels(), []);
  const current = models?.find(
    (m) => m.provider === model?.provider && m.id === model?.id,
  );

  return (
    <Panel title="Model">
      <select
        value={current?.selector ?? ""}
        disabled={!models}
        onChange={(e) => {
          const m = models?.find((x) => x.selector === e.target.value);
          if (m) onChange(m.provider, m.id);
        }}
        className="w-full rounded-md border border-border-subtle bg-bg-raised px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50"
      >
        {!current && (
          <option value="">
            {model ? `${model.provider}/${model.id}` : "Select a model"}
          </option>
        )}
        {models?.map((m) => (
          <option key={m.selector} value={m.selector}>
            {m.name}
          </option>
        ))}
      </select>
    </Panel>
  );
}

function ThinkingPanel({
  level,
  onChange,
}: {
  level: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
}) {
  return (
    <Panel title="Thinking">
      <div className="flex flex-wrap gap-1">
        {THINKING_LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onChange(l)}
            className={cn(
              "rounded-md px-2 py-1 text-xs capitalize transition-colors",
              l === level
                ? "bg-accent text-white"
                : "bg-bg-raised text-ink-muted hover:bg-bg-hover",
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </Panel>
  );
}
