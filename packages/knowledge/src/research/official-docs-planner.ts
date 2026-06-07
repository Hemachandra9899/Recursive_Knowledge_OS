export type OfficialDocTarget = {
  provider: "meta" | "google_ads" | "tiktok_ads";
  title: string;
  url: string;
  reason: string;
};

export function planOfficialDocs(query: string): OfficialDocTarget[] {
  const q = query.toLowerCase();
  const targets: OfficialDocTarget[] = [];

  const wantsMeta =
    q.includes("meta") ||
    q.includes("facebook") ||
    q.includes("graph api") ||
    q.includes("marketing api");

  const wantsGoogle =
    q.includes("google ads") ||
    q.includes("google ads api") ||
    q.includes("google");

  const wantsTikTok =
    q.includes("tiktok") ||
    q.includes("tik tok") ||
    q.includes("tiktok ads");

  if (wantsMeta) {
    targets.push(
      {
        provider: "meta",
        title: "Meta Marketing API",
        url: "https://developers.facebook.com/docs/marketing-api/",
        reason: "Official Meta Marketing API docs",
      },
      {
        provider: "meta",
        title: "Meta Ad Insights API",
        url: "https://developers.facebook.com/docs/marketing-api/insights/",
        reason: "Official Meta Ads reporting docs",
      },
      {
        provider: "meta",
        title: "Meta Permissions Reference",
        url: "https://developers.facebook.com/docs/permissions/reference/",
        reason: "Official Meta permissions docs",
      },
    );
  }

  if (wantsGoogle) {
    targets.push(
      {
        provider: "google_ads",
        title: "Google Ads API Overview",
        url: "https://developers.google.com/google-ads/api/docs/start",
        reason: "Official Google Ads API docs",
      },
      {
        provider: "google_ads",
        title: "Google Ads API Reporting",
        url: "https://developers.google.com/google-ads/api/docs/reporting/overview",
        reason: "Official Google Ads reporting docs",
      },
      {
        provider: "google_ads",
        title: "Google Ads API OAuth",
        url: "https://developers.google.com/google-ads/api/docs/oauth/overview",
        reason: "Official Google Ads OAuth docs",
      },
    );
  }

  if (wantsTikTok) {
    targets.push(
      {
        provider: "tiktok_ads",
        title: "TikTok Business API",
        url: "https://business-api.tiktok.com/portal/docs",
        reason: "Official TikTok Business API docs",
      },
    );
  }

  return targets;
}
