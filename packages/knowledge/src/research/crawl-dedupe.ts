const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "msclkid",
  "ref",
  "source",
]);

export type DedupeStatus = "new" | "duplicate_url" | "duplicate_content";

export type DedupeResult = {
  canonicalUrl: string;
  contentHash: string;
  dedupeStatus: DedupeStatus;
};

export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);

    u.hash = "";

    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();

    const cleaned: Array<[string, string]> = [];
    for (const [key, val] of u.searchParams.entries()) {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) {
        cleaned.push([key, val]);
      }
    }
    cleaned.sort((a, b) => a[0].localeCompare(b[0]));
    u.search = cleaned.map(([k, v]) => `${k}=${v}`).join("&");

    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;

    return u.origin + u.pathname + u.search;
  } catch {
    return rawUrl;
  }
}

export function contentHash(markdown: string): string {
  const normalized = markdown
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }

  return Math.abs(hash).toString(36).padStart(7, "0");
}

export function checkDedupe(
  url: string,
  markdown: string,
  seenCanonicalUrls: Set<string>,
  seenContentHashes: Set<string>
): DedupeResult {
  const canonicalUrl = canonicalizeUrl(url);
  const hash = contentHash(markdown);

  if (seenCanonicalUrls.has(canonicalUrl)) {
    return { canonicalUrl, contentHash: hash, dedupeStatus: "duplicate_url" };
  }

  if (seenContentHashes.has(hash)) {
    return { canonicalUrl, contentHash: hash, dedupeStatus: "duplicate_content" };
  }

  seenCanonicalUrls.add(canonicalUrl);
  seenContentHashes.add(hash);

  return { canonicalUrl, contentHash: hash, dedupeStatus: "new" };
}
