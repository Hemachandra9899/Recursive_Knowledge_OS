export type OfficialDocTarget = {
  provider: "meta" | "google_ads" | "tiktok_ads";
  title: string;
  url: string;
  reason: string;
  priority: number;
};

function wantsMeta(query: string) {
  const q = query.toLowerCase();

  return (
    q.includes("meta") ||
    q.includes("facebook") ||
    q.includes("graph api") ||
    q.includes("marketing api")
  );
}

function wantsGoogleAds(query: string) {
  const q = query.toLowerCase();

  return (
    q.includes("google ads") ||
    q.includes("google ads api") ||
    q.includes("google")
  );
}

function wantsTikTokAds(query: string) {
  const q = query.toLowerCase();

  return (
    q.includes("tiktok") ||
    q.includes("tik tok") ||
    q.includes("tiktok ads")
  );
}

function wantsAdsComparison(query: string) {
  const q = query.toLowerCase();

  return (
    q.includes("compare") &&
    q.includes("ads") &&
    (q.includes("meta") || q.includes("google") || q.includes("tiktok"))
  );
}

export function normalizeResearchQuery(query: string): string {
  return query
    .replace(/\bmets\s+graph\s+api\b/gi, "Meta Graph API")
    .replace(/\bmeta\s+ads\s+api\b/gi, "Meta Marketing API")
    .replace(/\bfacebook\s+ads\s+api\b/gi, "Meta Marketing API")
    .trim();
}

export function planOfficialDocs(query: string): OfficialDocTarget[] {
  const normalized = normalizeResearchQuery(query);
  const targets: OfficialDocTarget[] = [];

  const includeAllAdsApis = wantsAdsComparison(normalized);

  if (includeAllAdsApis || wantsMeta(normalized)) {
    targets.push(
      {
        provider: "meta",
        title: "Meta Marketing API",
        url: "https://developers.facebook.com/docs/marketing-api/",
        reason: "Official Meta Marketing API documentation.",
        priority: 100,
      },
      {
        provider: "meta",
        title: "Meta Ad Insights API",
        url: "https://developers.facebook.com/docs/marketing-api/insights/",
        reason: "Official Meta ads reporting documentation.",
        priority: 95,
      },
      {
        provider: "meta",
        title: "Meta Permissions Reference",
        url: "https://developers.facebook.com/docs/permissions/reference/",
        reason: "Official Meta permissions reference.",
        priority: 80,
      },
    );
  }

  if (includeAllAdsApis || wantsGoogleAds(normalized)) {
    targets.push(
      {
        provider: "google_ads",
        title: "Google Ads API",
        url: "https://developers.google.com/google-ads/api",
        reason: "Official Google Ads API overview.",
        priority: 100,
      },
      {
        provider: "google_ads",
        title: "Google Ads API Reporting",
        url: "https://developers.google.com/google-ads/api/docs/reporting/overview",
        reason: "Official Google Ads API reporting documentation.",
        priority: 95,
      },
      {
        provider: "google_ads",
        title: "Google Ads API OAuth",
        url: "https://developers.google.com/google-ads/api/docs/oauth/overview",
        reason: "Official Google Ads API OAuth documentation.",
        priority: 80,
      },
    );
  }

  if (includeAllAdsApis || wantsTikTokAds(normalized)) {
    targets.push(
      {
        provider: "tiktok_ads",
        title: "TikTok API for Business",
        url: "https://business-api.tiktok.com/portal/docs",
        reason: "Official TikTok API for Business documentation.",
        priority: 100,
      },
      {
        provider: "tiktok_ads",
        title: "TikTok API for Business Overview",
        url: "https://ads.tiktok.com/help/article/marketing-api",
        reason: "TikTok official API for Business overview.",
        priority: 80,
      },
    );
  }

  return targets.sort((a, b) => b.priority - a.priority);
}

export function selectOfficialTargets(
  query: string,
  maxResults = 8,
): OfficialDocTarget[] {
  const targets = planOfficialDocs(query);

  const selected: OfficialDocTarget[] = [];
  const seenProviders = new Set<string>();

  for (const target of targets) {
    if (!seenProviders.has(target.provider)) {
      selected.push(target);
      seenProviders.add(target.provider);
    }
  }

  for (const target of targets) {
    if (selected.length >= maxResults) break;
    if (!selected.some((item) => item.url === target.url)) {
      selected.push(target);
    }
  }

  return selected.slice(0, maxResults);
}
