export type StrategyType =
  | "comparison_table"
  | "factual_answer"
  | "document_qa"
  | "research_summary";

export type ComparisonTable = {
  type: "comparison_table";
  title: string;
  entities: string[];
  columns: string[];
  rows: Record<string, string>[];
  recommendation?: string;
};

export type FactualAnswer = {
  type: "factual_answer";
  answer: string;
  details?: string[];
};

export type DocumentQA = {
  type: "document_qa";
  answer: string;
  citations?: { text: string; source: string }[];
};

export type ResearchSummary = {
  type: "research_summary";
  summary: string;
  key_findings: string[];
};

export type StrategyOutput =
  | ComparisonTable
  | FactualAnswer
  | DocumentQA
  | ResearchSummary;

export const STRATEGY_GUIDANCE: Record<StrategyType, string> = {
  comparison_table: `Output a JSON object with type "comparison_table":
- title: string
- entities: string[] (the real products/APIs being compared)
- columns: string[] (feature/capability names)
- rows: array of objects — one per entity, each key is a column name
- recommendation: string (optional, practical advice)

Rules:
- Row keys must match column names exactly
- Use "Not found in retrieved sources" for missing data, never "varies"`,

  factual_answer: `Output a JSON object with type "factual_answer":
- answer: string (direct answer)
- details: string[] (bullet-point details if useful)

Rules:
- Be concise
- If data is missing, state "Not found in retrieved sources"`,

  document_qa: `Output a JSON object with type "document_qa":
- answer: string (answer based on the uploaded document)
- citations: array of { text: string, source: string }

Rules:
- Only use information from the uploaded documents
- Cite specific passages when possible`,

  research_summary: `Output a JSON object with type "research_summary":
- summary: string (2-3 sentence overview)
- key_findings: string[] (3-5 bullet-point findings)

Rules:
- Synthesize from all retrieved evidence
- Be specific, not generic`,
};

export function renderStrategyOutput(output: StrategyOutput): string {
  switch (output.type) {
    case "comparison_table":
      return renderComparisonTable(output);
    case "factual_answer":
      return renderFactualAnswer(output);
    case "document_qa":
      return renderDocumentQA(output);
    case "research_summary":
      return renderResearchSummary(output);
  }
}

function renderComparisonTable(output: ComparisonTable): string {
  const lines: string[] = [];

  lines.push(`## ${output.title}`);
  lines.push("");

  const header = `| Entity | ${output.columns.join(" | ")} |`;
  const separator = `| --- | ${output.columns.map(() => "---").join(" | ")} |`;
  lines.push(header);
  lines.push(separator);

  for (const row of output.rows) {
    const values = output.columns.map((col) => row[col] || "—").join(" | ");
    const entity = row["Entity"] || row["entity"] || row["name"] || "—";
    lines.push(`| ${entity} | ${values} |`);
  }

  lines.push("");

  if (output.recommendation) {
    lines.push("### Recommendation");
    lines.push("");
    lines.push(output.recommendation);
    lines.push("");
  }

  return lines.join("\n");
}

function renderFactualAnswer(output: FactualAnswer): string {
  const lines: string[] = [];

  lines.push(output.answer);
  lines.push("");

  if (output.details && output.details.length > 0) {
    for (const detail of output.details) {
      lines.push(`- ${detail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderDocumentQA(output: DocumentQA): string {
  const lines: string[] = [];

  lines.push(output.answer);
  lines.push("");

  if (output.citations && output.citations.length > 0) {
    lines.push("### Citations");
    lines.push("");
    for (const citation of output.citations) {
      lines.push(`> ${citation.text}`);
      lines.push(`> — ${citation.source}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderResearchSummary(output: ResearchSummary): string {
  const lines: string[] = [];

  lines.push(output.summary);
  lines.push("");

  if (output.key_findings && output.key_findings.length > 0) {
    lines.push("### Key Findings");
    lines.push("");
    for (const finding of output.key_findings) {
      lines.push(`- ${finding}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function parseStrategyOutput(raw: unknown): StrategyOutput | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return validateStrategyOutput(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }

  if (raw && typeof raw === "object") {
    return validateStrategyOutput(raw as Record<string, unknown>);
  }

  return null;
}

function validateStrategyOutput(
  obj: Record<string, unknown>,
): StrategyOutput | null {
  if (typeof obj.type !== "string") return null;

  switch (obj.type) {
    case "comparison_table":
      if (!Array.isArray(obj.entities)) return null;
      if (!Array.isArray(obj.columns)) return null;
      if (!Array.isArray(obj.rows)) return null;
      return obj as ComparisonTable;

    case "factual_answer":
      if (typeof obj.answer !== "string") return null;
      return obj as FactualAnswer;

    case "document_qa":
      if (typeof obj.answer !== "string") return null;
      return obj as DocumentQA;

    case "research_summary":
      if (typeof obj.summary !== "string") return null;
      return obj as ResearchSummary;

    default:
      return null;
  }
}

export function inferStrategyType(query: string): StrategyType | null {
  const q = query.toLowerCase();

  if (
    q.includes("compare") ||
    q.includes("comparison") ||
    q.includes(" vs ") ||
    q.includes("versus") ||
    q.includes("difference")
  ) {
    return "comparison_table";
  }

  if (
    q.includes("summarize") ||
    q.includes("summary") ||
    q.includes("overview") ||
    q.includes("key findings")
  ) {
    return "research_summary";
  }

  if (
    q.includes("uploaded document") ||
    q.includes("this document") ||
    q.includes("my file")
  ) {
    return "document_qa";
  }

  return null;
}
