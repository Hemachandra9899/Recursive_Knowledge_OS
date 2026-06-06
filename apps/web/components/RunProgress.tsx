"use client";

const DEFAULT_STEPS = [
  "Understanding your request",
  "Checking project knowledge",
  "Searching web/docs if needed",
  "Reading sources",
  "Writing answer",
];

export function RunProgress({
  status,
  steps = DEFAULT_STEPS,
}: {
  status: string;
  steps?: string[];
}) {
  const isRunning = ["running", "queued"].includes(status?.toLowerCase());

  if (!isRunning) return null;

  return (
    <div className="runProgress">
      <div className="progressTitle">Working</div>
      {steps.map((step, index) => (
        <div className="progressStep" key={step}>
          <span>{index + 1}</span>
          <p>{step}</p>
        </div>
      ))}
    </div>
  );
}
