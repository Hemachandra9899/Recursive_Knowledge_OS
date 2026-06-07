export type TextChunk = {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
};

export function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function chunkText(
  input: string,
  options?: {
    chunkSize?: number;
    overlap?: number;
  }
): TextChunk[] {
  const text = cleanMarkdown(input);
  const chunkSize = options?.chunkSize ?? 1800;
  const overlap = options?.overlap ?? 200;

  if (!text) return [];

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(start + chunkSize, text.length);
    let end = hardEnd;

    const paragraphBreak = text.lastIndexOf("\n\n", hardEnd);
    if (paragraphBreak > start + Math.floor(chunkSize * 0.55)) {
      end = paragraphBreak;
    }

    const chunk = text.slice(start, end).trim();

    if (chunk) {
      chunks.push({
        index: chunks.length,
        text: chunk,
        startChar: start,
        endChar: end,
      });
    }

    if (end >= text.length) break;

    start = Math.max(0, end - overlap);
  }

  return chunks;
}

export function preview(text: string, maxChars = 1200): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

import { createHash } from "node:crypto";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
