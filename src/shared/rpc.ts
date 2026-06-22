// Types mirroring the Oh My Pi (omp) `--mode rpc` protocol surface that omp-studio
// drives. These are intentionally a pragmatic subset of the full omp protocol —
// loose where the wire format is loose (frames carry arbitrary extra fields).
//
// Reference: `omp://rpc.md` and the on-disk session JSONL message format.

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface ImageContent {
  type: "image";
  /** base64-encoded image data (no data: prefix) */
  data: string;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Approval policy (rpc-ui spawn contract)
// ---------------------------------------------------------------------------

export type ApprovalMode = "always-ask" | "write" | "yolo";

export interface ApprovalPolicy {
  mode: ApprovalMode;
  autoApprove: boolean;
}

// ---------------------------------------------------------------------------
// Extension UI requests (`extension_ui_request` / `extension_ui_response`)
// ---------------------------------------------------------------------------

export type ExtensionUiMethod =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "cancel"
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle"
  | "set_editor_text"
  | "open_url";

export interface ExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method: ExtensionUiMethod;
  title?: string;
  message?: string;
  timeout?: number;
  [key: string]: unknown;
}

export type ExtensionUiResponse =
  | { confirmed: boolean }
  | { value: string }
  | { cancelled: true; timedOut?: boolean };

// ---------------------------------------------------------------------------
// Message / content-block model (matches the session JSONL `message` records)
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
}

export interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
}

export interface ImageBlock {
  type: "image";
  image?: string;
  data?: string;
  mimeType?: string;
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolCallBlock
  | ImageBlock
  | { type: string; [key: string]: unknown };

export interface UserMessage {
  role: "user";
  content: string | ContentBlock[];
  timestamp?: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  timestamp?: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  details?: Record<string, unknown>;
  isError?: boolean;
  timestamp?: number;
}

export type OmpMessage = UserMessage | AssistantMessage | ToolResultMessage;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface ModelCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Active model as reported by `get_state`. */
export interface RpcModel {
  provider: string;
  id: string;
  name?: string;
  baseUrl?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCost;
  [key: string]: unknown;
}

/** A selectable model as reported by `omp models --json`. */
export interface AvailableModel {
  provider: string;
  id: string;
  selector: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  thinking?: unknown;
  input?: string[];
  cost?: ModelCost;
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

export type TodoStatus = "pending" | "in_progress" | "completed" | "dropped";

export interface TodoTask {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoPhase {
  id: string;
  name: string;
  tasks: TodoTask[];
}

// ---------------------------------------------------------------------------
// Session state (`get_state`)
// ---------------------------------------------------------------------------

export interface ContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

export interface DumpTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface RpcState {
  model: RpcModel;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  interruptMode: "immediate" | "wait";
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  messageCount: number;
  queuedMessageCount: number;
  todoPhases: TodoPhase[];
  systemPrompt?: string[];
  dumpTools?: DumpTool[];
  contextUsage?: ContextUsage;
}

// ---------------------------------------------------------------------------
// Session stats (`get_session_stats`)
// ---------------------------------------------------------------------------

export interface SessionStats {
  /** total tokens consumed by the session */
  tokens?: number;
  /** total cost in USD */
  cost?: number;
  /** current context-window usage */
  contextUsage?: ContextUsage;
  /** permissive: extra stats fields omp may report */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Event frames (forwarded verbatim from omp stdout)
// ---------------------------------------------------------------------------

/**
 * A raw RPC frame as emitted by omp on stdout. The bridge forwards these
 * verbatim to the renderer; the chat store reduces them into render state.
 *
 * Common `type` values:
 *  - agent_start | agent_end | turn_start | turn_end
 *  - message_start | message_update | message_end
 *  - tool_execution_start | tool_execution_update | tool_execution_end
 *  - auto_compaction_start | auto_compaction_end
 *  - auto_retry_start | auto_retry_end
 *  - ttsr_triggered | todo_reminder | todo_auto_clear
 *  - subagent_lifecycle | subagent_progress | subagent_event
 */
export interface RpcFrame {
  type: string;
  [key: string]: unknown;
}

export type AssistantDeltaKind =
  | "text_delta"
  | "thinking_delta"
  | "toolcall_delta"
  | string;

export interface AssistantMessageEvent {
  type: AssistantDeltaKind;
  delta?: string;
  [key: string]: unknown;
}

export interface MessageUpdateFrame extends RpcFrame {
  type: "message_update";
  assistantMessageEvent: AssistantMessageEvent;
  message?: AssistantMessage;
}

export interface ToolExecutionFrame extends RpcFrame {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  toolCallId?: string;
  toolName?: string;
  arguments?: unknown;
  result?: { content?: ContentBlock[]; isError?: boolean };
}

export interface AgentEndFrame extends RpcFrame {
  type: "agent_end";
  messages?: OmpMessage[];
}

// ---------------------------------------------------------------------------
// Subagents
// ---------------------------------------------------------------------------

export type SubagentSubscriptionLevel = "off" | "progress" | "events";

export interface SubagentInfo {
  id: string;
  agentType?: string;
  label?: string;
  status?: string;
  sessionFile?: string;
  parentId?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Available slash commands (`available_commands_update`)
// ---------------------------------------------------------------------------

export interface AvailableCommand {
  name: string;
  description?: string;
  [key: string]: unknown;
}
