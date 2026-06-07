"use client";

import { useRef } from "react";
import { useUploadFile } from "../hooks/useDocuments";

export function FileUploadPanel({
  projectId,
}: {
  projectId: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadFile = useUploadFile(projectId);

  return (
    <section className="uploadPanel">
      <div className="miniTitle">Upload Knowledge</div>

      <button
        className="uploadButton"
        onClick={() => inputRef.current?.click()}
        disabled={!projectId || uploadFile.isPending}
      >
        {uploadFile.isPending ? "Uploading..." : "Upload file"}
      </button>

      <input
        ref={inputRef}
        type="file"
        hidden
        accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.html,.json,.xml"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile.mutate(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      <p className="uploadHint">
        PDF, DOCX, PPTX, XLSX, CSV, TXT, HTML
      </p>

      {uploadFile.data ? (
        <div className="uploadResult">
          <b>{uploadFile.data.title || uploadFile.data.filename}</b>
          <span>
            {uploadFile.data.chunksTotal} chunks · {uploadFile.data.embeddedChunks} embedded
            {uploadFile.data.deduped ? " · already existed" : ""}
          </span>
          {uploadFile.data.embeddingError ? (
            <small className="bad">Embedding issue: {uploadFile.data.embeddingError}</small>
          ) : null}
        </div>
      ) : null}

      {uploadFile.error ? <div className="uploadError">{uploadFile.error.message}</div> : null}
    </section>
  );
}
