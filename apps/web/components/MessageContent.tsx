"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MessageContent({ content }: { content: string }) {
  if (!content?.trim()) {
    return <p className="answerText">Waiting for answer...</p>;
  }

  return (
    <div className="markdownAnswer">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
