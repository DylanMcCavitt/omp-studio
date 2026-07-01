import type { AgentInfo } from "@shared/domain";

export const AGENT_DRAG_MIME = "application/x-omp-studio-agent+json";

export interface AgentDragPayload {
  name: string;
  source: AgentInfo["source"];
  description?: string;
  model?: string;
  spawns?: string;
  readOnly?: boolean;
}

export function toAgentDragPayload(agent: AgentInfo): AgentDragPayload {
  return {
    name: agent.name,
    source: agent.source,
    description: agent.description,
    model: agent.model,
    spawns: agent.spawns,
    readOnly: agent.readOnly,
  };
}

export function serializeAgentDrag(agent: AgentInfo): string {
  return JSON.stringify(toAgentDragPayload(agent));
}

export function parseAgentDrag(value: string): AgentDragPayload | null {
  try {
    const raw = JSON.parse(value) as Partial<AgentDragPayload>;
    if (typeof raw.name !== "string" || raw.name.trim() === "") return null;
    if (
      raw.source !== "builtin" &&
      raw.source !== "user" &&
      raw.source !== "project"
    ) {
      return null;
    }
    return {
      name: raw.name,
      source: raw.source,
      description:
        typeof raw.description === "string" ? raw.description : undefined,
      model: typeof raw.model === "string" ? raw.model : undefined,
      spawns: typeof raw.spawns === "string" ? raw.spawns : undefined,
      readOnly: raw.readOnly === true ? true : undefined,
    };
  } catch {
    return null;
  }
}

export function agentSteeringText(agent: AgentDragPayload): string {
  const name = agent.name.trim();
  const source = agent.source;
  const spawns = agent.spawns?.trim();
  if (spawns) {
    return `Use the \`${name}\` lead agent from ${source} as a workflow. It declares these subagents: ${spawns}. Keep the plan focused on this chat and ask before taking any HITL action.`;
  }
  return `Use the \`${name}\` agent from ${source} for this next response. Keep the work focused on this chat and ask before taking any HITL action.`;
}
