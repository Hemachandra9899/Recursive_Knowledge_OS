"use client";

import { useRef, useState } from "react";
import { api, IngestFileResponse } from "../lib/api";

export function FileUploadPanel({
  projectId,
  onUploaded,
}: {
  projectId: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastUpload, setLastUpload] = useState<IngestFileResponse | null>(null);
  const [error, setError] = useState("");

  async function upload(file?: File) {
    if (!file || !projectId) return;

    setUploading(true);
    setError("");
    setLastUpload(null);

    try {
      const result = await api.ingestFile({
        projectId,
        file,
      });

      setLastUpload(result);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  return (
    <section className="uploadPanel">
      <div className="miniTitle">Upload Knowledge</div>

      <button
        className="uploadButton"
        onClick={() => inputRef.current?.click()}
        disabled={!projectId || uploading}
      >
        {uploading ? "Uploading..." : "Upload file"}
      </button>

      <input
        ref={inputRef}
        type="file"
        hidden
        accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.html,.json,.xml"
        onChange={(e) => upload(e.target.files?.[0])}
      />

      <p className="uploadHint">
        PDF, DOCX, PPTX, XLSX, CSV, TXT, HTML
      </p>

      {lastUpload ? (
        <div className="uploadResult">
          <b>{lastUpload.title || lastUpload.filename}</b>
          <span>
            {lastUpload.chunksTotal} chunks · {lastUpload.embeddedChunks} embedded
            {lastUpload.deduped ? " · already existed" : ""}
          </span>
          {lastUpload.embeddingError ? (
            <small className="bad">Embedding issue: {lastUpload.embeddingError}</small>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="uploadError">{error}</div> : null}
    </section>
  );
}
