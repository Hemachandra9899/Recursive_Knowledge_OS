export type ResearchTarget = {
  title: string;
  url: string;
  reason: string;
};

export function planResearchTargets(query: string): ResearchTarget[] {
  const q = query.toLowerCase();

  if (
    q.includes("meta") ||
    q.includes("facebook") ||
    q.includes("graph api") ||
    q.includes("marketing api") ||
    q.includes("ads platform") ||
    q.includes("ads api")
  ) {
    return [
      {
        title: "Meta Graph API",
        url: "https://developers.facebook.com/docs/graph-api/",
        reason: "Official Graph API overview.",
      },
      {
        title: "Meta Marketing API",
        url: "https://developers.facebook.com/docs/marketing-api/",
        reason: "Official Marketing API documentation.",
      },
      {
        title: "Meta Marketing APIs",
        url: "https://developers.facebook.com/docs/marketing-apis/",
        reason: "Official marketing APIs landing page.",
      },
      {
        title: "Meta Permissions Reference",
        url: "https://developers.facebook.com/docs/permissions/reference/",
        reason: "Official permissions reference.",
      },
      {
        title: "Meta Ad Insights API",
        url: "https://developers.facebook.com/docs/marketing-api/insights/",
        reason: "Official ads reporting endpoint documentation.",
      },
    ];
  }

  if (q.includes("google ads") || q.includes("google ads api")) {
    return [
      {
        title: "Google Ads API",
        url: "https://developers.google.com/google-ads/api/docs/start",
        reason: "Official Google Ads API docs.",
      },
      {
        title: "Google Ads API Reporting",
        url: "https://developers.google.com/google-ads/api/docs/reporting/overview",
        reason: "Official reporting docs.",
      },
    ];
  }

  if (q.includes("tiktok") || q.includes("tik tok")) {
    return [
      {
        title: "TikTok Business API",
        url: "https://business-api.tiktok.com/portal/docs",
        reason: "Official TikTok Business API docs.",
      },
    ];
  }

  return [];
}
