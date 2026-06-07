"use client";

import { useState } from "react";

type Source = {
  title?: string | null;
  url?: string | null;
  score?: number | null;
};

function hostname(url?: string | null) {
  if (!url) return "unknown";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function SourcesPanel({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  if (!sources?.length) return null;

  return (
    <div className="sourcesWrap">
      <button className="sourcesButton" onClick={() => setOpen(!open)}>
        {open ? "Hide Sources" : `Sources (${sources.length})`}
      </button>

      {open && (
        <div style={{ marginTop: "12px" }}>
          {sources.map((source, i) => (
            <a
              key={i}
              href={source.url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="sourceCard"
            >
              <div className="sourceIndex">{i + 1}</div>
              <div>
                <div className="sourceHost">{hostname(source.url)}</div>
                <div className="sourceTitle">{source.title || "Untitled source"}</div>
                {source.score != null && (
                  <div className="sourceUrl">Score: {source.score}/100</div>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
