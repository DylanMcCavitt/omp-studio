// A single live `omp --mode rpc-ui` child process, driven over JSONL stdio.
//
// This module must stay importable by PLAIN NODE via type-stripping, so it uses
// only erasable TypeScript (no enums, namespaces, parameter-properties, or
// `declare`) and never imports electron. Type-only imports from `@shared/*` are
// erased at runtime; `../paths` is a plain-node runtime dependency.
//
// Emits:
//  - "frame"      (frame: RpcFrame) — every non-response, non-ui-request frame
//  - "ui-request" ({ request, responseRequired }) — an extension UI request the
//                 host must answer via respondUi() when responseRequired is true
//  - "lifecycle"  (status: "ready"|"exited"|"error", detail?: string)
//  - "exit"       () — child process exited

import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { PromptOptions } from "@shared/ipc";
import type {
  ApprovalMode,
  ExtensionUiMethod,
  ExtensionUiRequest,
  ExtensionUiResponse,
  OmpMessage,
  RpcFrame,
  RpcState,
  SessionStats,
  SubagentMessagesResult,
  SubagentSnapshot,
  SubagentSubscriptionLevel,
  ThinkingLevel,
} from "@shared/rpc";
import { scoped } from "../logger";
import { augmentedEnv, ompBinary } from "../paths";

const log = scoped("omp-rpc");

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  /** Command type, used to correlate id-less unknown-command failures. */
  command: string;
}

interface OutgoingCommand {
  type: string;
  [key: string]: unknown;
}

// Fail-closed backstop when an extension UI request omits its own timeout.
const DEFAULT_UI_REQUEST_TIMEOUT_MS = 300_000; // 5 minutes

// Methods that block the agent until the host replies with an
// extension_ui_response. Everything else (notify/setStatus/setWidget/setTitle/
// set_editor_text/open_url) is a fire-and-forget UI hint.
const RESPONSE_REQUIRED_UI_METHODS = new Set<ExtensionUiMethod>([
  "confirm",
  "select",
  "input",
  "editor",
  "cancel",
]);

interface PendingUiRequest {
  method: ExtensionUiMethod;
  timer: ReturnType<typeof setTimeout>;
}

export class OmpRpcSession extends EventEmitter {
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pendingUi = new Map<string, PendingUiRequest>();
  private readonly initialThinkingLevel?: ThinkingLevel;
  private readonly readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (reason: Error) => void;
  private buffer = "";
  private sequence = 0;
  private isReady = false;
  private terminated = false;
  private disposed = false;
  // Mid-compaction flag, tracked from auto_compaction_start/end event frames.
  private compacting = false;

  constructor(opts: {
    cwd: string;
    model?: string;
    thinkingLevel?: ThinkingLevel;
    binary?: string;
    approvalMode?: ApprovalMode;
    autoApprove?: boolean;
    /** JSONL transcript path (preferred) or omp session id to resume. */
    resume?: string;
  }) {
    super();
    this.initialThinkingLevel = opts.thinkingLevel;

    const args = ["--mode", "rpc-ui", "--cwd", opts.cwd];
    if (opts.model) args.push("--model", opts.model);
    if (opts.resume) args.push("--resume", opts.resume);
    args.push("--approval-mode", opts.approvalMode ?? "always-ask");
    if (opts.autoApprove === true) args.push("--auto-approve");

    this.child = spawn(opts.binary ?? ompBinary(), args, {
      cwd: opts.cwd,
      env: augmentedEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.wireChild();
  }

  // ---- lifecycle --------------------------------------------------------

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminated = true;
    this.removeAllListeners();
    this.rejectAllPending(new Error("session disposed"));
    this.clearPendingUi();
    const stdin = this.child.stdin;
    if (stdin && !stdin.destroyed) {
      try {
        stdin.end();
      } catch {
        // stdin already torn down — nothing to flush.
      }
    }
    try {
      this.child.kill();
    } catch {
      // child already gone.
    }
  }

  // ---- commands ---------------------------------------------------------

  async getState(): Promise<RpcState> {
    return (await this.send({ type: "get_state" })) as RpcState;
  }

  async getMessages(): Promise<OmpMessage[]> {
    const data = (await this.send({ type: "get_messages" })) as
      | { messages?: OmpMessage[] }
      | OmpMessage[]
      | undefined;
    if (Array.isArray(data)) return data;
    return data?.messages ?? [];
  }

  // The richer SubagentSnapshot superset of the legacy SubagentInfo; the live
  // roster reduces the same shape from forwarded frames.
  async getSubagents(): Promise<SubagentSnapshot[]> {
    const data = (await this.send({ type: "get_subagents" })) as
      | { subagents?: SubagentSnapshot[] }
      | SubagentSnapshot[]
      | undefined;
    if (Array.isArray(data)) return data;
    return data?.subagents ?? [];
  }

  // Push the per-session subagent subscription level to the child (cost
  // control: scope "events" to the active session, drop background sessions to
  // "off"). Optional command — markReady already subscribes at "events", so we
  // degrade silently on an omp build that predates the setter.
  async setSubagentSubscription(
    level: SubagentSubscriptionLevel,
  ): Promise<void> {
    try {
      await this.send({ type: "set_subagent_subscription", level });
    } catch (error) {
      if (isUnknownCommand(error)) return;
      throw error;
    }
  }

  // Live, paginated transcript for a single subagent (drill-in). `fromByte`
  // resumes incremental tailing; on `reset: true` the consumer clears its
  // cursor and restarts from `nextByte` (session-file rotation). Degrades to an
  // empty result on an omp build without get_subagent_messages so the drill-in
  // shows "no messages" instead of an error.
  async getSubagentMessages(sel: {
    subagentId?: string;
    sessionFile?: string;
    fromByte?: number;
  }): Promise<SubagentMessagesResult> {
    try {
      const data = await this.send({ type: "get_subagent_messages", ...sel });
      return (data ?? emptySubagentMessages()) as SubagentMessagesResult;
    } catch (error) {
      if (isUnknownCommand(error)) return emptySubagentMessages();
      throw error;
    }
  }

  async prompt(message: string, opts?: PromptOptions): Promise<void> {
    await this.send({
      type: "prompt",
      message,
      images: opts?.images,
      streamingBehavior: opts?.streamingBehavior,
    });
  }

  async steer(message: string): Promise<void> {
    await this.send({ type: "steer", message });
  }

  async followUp(message: string): Promise<void> {
    await this.send({ type: "follow_up", message });
  }

  async abort(): Promise<void> {
    await this.send({ type: "abort" });
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    await this.send({ type: "set_model", provider, modelId });
  }

  async setThinking(level: ThinkingLevel): Promise<void> {
    await this.send({ type: "set_thinking_level", level });
  }

  // Permissive session stats (tokens / cost / contextUsage + unknown future
  // keys). omp builds that predate `get_session_stats` reply with an id-less
  // "Unknown command" failure (rpc-mode emits these with id: undefined); we
  // degrade to empty stats so the UI shows "no stats" instead of an error.
  async getSessionStats(): Promise<SessionStats> {
    try {
      const data = await this.send({ type: "get_session_stats" });
      return (data ?? {}) as SessionStats;
    } catch (error) {
      if (isUnknownCommand(error)) return {};
      throw error;
    }
  }

  // Compact the session context, optionally steering the summary. The command
  // resolves when compaction finishes; auto-compaction progress (not the manual
  // path) is surfaced via the auto_compaction_* frames -> isCompacting().
  async compact(customInstructions?: string): Promise<void> {
    try {
      await this.send({ type: "compact", customInstructions });
    } catch (error) {
      if (isUnknownCommand(error)) return;
      throw error;
    }
  }

  // Whether omp is mid-compaction, derived from the auto_compaction_start/end
  // event frames. The same frames are forwarded to the renderer over evt:rpc.
  isCompacting(): boolean {
    return this.compacting;
  }

  // ---- internals --------------------------------------------------------

  private send(command: OutgoingCommand): Promise<unknown> {
    if (this.disposed || this.terminated) {
      return Promise.reject(new Error("session is not running"));
    }
    const id = "req_" + this.sequence++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, command: command.type });
      this.writeFrame({ ...command, id });
    });
  }

  private writeFrame(frame: Record<string, unknown>): void {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return;
    try {
      stdin.write(JSON.stringify(frame) + "\n");
    } catch (error) {
      log.warn("failed to write frame", { error });
    }
  }

  private wireChild(): void {
    this.child.stdout?.on("data", (chunk: Buffer) => this.onStdout(chunk));
    // Drain + surface stderr so a chatty child never deadlocks on backpressure.
    this.child.stderr?.on("data", (chunk: Buffer) =>
      log.warn(`stderr: ${chunk.toString("utf8").trimEnd()}`),
    );
    // Swallow EPIPE etc. on a closing stdin; termination is handled via exit.
    this.child.stdin?.on("error", (error) =>
      log.warn("stdin error", { error }),
    );
    this.child.on("error", (error: Error) =>
      this.settleTermination("error", error.message),
    );
    this.child.on("exit", (code, signal) => {
      this.settleTermination(
        "exited",
        signal ? `signal ${signal}` : `code ${code ?? 0}`,
      );
      this.emit("exit");
    });
  }

  private onStdout(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.dispatch(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private dispatch(line: string): void {
    let frame: RpcFrame;
    try {
      frame = JSON.parse(line) as RpcFrame;
    } catch (error) {
      log.warn("failed to parse frame", { line, error });
      return;
    }

    if (frame.type === "response") {
      this.resolveResponse(frame);
      return;
    }
    if (frame.type === "extension_ui_request") {
      this.handleExtensionUi(frame);
      return;
    }
    if (frame.type === "ready") this.markReady();
    else if (frame.type === "auto_compaction_start") this.compacting = true;
    else if (frame.type === "auto_compaction_end") this.compacting = false;
    this.emit("frame", frame);
  }

  private markReady(): void {
    if (this.isReady) return;
    this.isReady = true;
    this.readyResolve();
    this.emit("lifecycle", "ready");
    void this.send({
      type: "set_subagent_subscription",
      level: "events",
    }).catch(() => undefined);
    if (this.initialThinkingLevel) {
      void this.send({
        type: "set_thinking_level",
        level: this.initialThinkingLevel,
      }).catch(() => undefined);
    }
  }

  private resolveResponse(frame: RpcFrame): void {
    const id = frame.id;
    if (typeof id === "string") {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      this.settle(pending, frame);
      return;
    }
    // omp emits unknown-command (and parse) failures with id: undefined, so
    // they can't be matched by id. Reject the earliest in-flight request of the
    // same command instead, so callers (e.g. getSessionStats) degrade rather
    // than hang forever on a command the installed omp doesn't implement.
    if (frame.success !== false || typeof frame.command !== "string") return;
    for (const [pendingId, pending] of this.pending) {
      if (pending.command === frame.command) {
        this.pending.delete(pendingId);
        this.settle(pending, frame);
        return;
      }
    }
  }

  // Resolve or reject a correlated pending request from its response frame.
  private settle(pending: PendingRequest, frame: RpcFrame): void {
    if (frame.success === false) {
      const error =
        typeof frame.error === "string" ? frame.error : "RPC command failed";
      pending.reject(new Error(error));
    } else {
      pending.resolve(frame.data);
    }
  }

  // Forward an extension UI request to the host. Response-required methods are
  // tracked with a fail-closed timeout; the host replies via respondUi(). Hint
  // methods carry responseRequired=false and expect no reply.
  private handleExtensionUi(frame: RpcFrame): void {
    const id = frame.id;
    if (typeof id !== "string") return;
    const method = frame.method as ExtensionUiMethod;
    const responseRequired = RESPONSE_REQUIRED_UI_METHODS.has(method);
    if (responseRequired) {
      const requested = frame.timeout;
      const timeoutMs =
        typeof requested === "number" && requested > 0
          ? requested
          : DEFAULT_UI_REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => this.timeoutUi(id), timeoutMs);
      // A dangling UI timeout must never keep the event loop (or app) alive.
      timer.unref();
      this.pendingUi.set(id, { method, timer });
    }
    this.emit("ui-request", {
      request: frame as ExtensionUiRequest,
      responseRequired,
    });
  }

  // Answer a response-required UI request by writing the extension_ui_response
  // frame to the child. No-op when the id is already settled (answered, timed
  // out, or cleared on exit), so double-answers and post-exit writes are safe.
  respondUi(requestId: string, response: ExtensionUiResponse): void {
    const pending = this.pendingUi.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingUi.delete(requestId);
    this.writeFrame({
      type: "extension_ui_response",
      id: requestId,
      ...response,
    });
  }

  // Fail closed: an unanswered request declines (confirm) or cancels (others)
  // so the agent never blocks forever on a silent host.
  private timeoutUi(id: string): void {
    const pending = this.pendingUi.get(id);
    if (!pending) return;
    this.pendingUi.delete(id);
    const response =
      pending.method === "confirm"
        ? { confirmed: false, timedOut: true }
        : { cancelled: true, timedOut: true };
    this.writeFrame({ type: "extension_ui_response", id, ...response });
  }

  // Drop all tracked UI requests and their timers (child exit / dispose). The
  // child is gone, so no fail-closed frame is written — we only stop the timers.
  private clearPendingUi(): void {
    for (const pending of this.pendingUi.values()) clearTimeout(pending.timer);
    this.pendingUi.clear();
  }

  private settleTermination(status: "exited" | "error", detail?: string): void {
    if (this.terminated) return;
    this.terminated = true;
    if (!this.isReady) {
      this.isReady = true;
      this.readyReject(new Error(detail ?? `session ${status}`));
    }
    this.emit("lifecycle", status, detail);
    this.rejectAllPending(new Error(detail ?? `session ${status}`));
    this.clearPendingUi();
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

// omp replies "Unknown command: <type>" for commands a given build doesn't
// implement (rpc-mode default case). Detect it so optional bridge methods can
// degrade gracefully instead of surfacing an error the host can't act on.
function isUnknownCommand(error: unknown): boolean {
  return error instanceof Error && /unknown command/i.test(error.message);
}

// A fresh empty transcript cursor — returned when get_subagent_messages yields
// no data or the omp build predates the command. A new object per call keeps
// callers from sharing (and mutating) one frozen literal.
function emptySubagentMessages(): SubagentMessagesResult {
  return {
    sessionFile: "",
    fromByte: 0,
    nextByte: 0,
    reset: false,
    entries: [],
    messages: [],
  };
}
