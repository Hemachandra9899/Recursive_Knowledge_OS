"use client";

import { useState } from "react";

type Source = {
  title?: string | null;
  url?: string | null;
  score?: number | null;
  retrieval?: string | null;
};

function hostname(url?: string | null) {
  if (!url) return "source";
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

export function SourcesPanel({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  if (!sources?.length) return null;

  return (
    <div className="sourcesWrap">
      <button className="sourcesButton" onClick={() => setOpen(true)}>
        {sources.length} sources
      </button>

      {open ? (
        <div className="sourcesOverlay">
          <div className="sourcesDrawer">
            <div className="sourcesHeader">
              <div>
                <h3>{sources.length} sources</h3>
                <p>Sources used to answer this request</p>
              </div>
              <button onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="sourcesList">
              {sources.map((source, index) => (
                <a
                  key={`${source.url || source.title}-${index}`}
                  className="sourceCard"
                  href={source.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="sourceIndex">{index + 1}</div>
                  <div>
                    <div className="sourceHost">{hostname(source.url)}</div>
                    <div className="sourceTitle">
                      {source.title || source.url || "Untitled source"}
                    </div>
                    {source.url ? <div className="sourceUrl">{source.url}</div> : null}
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
