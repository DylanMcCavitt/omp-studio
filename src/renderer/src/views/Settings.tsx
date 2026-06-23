import type {
  ModelInfo,
  ProviderAuthStatus,
  ProviderInfo,
} from "@shared/domain";
import type { ThemeMode, Workspace } from "@shared/ipc";
import type { ApprovalMode, ThinkingLevel } from "@shared/rpc";
import {
  Boxes,
  Check,
  Cpu,
  ExternalLink,
  FolderOpen,
  FolderTree,
  KeyRound,
  Palette,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  type BadgeVariant,
  Button,
  Combobox,
  EmptyState,
  IconButton,
  Panel,
  Spinner,
} from "@/components/ui";
import { AddWorkspaceDialog } from "@/components/workspace/AddWorkspaceDialog";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { type AsyncState, useAsync } from "@/lib/useAsync";
import { sortWorkspaces } from "@/lib/workspaces";
import { useSettingsStore } from "@/store/settings";

const PATHS = [
  { label: "Agent directory", value: "~/.omp/agent" },
  { label: "Sessions", value: "~/.omp/agent/sessions" },
  { label: "MCP config", value: "~/.omp/agent/mcp.json" },
];

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

const APPROVAL_MODES: ApprovalMode[] = ["always-ask", "write", "yolo"];

const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const AUTH_BADGE: Record<
  ProviderAuthStatus,
  { variant: BadgeVariant; label: string }
> = {
  authenticated: { variant: "success", label: "authenticated" },
  unauthenticated: { variant: "danger", label: "not authenticated" },
  not_required: { variant: "muted", label: "no auth required" },
  unknown: { variant: "warn", label: "unknown" },
};

const selectClass =
  "w-full rounded-lg border border-border-subtle bg-bg-raised px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50";

interface DangerRequest {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export default function Settings() {
  const settingsLoading = useSettingsStore((s) => s.loading);
  const settingsError = useSettingsStore((s) => s.error);
  const reloadSettings = useSettingsStore((s) => s.load);

  const models = useAsync(() => window.omp.listModels());
  const providers = useAsync(() => window.omp.listProviders());

  const [danger, setDanger] = useState<DangerRequest | null>(null);

  const busy = models.loading || providers.loading || settingsLoading;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Settings</h1>
          <p className="truncate text-sm text-ink-muted">
            Defaults, appearance, workspaces, providers, and harness paths
          </p>
        </div>
        <IconButton
          label="Reload"
          onClick={() => {
            models.reload();
            providers.reload();
            void reloadSettings();
          }}
        >
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
        </IconButton>
      </div>

      <div className="scrollbar min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {settingsError && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <span>Could not save settings: {settingsError}</span>
            </div>
          )}

          <DefaultsPanel
            models={models.data ?? []}
            modelsLoading={models.loading}
            requestDanger={setDanger}
          />
          <AppearancePanel />
          <WorkspacesPanel />
          <ProvidersPanel state={providers} />
          <ModelsPanel state={models} />
          <PathsPanel />
          <AboutPanel />
        </div>
      </div>

      {danger && (
        <DangerDialog request={danger} onClose={() => setDanger(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function DefaultsPanel({
  models,
  modelsLoading,
  requestDanger,
}: {
  models: ModelInfo[];
  modelsLoading: boolean;
  requestDanger: (req: DangerRequest) => void;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  const title = (
    <span className="flex items-center gap-2">
      <SlidersHorizontal className="h-4 w-4 text-accent" />
      Defaults
    </span>
  );

  if (!settings) {
    return (
      <Panel title={title}>
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      </Panel>
    );
  }

  const onApprovalChange = (mode: ApprovalMode) => {
    if (mode === "yolo") {
      requestDanger({
        title: "Enable YOLO approval mode?",
        message:
          "YOLO mode lets new sessions run every tool — including file writes and shell commands — without asking. Only use it in trusted, sandboxed projects.",
        confirmLabel: "Enable YOLO",
        onConfirm: () => void update({ defaultApprovalMode: "yolo" }),
      });
      return;
    }
    void update({ defaultApprovalMode: mode });
  };

  const onAutoApproveToggle = () => {
    if (!settings.defaultAutoApprove) {
      requestDanger({
        title: "Auto-approve every request by default?",
        message:
          "Auto-approve answers all tool and input requests for new sessions automatically, with no chance to review. This is dangerous outside isolated environments.",
        confirmLabel: "Enable auto-approve",
        onConfirm: () => void update({ defaultAutoApprove: true }),
      });
      return;
    }
    void update({ defaultAutoApprove: false });
  };

  const dangerous =
    settings.defaultApprovalMode === "yolo" || settings.defaultAutoApprove;

  return (
    <Panel title={title} bodyClassName="space-y-4 p-4">
      <Field
        label="Default model"
        hint="Prefills the model selector for new sessions."
      >
        <Combobox
          aria-label="Default model"
          disabled={modelsLoading}
          value={settings.defaultModel ?? ""}
          placeholder="First available"
          searchPlaceholder="Search models…"
          onChange={(value) => void update({ defaultModel: value || null })}
          options={[
            { value: "", label: "First available" },
            ...models.map((m) => ({ value: m.selector, label: m.name })),
          ]}
        />
      </Field>

      <Field label="Default thinking level">
        <select
          className={selectClass}
          value={settings.defaultThinkingLevel}
          onChange={(e) =>
            void update({
              defaultThinkingLevel: e.target.value as ThinkingLevel,
            })
          }
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Default approval mode"
        hint="always-ask prompts before every tool; write auto-allows file writes; yolo allows everything."
      >
        <select
          className={cn(
            selectClass,
            settings.defaultApprovalMode === "yolo" &&
              "border-danger/50 text-danger",
          )}
          value={settings.defaultApprovalMode}
          onChange={(e) => onApprovalChange(e.target.value as ApprovalMode)}
        >
          {APPROVAL_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink">Auto-approve all requests</span>
            {settings.defaultAutoApprove && (
              <Badge variant="danger">dangerous</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-faint">
            Skip every approval dialog for new sessions.
          </p>
        </div>
        <Toggle
          checked={settings.defaultAutoApprove}
          danger
          label="Auto-approve all requests by default"
          onChange={onAutoApproveToggle}
        />
      </div>

      {dangerous && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            New sessions will run with reduced safety prompts. Make sure you
            trust the projects you open.
          </span>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Appearance (theme toggle; G1 owns the CSS-variable application of settings.theme)
// ---------------------------------------------------------------------------

function AppearancePanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  const title = (
    <span className="flex items-center gap-2">
      <Palette className="h-4 w-4 text-accent" />
      Appearance
    </span>
  );

  if (!settings) {
    return (
      <Panel title={title}>
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={title} bodyClassName="space-y-4 p-4">
      <Field label="Theme" hint="System follows your OS appearance.">
        <select
          className={selectClass}
          value={settings.theme}
          onChange={(e) => void update({ theme: e.target.value as ThemeMode })}
        >
          {THEME_MODES.map((theme) => (
            <option key={theme.value} value={theme.value}>
              {theme.label}
            </option>
          ))}
        </select>
      </Field>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Workspaces (first-class projects: pin / set-default / edit label / re-point / remove)
// ---------------------------------------------------------------------------

function WorkspacesPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const updateWorkspace = useSettingsStore((s) => s.updateWorkspace);
  const removeWorkspace = useSettingsStore((s) => s.removeWorkspace);
  const [adding, setAdding] = useState(false);

  const title = (
    <span className="flex items-center gap-2">
      <FolderOpen className="h-4 w-4 text-accent" />
      Workspaces
    </span>
  );

  if (!settings) {
    return (
      <Panel title={title}>
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      </Panel>
    );
  }

  const workspaces = sortWorkspaces(settings.workspaces ?? []);
  const { defaultProject } = settings;

  return (
    <Panel
      title={title}
      actions={
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      }
    >
      {workspaces.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-6 w-6" />}
          title="No workspaces yet"
          hint="Add a project directory to start sessions from it quickly."
        />
      ) : (
        <div className="space-y-0.5">
          {workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              isDefault={workspace.cwd === defaultProject}
              onSetDefault={() =>
                void update({ defaultProject: workspace.cwd })
              }
              onTogglePin={() =>
                void updateWorkspace(workspace.id, {
                  pinned: !workspace.pinned,
                })
              }
              onRename={(label) =>
                void updateWorkspace(workspace.id, { label })
              }
              onRepoint={(cwd) => void updateWorkspace(workspace.id, { cwd })}
              onRemove={() => void removeWorkspace(workspace.id)}
            />
          ))}
        </div>
      )}
      {adding && <AddWorkspaceDialog onClose={() => setAdding(false)} />}
    </Panel>
  );
}

function WorkspaceRow({
  workspace,
  isDefault,
  onSetDefault,
  onTogglePin,
  onRename,
  onRepoint,
  onRemove,
}: {
  workspace: Workspace;
  isDefault: boolean;
  onSetDefault: () => void;
  onTogglePin: () => void;
  onRename: (label: string) => void;
  onRepoint: (cwd: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workspace.label);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select the label text whenever the row enters edit mode.
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== workspace.label) onRename(next);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(workspace.label);
    setEditing(false);
  };

  const repoint = () => {
    void window.omp.pickDirectory().then((dir) => {
      if (dir && dir !== workspace.cwd) onRepoint(dir);
    });
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            aria-label="Workspace label"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            className="w-full rounded-md border border-border-subtle bg-bg-raised px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-ink">{workspace.label}</span>
            {workspace.pinned && <Badge variant="muted">pinned</Badge>}
            {isDefault && <Badge variant="accent">default</Badge>}
          </div>
        )}
        <span className="block truncate font-mono text-xs text-ink-faint">
          {workspace.cwd}
        </span>
      </div>

      {editing ? (
        <>
          <IconButton
            label="Save label"
            onMouseDown={(e) => e.preventDefault()}
            onClick={commit}
          >
            <Check className="h-4 w-4 text-ink-faint" />
          </IconButton>
          <IconButton
            label="Cancel edit"
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancel}
          >
            <X className="h-4 w-4 text-ink-faint" />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton
            label={workspace.pinned ? "Unpin workspace" : "Pin workspace"}
            onClick={onTogglePin}
          >
            <Pin
              className={cn(
                "h-4 w-4",
                workspace.pinned ? "fill-accent text-accent" : "text-ink-faint",
              )}
            />
          </IconButton>
          <IconButton
            label={isDefault ? "Default workspace" : "Set as default"}
            disabled={isDefault}
            onClick={onSetDefault}
          >
            <Star
              className={cn(
                "h-4 w-4",
                isDefault ? "fill-accent text-accent" : "text-ink-faint",
              )}
            />
          </IconButton>
          <IconButton
            label="Edit label"
            onClick={() => {
              setDraft(workspace.label);
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4 text-ink-faint" />
          </IconButton>
          <IconButton label="Re-point directory" onClick={repoint}>
            <FolderOpen className="h-4 w-4 text-ink-faint" />
          </IconButton>
          <IconButton label="Remove workspace" onClick={onRemove}>
            <Trash2 className="h-4 w-4 text-ink-faint" />
          </IconButton>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Providers (real auth status from listProviders)
// ---------------------------------------------------------------------------

function ProvidersPanel({ state }: { state: AsyncState<ProviderInfo[]> }) {
  const title = (
    <span className="flex items-center gap-2">
      <KeyRound className="h-4 w-4 text-accent" />
      Providers
    </span>
  );

  return (
    <Panel title={title}>
      {state.loading ? (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      ) : state.error ? (
        <EmptyState
          icon={<TriangleAlert className="h-6 w-6" />}
          title="Failed to load providers"
          hint={state.error}
        />
      ) : (state.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-6 w-6" />}
          title="No providers configured"
        />
      ) : (
        <div className="space-y-1">
          {state.data?.map((provider) => {
            const badge = AUTH_BADGE[provider.authStatus];
            return (
              <div key={provider.id} className="flex items-center gap-2 py-1">
                <span className="flex-1 truncate text-sm text-ink">
                  {provider.name}
                </span>
                {provider.authSource && (
                  <span className="text-xs text-ink-faint">
                    via {provider.authSource}
                  </span>
                )}
                <span className="text-xs text-ink-faint">
                  {formatNumber(provider.modelCount)} models
                </span>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Models (catalog reference)
// ---------------------------------------------------------------------------

function ModelsPanel({ state }: { state: AsyncState<ModelInfo[]> }) {
  const grouped = useMemo(() => {
    const byProvider = new Map<string, ModelInfo[]>();
    for (const model of state.data ?? []) {
      const arr = byProvider.get(model.provider);
      if (arr) arr.push(model);
      else byProvider.set(model.provider, [model]);
    }
    return Array.from(byProvider, ([provider, items]) => ({ provider, items }));
  }, [state.data]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-accent" />
          Models
          {state.data && (
            <Badge variant="muted">{formatNumber(state.data.length)}</Badge>
          )}
        </span>
      }
    >
      {state.loading ? (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      ) : state.error ? (
        <EmptyState
          icon={<TriangleAlert className="h-6 w-6" />}
          title="Failed to load models"
          hint={state.error}
        />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={<Cpu className="h-6 w-6" />}
          title="No models available"
        />
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.provider}>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {group.provider}
                </span>
                <Badge variant="muted">{group.items.length}</Badge>
              </div>
              <div className="space-y-0.5">
                {group.items.map((model) => (
                  <div
                    key={model.selector}
                    className="flex flex-wrap items-center gap-2 py-1"
                  >
                    <span className="flex-1 truncate font-mono text-xs text-ink">
                      {model.name}
                    </span>
                    {model.reasoning && (
                      <Badge variant="accent">reasoning</Badge>
                    )}
                    {typeof model.contextWindow === "number" && (
                      <span className="text-xs text-ink-faint">
                        {formatNumber(model.contextWindow)} ctx
                      </span>
                    )}
                    {model.cost?.input != null && (
                      <span className="text-xs text-ink-faint">
                        ${model.cost.input}/M in
                      </span>
                    )}
                    {model.cost?.output != null && (
                      <span className="text-xs text-ink-faint">
                        ${model.cost.output}/M out
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Paths / About (unchanged)
// ---------------------------------------------------------------------------

function PathsPanel() {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-accent" />
          Paths
        </span>
      }
    >
      <div className="space-y-3">
        {PATHS.map((path) => (
          <div key={path.label} className="flex flex-col gap-0.5">
            <span className="text-xs text-ink-faint">{path.label}</span>
            <code className="break-all font-mono text-xs text-ink-muted">
              {path.value}
            </code>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AboutPanel() {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-accent" />
          About
        </span>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink">OMP Studio</span>
          <Badge variant="muted">v0.1.0</Badge>
        </div>
        <p className="text-xs text-ink-muted">
          A desktop companion for the Oh My Pi (omp) coding-agent harness.
        </p>
        <button
          type="button"
          onClick={() =>
            window.omp.openExternal("https://github.com/can1357/oh-my-pi")
          }
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          oh-my-pi on GitHub
        </button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-ink-muted">
        {label}
      </span>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  danger = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        checked
          ? danger
            ? "border-danger bg-danger/80"
            : "border-accent bg-accent"
          : "border-border-strong bg-bg-raised",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function DangerDialog({
  request,
  onClose,
}: {
  request: DangerRequest;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="danger-title"
        aria-describedby="danger-message"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-danger/40 bg-bg-panel p-5 shadow-panel focus:outline-none"
      >
        <div className="mb-3 flex items-center gap-2 text-danger">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <h2 id="danger-title" className="text-sm font-semibold">
            {request.title}
          </h2>
        </div>
        <p id="danger-message" className="mb-5 text-sm text-ink-muted">
          {request.message}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              request.onConfirm();
              onClose();
            }}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
