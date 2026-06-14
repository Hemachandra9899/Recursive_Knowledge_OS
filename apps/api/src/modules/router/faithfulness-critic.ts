export type FaithfulnessCriticInput = {
  query: string;
  answerMarkdown: string;
  evidencePack?: any;
  toolPreviews?: Array<{
    tool: string;
    preview: string;
    sources?: Array<{ title?: string; url?: string }>;
  }>;
  threshold?: number;
};

export type FaithfulnessCriticResult = {
  passed: boolean;
  score: number;
  supportedRatio: number;
  unsupportedClaims: string[];
  weakClaims: string[];
  verdict: "accept" | "retry" | "low_confidence";
  fixHint: string;
  mode: "evidence_pack" | "tool_preview" | "heuristic";
};

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function hasAnswer(answer: string): boolean {
  const text = answer.trim().toLowerCase();

  return (
    text.length > 20 &&
    text !== "none" &&
    text !== "null" &&
    !text.includes("i don't know") &&
    !text.includes("no answer")
  );
}

export function evaluateFaithfulness(
  input: FaithfulnessCriticInput,
): FaithfulnessCriticResult {
  const threshold = input.threshold ?? 0.7;
  const answer = input.answerMarkdown ?? "";

  if (!hasAnswer(answer)) {
    return {
      passed: false,
      score: 0,
      supportedRatio: 0,
      unsupportedClaims: [],
      weakClaims: [],
      verdict: "retry",
      fixHint: "Answer is empty or too generic.",
      mode: "heuristic",
    };
  }

  const coverage = input.evidencePack?.coverage;
  const citationVerification = safeArray(input.evidencePack?.citationVerification);

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

    const passed = supportedRatio >= threshold && unsupportedClaims.length === 0;

    return {
      passed,
      score: supportedRatio,
      supportedRatio,
      unsupportedClaims,
      weakClaims,
      verdict: passed ? "accept" : "low_confidence",
      fixHint: passed
        ? ""
        : "Evidence coverage is weak or contains unsupported claims. Return a lower-confidence answer or retrieve stronger evidence.",
      mode: "evidence_pack",
    };
  }

  const previews = safeArray(input.toolPreviews);
  if (previews.length > 0) {
    const answerLower = answer.toLowerCase();
    const previewText = previews.map((p) => String(p.preview ?? "")).join("\n").toLowerCase();

    const queryTerms = input.query
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length >= 4)
      .slice(0, 8);

    const hits = queryTerms.filter(
      (term) => answerLower.includes(term) || previewText.includes(term),
    );

    const supportedRatio = queryTerms.length
      ? hits.length / queryTerms.length
      : 0.5;

    const passed = supportedRatio >= 0.5;

    return {
      passed,
      score: supportedRatio,
      supportedRatio,
      unsupportedClaims: [],
      weakClaims: [],
      verdict: passed ? "accept" : "low_confidence",
      fixHint: passed
        ? ""
        : "Answer does not appear sufficiently tied to tool previews.",
      mode: "tool_preview",
    };
  }

  return {
    passed: true,
    score: 0.5,
    supportedRatio: 0.5,
    unsupportedClaims: [],
    weakClaims: [],
    verdict: "accept",
    fixHint: "",
    mode: "heuristic",
  };
}
