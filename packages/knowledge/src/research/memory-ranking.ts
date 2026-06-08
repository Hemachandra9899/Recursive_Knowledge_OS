import type { ResourceCandidate } from "./source-types.js";
import type { ScoutMemory } from "../memory/memory-types.js";

export type ResourceMemoryHint = Pick<
  ScoutMemory,
  "kind" | "text" | "entities" | "sourceUrls" | "confidence" | "metadata"
>;

export type ResourceMemoryScore = {
  scoreDelta: number;
  matchedBy: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeUrl(url?: string | null): string {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    parsed.hash = "";

    const pathname = parsed.pathname.replace(/\/$/, "");
    return `${parsed.origin}${pathname}${parsed.search}`.toLowerCase();
  } catch {
    return String(url).toLowerCase().replace(/\/$/, "");
  }
}

function hostname(url?: string | null): string {
  if (!url) return "";

  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function queryOrResourceMentionsEntity(input: {
  query: string;
  resource: ResourceCandidate;
  entity: string;
}): boolean {
  const entity = input.entity.toLowerCase();
  if (!entity || entity.length < 2) return false;

  const haystack = [
    input.query,
    input.resource.title,
    input.resource.product,
    input.resource.domain,
    ...(input.resource.topics ?? []),
    ...(input.resource.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(entity);
}

function memoryUrlMatchesResource(memoryUrl: string, resourceUrl: string): boolean {
  const left = normalizeUrl(memoryUrl);
  const right = normalizeUrl(resourceUrl);

  if (!left || !right) return false;
  if (left === right) return true;

  const leftHost = hostname(memoryUrl);
  const rightHost = hostname(resourceUrl);

  return Boolean(leftHost && rightHost && hostMatches(leftHost, rightHost));
}

export function scoreResourceWithMemory(input: {
  query: string;
  resource: ResourceCandidate;
  memoryHints?: ResourceMemoryHint[];
}): ResourceMemoryScore {
  const hints = input.memoryHints ?? [];
  if (hints.length === 0) {
    return { scoreDelta: 0, matchedBy: [] };
  }

  let scoreDelta = 0;
  const matchedBy: string[] = [];
  const resourceHost = hostname(input.resource.url);

  for (const memory of hints) {
    const confidence = clamp(memory.confidence ?? 0.7, 0.1, 1);
    const sourceUrls = memory.sourceUrls ?? [];

    const hasExactOrHostMatch = sourceUrls.some((sourceUrl) =>
      memoryUrlMatchesResource(sourceUrl, input.resource.url)
    );

    const hasSameHost = sourceUrls.some((sourceUrl) =>
      hostMatches(hostname(sourceUrl), resourceHost)
    );

    if (memory.kind === "source_quality") {
      if (hasExactOrHostMatch) {
        const delta = Math.round(18 * confidence);
        scoreDelta += delta;
        matchedBy.push(`memory:source_quality:+${delta}`);
      } else if (hasSameHost) {
        const delta = Math.round(8 * confidence);
        scoreDelta += delta;
        matchedBy.push(`memory:source_quality_host:+${delta}`);
      }
    }

    if (memory.kind === "source_failure") {
      if (hasExactOrHostMatch) {
        const delta = Math.round(30 * confidence);
        scoreDelta -= delta;
        matchedBy.push(`memory:source_failure:-${delta}`);
      } else if (hasSameHost) {
        const delta = Math.round(10 * confidence);
        scoreDelta -= delta;
        matchedBy.push(`memory:source_failure_host:-${delta}`);
      }
    }

    if (memory.kind === "durable_fact") {
      const matchedEntity = (memory.entities ?? []).find((entity) =>
        queryOrResourceMentionsEntity({
          query: input.query,
          resource: input.resource,
          entity,
        })
      );

      if (matchedEntity) {
        const delta = Math.round(5 * confidence);
        scoreDelta += delta;
        matchedBy.push(`memory:durable_fact_entity:${matchedEntity}:+${delta}`);
      }
    }
  }

  return {
    scoreDelta,
    matchedBy,
  };
}
