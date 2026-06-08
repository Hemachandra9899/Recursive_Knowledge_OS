import { Prisma } from "@prisma/client";
import { prisma } from "@rlm-forge/database/prisma.js";
import type {
  ScoutMemory,
  ScoutMemoryDraft,
  ScoutMemorySearchInput,
} from "./memory-types.js";
import type { EvidenceItem, EvidencePack } from "../research/source-types.js";

type CrawlFailureForMemory = {
  title?: string;
  url?: string;
  reason: string;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizeForKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function memoryDraftKey(draft: ScoutMemoryDraft): string {
  return [
    draft.projectId,
    draft.userId ?? "",
    draft.scope,
    draft.kind,
    normalizeForKey(draft.text),
    unique(draft.sourceUrls ?? []).sort().join("|"),
  ].join("::");
}

function dedupeDrafts(drafts: ScoutMemoryDraft[]): ScoutMemoryDraft[] {
  const seen = new Set<string>();
  const deduped: ScoutMemoryDraft[] = [];

  for (const draft of drafts) {
    const key = memoryDraftKey(draft);
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push({
      ...draft,
      entities: unique(draft.entities ?? []),
      sourceUrls: unique(draft.sourceUrls ?? []),
    });
  }

  return deduped;
}

function toScoutMemory(row: any): ScoutMemory {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    scope: row.scope,
    kind: row.kind,
    text: row.text,
    entities: asStringArray(row.entities),
    sourceUrls: asStringArray(row.sourceUrls),
    confidence: row.confidence ?? 0.7,
    eventTime: row.eventTime,
    metadata: asRecord(row.metadata),
    createdAt: row.createdAt,
  };
}

function scoreMemory(query: string, memory: ScoutMemory): number {
  const q = query.toLowerCase();
  const text = memory.text.toLowerCase();

  const entityScore = memory.entities.some((entity) =>
    q.includes(entity.toLowerCase())
  )
    ? 25
    : 0;

  const keywordScore = q
    .split(/\s+/)
    .filter((token) => token.length > 3 && text.includes(token)).length;

  const recencyScore = Math.max(
    0,
    10 -
      Math.floor(
        (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
  );

  const kindBoost =
    memory.kind === "durable_fact"
      ? 12
      : memory.kind === "source_quality"
        ? 8
        : memory.kind === "source_failure"
          ? 6
          : 0;

  return memory.confidence * 50 + entityScore + keywordScore * 3 + recencyScore + kindBoost;
}

function tierConfidence(item: EvidenceItem): number {
  if (item.tier === "official_docs" || item.tier === "trusted_docs") return 0.9;
  if (item.tier === "reference_examples") return 0.72;
  if (item.tier === "community") return 0.6;
  return 0.65;
}

export class MemoryManager {
  async addMany(drafts: ScoutMemoryDraft[]): Promise<number> {
    const deduped = dedupeDrafts(drafts);
    if (deduped.length === 0) return 0;

    await prisma.memory.createMany({
      data: deduped.map((draft) => ({
        projectId: draft.projectId,
        userId: draft.userId,
        scope: draft.scope,
        kind: draft.kind,
        text: draft.text,
        entities: (draft.entities ?? []) as unknown as Prisma.InputJsonValue,
        sourceUrls: (draft.sourceUrls ?? []) as unknown as Prisma.InputJsonValue,
        confidence: draft.confidence ?? 0.7,
        eventTime: draft.eventTime,
        metadata: (draft.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      })),
    });

    return deduped.length;
  }

  async search(input: ScoutMemorySearchInput): Promise<ScoutMemory[]> {
    const limit = input.limit ?? 8;
    const rows = await prisma.memory.findMany({
      where: {
        projectId: input.projectId,
        ...(input.userId
          ? {
              OR: [{ userId: input.userId }, { userId: null }],
            }
          : {}),
        ...(input.scopes?.length ? { scope: { in: input.scopes } } : {}),
        ...(input.kinds?.length ? { kind: { in: input.kinds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(limit * 5, 25),
    });

    return rows
      .map(toScoutMemory)
      .sort((a, b) => scoreMemory(input.query, b) - scoreMemory(input.query, a))
      .slice(0, limit);
  }

  buildSourceMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    const byUrl = new Map<
      string,
      {
        item: EvidenceItem;
        claimCount: number;
        supportedClaimCount: number;
      }
    >();

    input.evidencePack.evidence.forEach((item, index) => {
      if (!item.url) return;

      const existing = byUrl.get(item.url);
      const verification = input.evidencePack.citationVerification[index];
      const supported = verification?.status === "supported";

      if (!existing) {
        byUrl.set(item.url, {
          item,
          claimCount: 1,
          supportedClaimCount: supported ? 1 : 0,
        });
      } else {
        existing.claimCount += 1;
        if (supported) existing.supportedClaimCount += 1;

        if (tierConfidence(item) > tierConfidence(existing.item)) {
          existing.item = item;
        }
      }
    });

    const drafts: ScoutMemoryDraft[] = [];

    for (const [url, aggregate] of byUrl) {
      const item = aggregate.item;

      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "source",
        kind: "source_quality",
        text: `Source "${item.title}" was useful for query "${input.evidencePack.query}" with ${aggregate.claimCount} extracted claims and ${aggregate.supportedClaimCount} supported claims.`,
        sourceUrls: [url],
        entities: [item.product, item.domain, ...item.entities].filter(Boolean) as string[],
        confidence: Math.min(
          0.95,
          tierConfidence(item) + Math.min(aggregate.supportedClaimCount, 5) * 0.01
        ),
        metadata: {
          title: item.title,
          tier: item.tier,
          reason: item.reason,
          query: input.evidencePack.query,
          claimCount: aggregate.claimCount,
          supportedClaimCount: aggregate.supportedClaimCount,
        },
      });
    }

    return drafts;
  }

  buildFailureMemoriesFromCrawlFailures(input: {
    projectId: string;
    userId?: string;
    query: string;
    failedCrawls: CrawlFailureForMemory[];
  }): ScoutMemoryDraft[] {
    return input.failedCrawls
      .filter((failure) => Boolean(failure.url))
      .map((failure) => ({
        projectId: input.projectId,
        userId: input.userId,
        scope: "source",
        kind: "source_failure",
        text: `Source "${failure.url}" failed during crawl for query "${input.query}" because: ${failure.reason}`,
        sourceUrls: [failure.url as string],
        confidence: 0.8,
        metadata: {
          title: failure.title,
          query: input.query,
          reason: failure.reason,
        },
      }));
  }

  buildDurableFactMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    const drafts: ScoutMemoryDraft[] = [];

    input.evidencePack.evidence.forEach((item, index) => {
      const verification = input.evidencePack.citationVerification[index];
      if (verification?.status !== "supported") return;

      const sourceUrls =
        verification.supportingUrls.length > 0
          ? verification.supportingUrls
          : [item.url];

      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "project",
        kind: "durable_fact",
        text: item.claim,
        sourceUrls,
        entities: item.entities,
        confidence: item.confidence,
        metadata: {
          title: item.title,
          section: item.section,
          tier: item.tier,
          quote: item.quote,
          query: input.evidencePack.query,
          reason: verification.reason,
        },
      });
    });

    return dedupeDrafts(drafts);
  }
}
