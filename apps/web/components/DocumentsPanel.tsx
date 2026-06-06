"use client";

import { ProjectDocument } from "../lib/api";

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return "";
  }
}

export function DocumentsPanel({
  documents,
  onAskDocument,
}: {
  documents: ProjectDocument[];
  onAskDocument: (doc: ProjectDocument) => void;
}) {
  return (
    <section className="documentsPanel">
      <div className="miniTitle">Project Documents</div>

      {documents.length === 0 ? (
        <p className="emptyText">No uploaded/crawled documents yet.</p>
      ) : null}

      <div className="documentsList">
        {documents.map((doc) => (
          <div className="docCard" key={doc.id}>
            <div className="docMain">
              <b>{doc.title || doc.sourceUrl || "Untitled document"}</b>
              <span>
                {doc._count?.chunks ?? 0} chunks · {formatDate(doc.createdAt)}
              </span>
              {doc.sourceUrl ? <small>{doc.sourceUrl}</small> : null}
            </div>

            <button
              className="askDocButton"
              onClick={() => onAskDocument(doc)}
            >
              Ask
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
