export function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:python|py)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function ensureFinalCall(code: string): string {
  if (/\bfinal\s*\(/.test(code)) {
    return code;
  }

  return `${code.trim()}\n\nfinal(None)`;
}

export function sanitizeGeneratedPython(text: string): string {
  return ensureFinalCall(stripMarkdownCodeFence(text));
}

export function truncateText(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n...[truncated ${
    text.length - maxChars
  } chars]`;
}
