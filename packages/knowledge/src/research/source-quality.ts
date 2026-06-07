const OFFICIAL_DOMAINS = [
  "developers.facebook.com",
  "developers.google.com",
  "business-api.tiktok.com",
  "ads.tiktok.com",
];

const WEAK_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "stackoverflow.com",
  "postman.com",
  "medium.com",
  "reddit.com",
];

export function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

export function isOfficialSource(url: string) {
  const host = getHostname(url);
  return OFFICIAL_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

export function isWeakSource(url: string) {
  const host = getHostname(url);
  return WEAK_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

export function sourceScore(url: string) {
  if (isOfficialSource(url)) return 100;
  if (isWeakSource(url)) return 10;
  return 40;
}

export function keepHighQualitySources<
  T extends { url?: string; sourceUrl?: string },
>(sources: T[]) {
  return sources
    .map((source) => {
      const url = source.url || source.sourceUrl || "";
      return {
        source,
        score: sourceScore(url),
      };
    })
    .filter((item) => item.score >= 40)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.source);
}
