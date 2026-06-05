export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ExecuteRequest = {
  runId?: string;
  projectId?: string;
  query: string;
  maxSteps?: number;
};

export type ModelChatResponse = {
  model: string;
  mode: string;
  reasoning?: string;
  content: string;
};

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

export type RlmRunResult = {
  status: "completed" | "max_steps_reached" | "failed";
  runId?: string;
  projectId?: string;
  query: string;
  final: unknown;
  steps: RlmStep[];
  error: string | null;
};
