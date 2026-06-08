import type { EvidencePack, AnswerMode, SynthesizedAnswer } from "./source-types.js";
import { detectAnswerMode } from "./answer-mode.js";
import {
  groupEvidenceForAnswer,
  buildNoEvidenceAnswer,
  buildCitationMap,
  confidenceForAnswer,
  renderMarkdownForMode,
} from "./answer-renderers.js";

export function synthesizeAnswerFromEvidencePack(input: {
  query: string;
  evidencePack: EvidencePack;
  maxClaims?: number;
  mode?: AnswerMode;
}): SynthesizedAnswer {
  const mode = input.mode ?? detectAnswerMode(input.query, input.evidencePack.useCase);
  const maxClaims = input.maxClaims ?? (mode === "comparison" ? 14 : 10);

  const rows = groupEvidenceForAnswer({
    query: input.query,
    evidencePack: input.evidencePack,
    maxClaims,
  });

  if (rows.length === 0) {
    return buildNoEvidenceAnswer(input.evidencePack, mode);
  }

  const supportedEvidenceCount = rows.filter((row) => row.status === "supported").length;
  const weakEvidenceCount = rows.filter((row) => row.status === "weak").length;
  const status: SynthesizedAnswer["status"] =
    supportedEvidenceCount > 0 ? "answered" : "partial";

  const { citationBySource, citationIdBySource } = buildCitationMap(rows.map((row) => row.item));
  const citations = [...citationBySource.values()];

  const markdown = renderMarkdownForMode({
    mode,
    query: input.query,
    rows,
    citations,
    citationIdBySource,
    status,
  });

  return {
    status,
    mode,
    markdown,
    citations,
    usedEvidenceCount: rows.length,
    supportedEvidenceCount,
    weakEvidenceCount,
    omittedUnsupportedCount: input.evidencePack.coverage.unsupportedClaimCount,
    confidence: confidenceForAnswer(rows),
  };
}
