import type { ChatMessage } from "../types.ts";
import { ModelClient } from "./modelClient.ts";

export type ToolResultPreview = {
  tool: string;
  preview: string;
};

export type AnswerCriticResult = {
  passed: boolean;
  score: number;
  reason: string;
  feedback: string;
  dimensions: {
    relevance: number;
    specificity: number;
    completeness: number;
    sourceUse: number;
  };
  mode: "skipped_coding" | "heuristic" | "model" | "model_fallback";
};

export type AnswerCriticInput = {
  query: string;
  answer: unknown;
  fastIntentName?: string | null;
  requiredTools?: string[];
  toolsCalled?: string[];
  toolResults?: ToolResultPreview[];
  modelClient: ModelClient;
};

function envNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function enabled(name: string, fallback = true): boolean {
  const raw = Deno.env.get(name);
  if (raw === undefined) return fallback;
  return !["0", "false", "False", "FALSE", "no", "NO"].includes(raw);
}

function clamp01(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function truncate(value: string, max = 3500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated]`;
}

function stringifyAnswer(answer: unknown): string {
  if (answer === null || answer === undefined) return "";
  if (typeof answer === "string") return answer.trim();
  try {
    return JSON.stringify(answer, null, 2).trim();
  } catch {
    return String(answer).trim();
  }
}

function looksEmptyOrGeneric(answerText: string): boolean {
  const normalized = answerText.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "none" || normalized === "null" || normalized === "undefined") return true;

  const genericBadPhrases = [
    "not found in retrieved sources",
    "i don't have enough information",
    "i do not have enough information",
    "i cannot answer",
    "no relevant information",
    "unable to determine",
    "i'm sorry",
    "as an ai language model",
  ];

  if (answerText.trim().length < 25) return true;
  return genericBadPhrases.some((phrase) => normalized.includes(phrase));
}

function looksLikeCodingTask(query: string, fastIntentName?: string | null): boolean {
  const q = query.toLowerCase();
  if (fastIntentName === "coding") return true;
  return [
    "code", "function", "bug", "debug", "typescript", "javascript",
    "python", "linked list", "leetcode", "algorithm", "complexity",
    "reverse", "implement",
  ].some((term) => q.includes(term));
}

function looksLikeUsefulCodingAnswer(answerText: string): boolean {
  const a = answerText.toLowerCase();
  if (looksEmptyOrGeneric(answerText)) return false;
  return (
    answerText.includes("```") ||
    /\bdef\s+\w+\s*\(/.test(answerText) ||
    /\bfunction\s+\w+\s*\(/.test(answerText) ||
    /\bclass\s+\w+/.test(answerText) ||
    a.includes("time complexity") ||
    a.includes("space complexity") ||
    a.includes("while ") ||
    a.includes("return ")
  );
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {}
  return null;
}

function parseCriticJson(text: string): AnswerCriticResult | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const dimensionsRaw =
    obj.dimensions && typeof obj.dimensions === "object"
      ? (obj.dimensions as Record<string, unknown>)
      : {};
  const dimensions = {
    relevance: clamp01(dimensionsRaw.relevance, 0),
    specificity: clamp01(dimensionsRaw.specificity, 0),
    completeness: clamp01(dimensionsRaw.completeness, 0),
    sourceUse: clamp01(dimensionsRaw.sourceUse, 0),
  };
  const score =
    obj.score !== undefined
      ? clamp01(obj.score, 0)
      : (dimensions.relevance + dimensions.specificity + dimensions.completeness + dimensions.sourceUse) / 4;
  return {
    passed: Boolean(obj.passed) && score >= envNumber("RLM_ANSWER_CRITIC_THRESHOLD", 0.65),
    score,
    reason: String(obj.reason ?? "No reason provided."),
    feedback: String(obj.feedback ?? "Improve relevance, specificity, and completeness."),
    dimensions,
    mode: "model",
  };
}

function heuristicCritic(input: {
  query: string;
  answerText: string;
  requiredTools: string[];
  toolsCalled: string[];
  toolResults: ToolResultPreview[];
}): AnswerCriticResult {
  const answerText = input.answerText;
  const query = input.query.toLowerCase();

  if (looksEmptyOrGeneric(answerText)) {
    return {
      passed: false,
      score: 0.15,
      reason: "Answer is empty, too short, or generic.",
      feedback: "Produce a concrete answer. If evidence is missing, call the required tool or refine the query before final(...).",
      dimensions: { relevance: 0.2, specificity: 0.1, completeness: 0.1, sourceUse: 0.2 },
      mode: "heuristic",
    };
  }

  const missingRequiredTools = input.requiredTools.filter(
    (tool) => !input.toolsCalled.includes(tool),
  );

  if (missingRequiredTools.length > 0) {
    return {
      passed: false,
      score: 0.25,
      reason: `Missing required tools: ${missingRequiredTools.join(", ")}.`,
      feedback: `Call the missing required tool(s): ${missingRequiredTools.join(", ")}, then produce a grounded answer.`,
      dimensions: { relevance: 0.3, specificity: 0.3, completeness: 0.2, sourceUse: 0.1 },
      mode: "heuristic",
    };
  }

  const needsSources =
    input.requiredTools.includes("web_research") ||
    input.requiredTools.includes("github_repo") ||
    query.includes("latest") ||
    query.includes("news") ||
    query.includes("docs") ||
    query.includes("api") ||
    query.includes("readme");

  if (needsSources && input.toolResults.length === 0) {
    return {
      passed: false,
      score: 0.35,
      reason: "Question needs tool evidence, but no tool result preview is available.",
      feedback: "Use the appropriate tool and base the answer on tool results before calling final(...).",
      dimensions: { relevance: 0.4, specificity: 0.3, completeness: 0.3, sourceUse: 0.1 },
      mode: "heuristic",
    };
  }

  const lengthScore = Math.min(1, answerText.length / 800);
  const hasStructure = /(\n|```|\d\.|- |\*)/.test(answerText) ? 0.15 : 0;
  const hasConcreteTerms = /([A-Z][A-Za-z0-9_/-]{2,}|https?:\/\/|\/[A-Za-z0-9_.-]+|`[^`]+`)/.test(answerText) ? 0.2 : 0;

  const specificity = Math.min(1, 0.45 + lengthScore * 0.25 + hasStructure + hasConcreteTerms);
  const sourceUse = input.toolResults.length > 0 ? 0.75 : needsSources ? 0.35 : 0.65;
  const relevance = 0.7;
  const completeness = Math.min(1, 0.55 + lengthScore * 0.3);
  const score = (relevance + specificity + completeness + sourceUse) / 4;

  return {
    passed: score >= envNumber("RLM_ANSWER_CRITIC_THRESHOLD", 0.65),
    score,
    reason: "Heuristic critic completed.",
    feedback: score >= 0.65 ? "Answer looks acceptable." : "Make the answer more specific, complete, and grounded in tool results.",
    dimensions: { relevance, specificity, completeness, sourceUse },
    mode: "heuristic",
  };
}

export async function evaluateAnswerCritic(
  input: AnswerCriticInput,
): Promise<AnswerCriticResult> {
  const answerText = stringifyAnswer(input.answer);
  const requiredTools = input.requiredTools ?? [];
  const toolsCalled = input.toolsCalled ?? [];
  const toolResults = input.toolResults ?? [];

  const heuristic = heuristicCritic({
    query: input.query,
    answerText,
    requiredTools,
    toolsCalled,
    toolResults,
  });

  if (!heuristic.passed) return heuristic;

  const isCoding = looksLikeCodingTask(input.query, input.fastIntentName);

  if (isCoding && looksLikeUsefulCodingAnswer(answerText)) {
    return {
      ...heuristic,
      passed: true,
      score: Math.max(heuristic.score, 0.82),
      reason: "Skipped model critic for a simple coding answer that passed heuristic checks.",
      feedback: "Answer looks acceptable.",
      mode: "skipped_coding",
    };
  }

  if (!enabled("RLM_ANSWER_CRITIC_MODEL_ENABLED", true)) {
    return heuristic;
  }

  const toolPreview = toolResults.length
    ? toolResults.slice(-6).map((item, index) =>
        `[${index + 1}] tool=${item.tool}\n${truncate(item.preview, 1800)}`
      ).join("\n\n")
    : "No tool result previews available.";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are Scout's answer quality critic.",
        "Return JSON only.",
        "Evaluate whether the answer actually satisfies the user question.",
        "Be strict about generic answers.",
        "Do not require perfect style. Focus on usefulness.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "User question:",
        truncate(input.query, 1200),
        "",
        "Required tools:",
        requiredTools.length ? requiredTools.join(", ") : "None",
        "",
        "Tools called:",
        toolsCalled.length ? toolsCalled.join(", ") : "None",
        "",
        "Tool result previews:",
        toolPreview,
        "",
        "Candidate answer:",
        truncate(answerText, 4000),
        "",
        'Return JSON with this exact shape:',
        "{",
        '  "passed": true | false,',
        '  "score": 0.0 to 1.0,',
        '  "reason": "short reason",',
        '  "feedback": "specific instruction to improve answer if needed",',
        '  "dimensions": {',
        '    "relevance": 0.0 to 1.0,',
        '    "specificity": 0.0 to 1.0,',
        '    "completeness": 0.0 to 1.0,',
        '    "sourceUse": 0.0 to 1.0',
        "  }",
        "}",
      ].join("\n"),
    },
  ];

  try {
    const raw = await input.modelClient.chatReasoning(messages);
    const parsed = parseCriticJson(raw);
    if (!parsed) {
      return { ...heuristic, mode: "model_fallback", reason: "Model critic returned non-JSON output. Falling back to heuristic critic result." };
    }
    return parsed;
  } catch (error) {
    return { ...heuristic, mode: "model_fallback", reason: `Model critic failed; falling back to heuristic result. ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function buildCriticRetryMessage(critic: AnswerCriticResult): string {
  return [
    "ANSWER_CRITIC_REJECTED_FINAL",
    `score=${critic.score.toFixed(2)}`,
    `reason=${critic.reason}`,
    "",
    "Feedback:",
    critic.feedback,
    "",
    "Do not repeat the same weak answer.",
    "Use the available toolResults above. If evidence is weak, call another relevant tool or refine the query.",
    "Then call final(...) with a concrete, useful answer.",
  ].join("\n");
}
