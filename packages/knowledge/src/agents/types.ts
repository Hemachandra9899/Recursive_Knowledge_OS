export type ScoutAgentName =
  | "coordinator"
  | "search_planner"
  | "crawler"
  | "evidence"
  | "memory"
  | "answer"
  | "graph"
  | "verifier";

export type AgentContext = {
  projectId: string;
  userId?: string;
  runId?: string;
  query: string;
  now?: Date;
  metadata?: Record<string, unknown>;
};

export type AgentResult<T> = {
  agent: ScoutAgentName;
  status: "ok" | "skipped" | "error";
  output?: T;
  error?: string;
  metadata?: Record<string, unknown>;
};

export function okAgentResult<T>(
  agent: ScoutAgentName,
  output: T,
  metadata?: Record<string, unknown>
): AgentResult<T> {
  return { agent, status: "ok", output, metadata };
}
