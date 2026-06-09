import type { AnswerCitation, EvidenceItem, GroundingAudit } from "./source-types.js";
import type { EvidenceWithStatus } from "./answer-renderers.js";

export function auditAnswer(
  markdown: string,
  citations: AnswerCitation[],
  rows: EvidenceWithStatus[]
): GroundingAudit {
  const issues: string[] = [];

  const sourcesIndex = markdown.indexOf("\n## Sources");
  const body = sourcesIndex >= 0 ? markdown.slice(0, sourcesIndex) : markdown;

  const rawMatches = body.match(/\[(\d+)\]/g) ?? [];
  const referencedSet = new Set(
    rawMatches.map((m) => parseInt(m.slice(1, -1), 10))
  );
  const referencedIds = [...referencedSet].sort((a, b) => a - b);

  const declaredIds = citations.map((c) => c.id).sort((a, b) => a - b);

  const missingIds = referencedIds.filter(
    (id) => !declaredIds.includes(id)
  );
  const unusedIds = declaredIds.filter(
    (id) => !referencedIds.includes(id)
  );

  if (missingIds.length > 0) {
    issues.push(
      `Citation IDs referenced but not declared: ${missingIds.join(", ")}`
    );
  }

  if (unusedIds.length > 0) {
    issues.push(
      `Citation IDs declared but not referenced in body: ${unusedIds.join(", ")}`
    );
  }

  const rowUrls = new Set(rows.map((r) => r.item.url));
  const ungroundedIds = citations
    .filter((c) => !rowUrls.has(c.url))
    .map((c) => c.id);
  if (ungroundedIds.length > 0) {
    issues.push(
      `Citations do not map back to any kept evidence row: ${ungroundedIds.join(", ")}`
    );
  }

  if (referencedIds.length === 0 && rows.length > 0) {
    issues.push("Answer has evidence rows but no inline citation markers found in body.");
  }

  const status: GroundingAudit["status"] =
    issues.length === 0 ? "pass" : "fail";

  return {
    status,
    citationIdsReferenced: referencedIds,
    citationIdsDeclared: declaredIds,
    missingCitationIds: missingIds,
    unusedCitationIds: unusedIds,
    unsupportedCitationIds: [],
    groundedClaimCount: referencedIds.length,
    issueCount: issues.length,
    issues,
  };
}
