export type ContentQualityStatus = "accept" | "reject";

export type ContentQuality = {
  status: ContentQualityStatus;
  score: number;
  wordCount: number;
  charCount: number;
  uniqueWordRatio: number;
  linkLikeLineRatio: number;
  headingCount: number;
  codeBlockCount: number;
  flags: string[];
};

const BLOCKED_PATTERNS = [
  /\baccess denied\b/i,
  /\bblocked\b/i,
  /\b403 forbidden\b/i,
  /\b404 not found\b/i,
  /\bsign in\b/i,
  /\blog in\b/i,
  /\bplease enable javascript\b/i,
  /\bthis page requires javascript\b/i,
];

const MIN_WORD_COUNT = 30;
const MIN_CHAR_COUNT = 200;
const MAX_LINK_LIKE_RATIO = 0.45;
const MIN_UNIQUE_WORD_RATIO = 0.15;

export function scorePageQuality(markdown: string): ContentQuality {
  const wordCount = countWords(markdown);
  const charCount = markdown.length;
  const uniqueWordRatio = computeUniqueWordRatio(markdown);
  const linkLikeLineRatio = computeLinkLikeLineRatio(markdown);
  const headingCount = (markdown.match(/^#{1,6}\s/gm) ?? []).length;
  const codeBlockCount = (markdown.match(/```/g) ?? []).length / 2;
  const flags: string[] = [];

  const checks: Array<{ score: number }> = [];

  if (wordCount < MIN_WORD_COUNT) {
    flags.push(`low_word_count:${wordCount}`);
  } else {
    checks.push({ score: Math.min(25, Math.round(wordCount * 0.08)) });
  }

  if (charCount < MIN_CHAR_COUNT) {
    flags.push(`low_char_count:${charCount}`);
  } else if (charCount > 500) {
    checks.push({ score: Math.min(10, Math.round(charCount * 0.005)) });
  }

  if (uniqueWordRatio < MIN_UNIQUE_WORD_RATIO) {
    flags.push(`low_unique_word_ratio:${uniqueWordRatio.toFixed(2)}`);
  } else if (uniqueWordRatio > 0.3) {
    checks.push({ score: Math.min(15, Math.round(uniqueWordRatio * 30)) });
  }

  if (linkLikeLineRatio > MAX_LINK_LIKE_RATIO) {
    flags.push(`high_nav_ratio:${linkLikeLineRatio.toFixed(2)}`);
  } else {
    checks.push({ score: Math.min(10, Math.round((1 - linkLikeLineRatio) * 15)) });
  }

  if (headingCount > 0) {
    checks.push({ score: Math.min(10, headingCount * 3) });
  }

  if (codeBlockCount > 0) {
    checks.push({ score: Math.min(8, codeBlockCount * 4) });
  }

  const blockedMatch = BLOCKED_PATTERNS.some((p) => p.test(markdown));
  if (blockedMatch) {
    flags.push("blocked_content");
  }

  const score = Math.min(100, checks.reduce((sum, c) => sum + c.score, 0));
  const reject =
    flags.length > 0 &&
    (wordCount < MIN_WORD_COUNT ||
      charCount < MIN_CHAR_COUNT ||
      linkLikeLineRatio > MAX_LINK_LIKE_RATIO ||
      uniqueWordRatio < MIN_UNIQUE_WORD_RATIO ||
      blockedMatch);

  return {
    status: reject ? "reject" : score >= 20 ? "accept" : "reject",
    score,
    wordCount,
    charCount,
    uniqueWordRatio,
    linkLikeLineRatio,
    headingCount,
    codeBlockCount,
    flags,
  };
}

function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((w) => w.trim().length > 0 && !/^[#\-\*\|\[\]\(\)>]+$/.test(w.trim()))
    .length;
}

function computeUniqueWordRatio(text: string): number {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  return new Set(words).size / words.length;
}

function computeLinkLikeLineRatio(text: string): number {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 0;
  const linkLines = lines.filter(
    (l) => /^https?:\/\//i.test(l.trim()) || /^\[.*?\]\(/.test(l.trim()) || /^\|.*\|$/.test(l.trim())
  ).length;
  return linkLines / lines.length;
}
