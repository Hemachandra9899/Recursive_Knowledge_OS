export type FaithfulnessVerdict =
  | "accept"
  | "retry"
  | "low_confidence";

export type FaithfulnessCriticInput = {
  query: string;
  answerMarkdown: string;
  evidencePack?: any;
  toolPreviews?: Array<{
    tool: string;
    preview: string;
    sources?: Array<{ title?: string | null; url?: string | null }>;
  }>;
  threshold?: number;
};

export type FaithfulnessCriticResult = {
  passed: boolean;
  score: number;
  supportedRatio: number;
  relevanceRatio: number;
  unsupportedClaims: string[];
  weakClaims: string[];
  missingAnchors: string[];
  verdict: FaithfulnessVerdict;
  fixHint: string;
  mode: "evidence_pack" | "tool_preview" | "heuristic";
};

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function extractQueryAnchors(query: string): string[] {
  const q = query.toLowerCase();
  const anchors: string[] = [];

  const known = [
    "WhatsApp",
    "Google Ads API",
    "Google Ads",
    "Meta Marketing API",
    "Meta",
    "OAuth",
    "OAuth 2.0",
    "access token",
    "developer token",
    "rate limit",
    "rate limits",
    "authentication",
    "OpenAI",
    "Scout",
  ];

  for (const item of known) {
    if (q.includes(item.toLowerCase())) anchors.push(item);
  }

  const capitalized =
    query.match(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/g) ?? [];

  for (const phrase of capitalized) {
    if (
      phrase.length >= 4 &&
      !["What", "How", "Compare", "Latest", "Given"].includes(phrase)
    ) {
      anchors.push(phrase);
    }
  }

  return unique(anchors).slice(0, 8);
}

function computeRelevanceRatio(answer: string, query: string) {
  const anchors = extractQueryAnchors(query);

  if (anchors.length === 0) {
    return {
      ratio: 1,
      missingAnchors: [],
      anchors,
    };
  }

  const answerNorm = normalize(answer);

  const missingAnchors = anchors.filter(
    (anchor) => !answerNorm.includes(normalize(anchor)),
  );

  return {
    ratio: (anchors.length - missingAnchors.length) / anchors.length,
    missingAnchors,
    anchors,
  };
}

function hasEnoughAnswer(answer: string): boolean {
  const text = normalize(answer);

  return (
    text.length > 30 &&
    text !== "none" &&
    text !== "null" &&
    !text.includes("this operation was aborted")
  );
}

export function evaluateFaithfulness(
  input: FaithfulnessCriticInput,
): FaithfulnessCriticResult {
  const threshold = input.threshold ?? 0.7;
  const answer = input.answerMarkdown ?? "";

  if (!hasEnoughAnswer(answer)) {
    return {
      passed: false,
      score: 0,
      supportedRatio: 0,
      relevanceRatio: 0,
      unsupportedClaims: [],
      weakClaims: [],
      missingAnchors: extractQueryAnchors(input.query),
      verdict: "retry",
      fixHint: "Answer is empty, aborted, or too generic.",
      mode: "heuristic",
    };
  }

  const relevance = computeRelevanceRatio(answer, input.query);

  const coverage = input.evidencePack?.coverage;
  const citationVerification = safeArray(
    input.evidencePack?.citationVerification,
  );

  if (coverage || citationVerification.length > 0) {
    const supported =
      Number(coverage?.supportedClaimCount ?? 0) ||
      citationVerification.filter((item) => item.status === "supported").length;

    const weak =
      Number(coverage?.weakClaimCount ?? 0) ||
      citationVerification.filter((item) => item.status === "weak").length;

    const unsupported =
      Number(coverage?.unsupportedClaimCount ?? 0) ||
      citationVerification.filter((item) => item.status === "unsupported").length;

    const total =
      Number(coverage?.claimCount ?? 0) ||
      supported + weak + unsupported;

    const supportedRatio = total > 0 ? supported / total : 0;

    const unsupportedClaims = citationVerification
      .filter((item) => item.status === "unsupported")
      .map((item) => String(item.claim ?? ""))
      .filter(Boolean);

    const weakClaims = citationVerification
      .filter((item) => item.status === "weak")
      .map((item) => String(item.claim ?? ""))
      .filter(Boolean);

    const passed =
      supportedRatio >= threshold &&
      relevance.ratio >= 0.6 &&
      unsupportedClaims.length === 0;

    return {
      passed,
      score: Math.min(supportedRatio, relevance.ratio),
      supportedRatio,
      relevanceRatio: relevance.ratio,
      unsupportedClaims,
      weakClaims,
      missingAnchors: relevance.missingAnchors,
      verdict: passed
        ? "accept"
        : relevance.ratio < 0.6
          ? "retry"
          : "low_confidence",
      fixHint: passed
        ? ""
        : relevance.ratio < 0.6
          ? `Answer misses query anchors: ${relevance.missingAnchors.join(", ")}. Retry with a focused query and require these anchors in the answer.`
          : "Evidence coverage is weak or contains unsupported claims.",
      mode: "evidence_pack",
    };
  }

  const previews = safeArray(input.toolPreviews);
  if (previews.length > 0) {
    const supportedRatio = relevance.ratio;
    const passed = supportedRatio >= 0.5;

    return {
      passed,
      score: supportedRatio,
      supportedRatio,
      relevanceRatio: relevance.ratio,
      unsupportedClaims: [],
      weakClaims: [],
      missingAnchors: relevance.missingAnchors,
      verdict: passed ? "accept" : "low_confidence",
      fixHint: passed
        ? ""
        : `Answer is not sufficiently tied to query anchors: ${relevance.missingAnchors.join(", ")}`,
      mode: "tool_preview",
    };
  }

  return {
    passed: relevance.ratio >= 0.5,
    score: relevance.ratio,
    supportedRatio: relevance.ratio,
    relevanceRatio: relevance.ratio,
    unsupportedClaims: [],
    weakClaims: [],
    missingAnchors: relevance.missingAnchors,
    verdict: relevance.ratio >= 0.5 ? "accept" : "low_confidence",
    fixHint:
      relevance.ratio >= 0.5
        ? ""
        : `Answer misses query anchors: ${relevance.missingAnchors.join(", ")}`,
    mode: "heuristic",
  };
}
