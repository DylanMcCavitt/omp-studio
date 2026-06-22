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
  SubagentInfo,
  ThinkingLevel,
} from "@shared/rpc";
import { augmentedEnv, ompBinary } from "../paths";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
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

  constructor(opts: {
    cwd: string;
    model?: string;
    thinkingLevel?: ThinkingLevel;
    binary?: string;
    approvalMode?: ApprovalMode;
    autoApprove?: boolean;
  }) {
    super();
    this.initialThinkingLevel = opts.thinkingLevel;

    const args = ["--mode", "rpc-ui", "--cwd", opts.cwd];
    if (opts.model) args.push("--model", opts.model);
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

  async getSubagents(): Promise<SubagentInfo[]> {
    const data = (await this.send({ type: "get_subagents" })) as
      | { subagents?: SubagentInfo[] }
      | SubagentInfo[]
      | undefined;
    if (Array.isArray(data)) return data;
    return data?.subagents ?? [];
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

  // ---- internals --------------------------------------------------------

  private send(command: OutgoingCommand): Promise<unknown> {
    if (this.disposed || this.terminated) {
      return Promise.reject(new Error("session is not running"));
    }
    const id = "req_" + this.sequence++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writeFrame({ ...command, id });
    });
  }

  private writeFrame(frame: Record<string, unknown>): void {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return;
    try {
      stdin.write(JSON.stringify(frame) + "\n");
    } catch (error) {
      console.warn("[omp-rpc] failed to write frame:", error);
    }
  }

  private wireChild(): void {
    this.child.stdout?.on("data", (chunk: Buffer) => this.onStdout(chunk));
    // Drain + surface stderr so a chatty child never deadlocks on backpressure.
    this.child.stderr?.on("data", (chunk: Buffer) =>
      console.warn("[omp-rpc] stderr:", chunk.toString("utf8").trimEnd()),
    );
    // Swallow EPIPE etc. on a closing stdin; termination is handled via exit.
    this.child.stdin?.on("error", (error) =>
      console.warn("[omp-rpc] stdin error:", error),
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
      console.warn("[omp-rpc] failed to parse frame:", line, error);
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
    if (typeof id !== "string") return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
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
