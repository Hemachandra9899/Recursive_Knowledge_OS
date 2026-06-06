export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ExecuteRequest = {
  runId?: string;
  projectId?: string;
  query: string;
  maxSteps?: number;
  depth?: number;
  maxDepth?: number;
};

export type ModelChatResponse = {
  model: string;
  mode: string;
  reasoning?: string;
  content: string;
};

export type SubAgentHandler = (
  prompt: string,
  context?: unknown
) => Promise<unknown>;

export type ToolHandler = (
  name: string,
  args: Record<string, unknown>
) => Promise<unknown>;

export type PythonExecutionResult = {
  stdout: string;
  final: unknown;
  finalCalled: boolean;
  error: string | null;
};

export type RlmStep = {
  stepIndex: number;
  generatedCode: string;
  stdout: string;
  final: unknown;
  finalCalled: boolean;
  error: string | null;
};

export type StrategyMethod = {
  name: string;
  score: number;
  risk: string;
  reason: string;
};

export type AnswerStrategy = {
  enabled: boolean;
  recommendedMethod: string;
  bestMethod: string;
  shouldUseTools: boolean;
  methods: StrategyMethod[];
  reason: string;
};

export type AnswerSource = {
  title: string | null;
  url: string | null;
  score?: number | null;
  retrieval?: string | null;
};

export type SynthesizedAnswer = {
  answer: string;
  sources: AnswerSource[];
};

export type RlmRunResult = {
  status: "completed" | "max_steps_reached" | "failed";
  runId?: string;
  projectId?: string;
  query: string;
  depth: number;
  maxDepth: number;
  final: unknown;
  sources?: AnswerSource[];
  steps: RlmStep[];
  error: string | null;
};
