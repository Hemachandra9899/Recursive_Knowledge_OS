import type { SourceTier } from "../source-types.js";
import { inferTierFromUrl } from "../source-ranker.js";

export function clampLimit(limit: number, max: number): number {
  return Math.max(1, Math.min(Math.floor(limit || 1), max));
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
  } catch {
    return url;
  }
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function pickPublishedAt(row: any): string | undefined {
  return pickString(
    row?.publishedAt,
    row?.published_at,
    row?.date,
    row?.updatedAt,
    row?.updated_at,
    row?.age,
    row?.metadata?.publishedAt,
    row?.metadata?.published_at,
    row?.metadata?.date,
    row?.metadata?.updatedAt,
    row?.metadata?.updated_at
  );
}

export function titleFromUrl(url: string): string {
  const host = hostFromUrl(url);
  return host || url;
}

export function tierForUrl(url: string, fallback?: SourceTier): SourceTier {
  return fallback ?? inferTierFromUrl(url);
}
