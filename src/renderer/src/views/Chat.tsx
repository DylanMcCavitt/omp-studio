// The live agent chat view. With no active chat it shows a start panel (project
// picker, model select, initial prompt). With an active chat it shows the
// transcript + composer on the left and model / thinking / plan / subagent rails
// on the right, attaching the chat store to the bridge session on mount.

import type { RpcModel, ThinkingLevel } from "@shared/rpc";
import { FolderOpen, MessageSquarePlus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { SubagentTree } from "@/components/chat/SubagentTree";
import { TodoPanel } from "@/components/chat/TodoPanel";
import { Badge, Button, Panel, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAsync } from "@/lib/useAsync";
import { useAppStore } from "@/store/app";
import type { ChatStatus } from "@/store/chat";
import { useChatStore } from "@/store/chat";

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export default function Chat() {
  const activeChatId = useAppStore((s) => s.activeChatId);
  if (!activeChatId) return <StartPanel />;
  return <ChatSession activeChatId={activeChatId} />;
}

function StartPanel() {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSelectedProject = useAppStore((s) => s.setSelectedProject);
  const start = useChatStore((s) => s.start);
  const send = useChatStore((s) => s.send);
  const status = useChatStore((s) => s.status);
  const { data: models, loading } = useAsync(() => window.omp.listModels(), []);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!model && models && models.length > 0) setModel(models[0].selector);
  }, [models, model]);

  const spawning = status === "spawning";
  const canStart =
    Boolean(selectedProject) && prompt.trim() !== "" && !spawning;

  const onStart = async () => {
    if (!selectedProject || prompt.trim() === "") return;
    const text = prompt;
    setPrompt("");
    await start({ cwd: selectedProject, model: model || undefined });
    await send(text);
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
            <textarea
              value={prompt}
              rows={5}
              placeholder="Describe what you want the agent to do…"
              onChange={(e) => setPrompt(e.target.value)}
              className="scrollbar w-full resize-none rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>

          <Button
            variant="primary"
            onClick={() => void onStart()}
            disabled={!canStart}
            className="w-full justify-center"
          >
            <span className="flex items-center justify-center gap-1.5">
              {spawning ? (
                <Spinner size={14} />
              ) : (
                <MessageSquarePlus className="h-4 w-4" />
              )}
              Start session
            </span>
          </Button>
        </Panel>
      </div>
    </div>
  );
}

function ChatSession({ activeChatId }: { activeChatId: string }) {
  const sessionId = useChatStore((s) => s.sessionId);
  const attach = useChatStore((s) => s.attach);
  const status = useChatStore((s) => s.status);
  const model = useChatStore((s) => s.model);
  const thinkingLevel = useChatStore((s) => s.thinkingLevel);
  const contextUsage = useChatStore((s) => s.contextUsage);
  const setModel = useChatStore((s) => s.setModel);
  const setThinking = useChatStore((s) => s.setThinking);
  const error = useChatStore((s) => s.error);

  useEffect(() => {
    if (sessionId === activeChatId) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await window.omp.chat.getState(activeChatId);
        if (!cancelled) await attach(activeChatId, state);
      } catch {
        // The bridge may not hold this session id; leave the store untouched.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChatId, sessionId, attach]);

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
          <StatusBadge status={status} />
          {contextUsage && (
            <span className="ml-auto text-xs text-ink-faint">
              {Math.round(contextUsage.percent)}% context
            </span>
          )}
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
        <TodoPanel />
        <SubagentTree />
      </aside>
    </div>
  );
}

function StatusBadge({ status }: { status: ChatStatus }) {
  if (status === "streaming") {
    return (
      <Badge variant="accent">
        <span className="flex items-center gap-1.5">
          <Spinner size={12} />
          Streaming
        </span>
      </Badge>
    );
  }
  if (status === "spawning") return <Badge variant="warn">Starting</Badge>;
  if (status === "error") return <Badge variant="danger">Error</Badge>;
  return <Badge variant="success">Ready</Badge>;
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
