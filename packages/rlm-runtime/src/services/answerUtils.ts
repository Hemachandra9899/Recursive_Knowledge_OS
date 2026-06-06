import type { AnswerSource, RlmStep } from "../types.ts";

export function isGenericOrRawAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return true;

  if (Array.isArray(value)) return true;

  if (typeof value === "object") return true;

  if (typeof value !== "string") return false;

  const text = value.trim();
  const lower = text.toLowerCase();

  if (!text) return true;

  if (
    [
      "done",
      "completed",
      "all questions have been answered",
      "all questions have been answered.",
      "task complete",
      "the task is complete.",
    ].includes(lower)
  ) {
    return true;
  }

  const rawMarkers = [
    "chunkId",
    "documentId",
    "sourceUrl",
    "retrieval",
    "metadata",
    "[{",
    "{'",
    "'chunkId'",
    "'sourceUrl'",
  ];

  return rawMarkers.some((marker) => text.includes(marker));
}

export function readable(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sourceKey(source: AnswerSource): string {
  return `${source.title || ""}::${source.url || ""}`;
}

function pushSource(sources: AnswerSource[], source: AnswerSource) {
  if (!source.url && !source.title) return;

  const exists = sources.some((item) => sourceKey(item) === sourceKey(source));
  if (!exists) sources.push(source);
}

function visit(value: unknown, sources: AnswerSource[]) {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const item of value) visit(item, sources);
    return;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    const title =
      typeof obj.title === "string"
        ? obj.title
        : typeof obj.sourceTitle === "string"
          ? obj.sourceTitle
          : null;

    const url =
      typeof obj.sourceUrl === "string"
        ? obj.sourceUrl
        : typeof obj.url === "string"
          ? obj.url
          : null;

    if (title || url) {
      pushSource(sources, {
        title,
        url,
        score: typeof obj.score === "number" ? obj.score : null,
        retrieval: typeof obj.retrieval === "string" ? obj.retrieval : null,
      });
    }

    for (const child of Object.values(obj)) visit(child, sources);
  }
}

export function extractSources(final: unknown, steps: RlmStep[]): AnswerSource[] {
  const sources: AnswerSource[] = [];

  visit(final, sources);

  for (const step of steps) {
    visit(step.final, sources);

    if (step.stdout) {
      const urls = step.stdout.match(/https?:\/\/[^\s'",}]+/g) || [];
      for (const url of urls) {
        pushSource(sources, {
          title: null,
          url,
          score: null,
          retrieval: null,
        });
      }
    }
  }

  return sources.slice(0, 8);
}