"use client";

import { useEffect, useMemo, useState } from "react";
import { api, Project, ResearchJob } from "../lib/api";

type Theme = "dark" | "light";

function isGenericAnswer(value: string) {
  const normalized = value.trim().toLowerCase();

  return [
    "done",
    "completed",
    "all questions have been answered.",
    "all questions have been answered",
    "the task is complete.",
    "task complete",
  ].includes(normalized);
}

function extractStdout(job?: ResearchJob) {
  const runs = job?.agentRuns || [];

  for (const run of runs) {
    const result = run.finalOutput as any;
    const steps = Array.isArray(result?.steps) ? result.steps : [];

    for (const step of [...steps].reverse()) {
      if (typeof step?.stdout === "string" && step.stdout.trim()) {
        return step.stdout.trim();
      }
    }
  }

  return "";
}

function answerText(job?: ResearchJob) {
  if (!job) return "";

  const report = job.reports?.[0];

  if (report?.content && !isGenericAnswer(report.content)) {
    return report.content;
  }

  const stdout = extractStdout(job);
  if (stdout) return stdout;

  const finalOutput = job.agentRuns?.[0]?.finalOutput as any;
  const final = finalOutput?.final;

  if (typeof final === "string") return final;
  if (final !== undefined && final !== null) return JSON.stringify(final, null, 2);

  return job.error || report?.content || "";
}

function getSources(job?: ResearchJob) {
  const report = job?.reports?.[0] as any;
  const sources = report?.metadata?.sources;

  if (Array.isArray(sources)) return sources;

  const resultSources = (job?.agentRuns?.[0]?.finalOutput as any)?.sources;
  if (Array.isArray(resultSources)) return resultSources;

  return [];
}

function shortId(id: string) {
  return id.slice(0, 8);
}

/* Word-by-word text streaming component */
function TypewriterText({ text }: { text: string }) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    if (!text) {
      setDisplayedText("");
      return;
    }
    
    // Split by spaces/newlines but keep the delimiters to preserve spacing
    const tokens = text.split(/(\s+)/);
    setDisplayedText("");
    
    let currentIdx = 0;
    const interval = setInterval(() => {
      setDisplayedText((prev) => {
        const next = tokens.slice(0, currentIdx + 1).join("");
        currentIdx++;
        if (currentIdx >= tokens.length) {
          clearInterval(interval);
        }
        return next;
      });
    }, 40); // 40ms streaming speed

    return () => clearInterval(interval);
  }, [text]);

  return <span className="answerText">{displayedText}</span>;
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [activeJobId, setActiveJobId] = useState("");
  const [projectName, setProjectName] = useState("RLM Research");
  const [question, setQuestion] = useState(
    "Explain what RLM Forge is in simple words."
  );
  const [deps, setDeps] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId),
    [jobs, activeJobId]
  );

  // Card Sequential Visibility and Active Tag Calculations
  const stages = useMemo(() => {
    if (!activeJob) {
      return {
        query: false,
        agent: false,
        vector: false,
        rlm: false,
        output: false,
        active: "",
      };
    }

    const status = activeJob.status;
    const runsCount = activeJob.agentRuns?.length || 0;
    
    let query = true;
    let agent = false;
    let vector = false;
    let rlm = false;
    let output = false;
    let active = "query";

    if (status === "queued") {
      active = "query";
    } else if (status === "running") {
      agent = true;
      active = "agent";
      
      if (runsCount > 0) {
        vector = true;
        active = "vector";
      }
      
      const totalSteps = activeJob.agentRuns?.reduce((sum, run) => sum + (run.steps?.length || 0), 0) || 0;
      if (totalSteps > 0) {
        rlm = true;
        active = "rlm";
      }
    } else if (status === "completed") {
      agent = true;
      vector = true;
      rlm = true;
      output = true;
      active = "output";
    } else if (status === "failed") {
      agent = runsCount > 0;
      vector = runsCount > 0;
      rlm = runsCount > 0;
      active = "failed";
    }

    return { query, agent, vector, rlm, output, active };
  }, [activeJob]);

  async function refreshProjects() {
    const rows = await api.listProjects();
    setProjects(rows);
    if (!selectedProjectId && rows[0]) setSelectedProjectId(rows[0].id);
  }

  async function refreshJobs(pid = selectedProjectId) {
    if (!pid) return;
    const rows = await api.listProjectJobs(pid);
    setJobs(rows);
  }

  async function refreshDeps() {
    setDeps(await api.deps());
  }

  async function createProject() {
    setError("");
    const project = await api.createProject({
      name: projectName || "Untitled Project",
      description: "Created from RLM Forge UI",
    });
    setSelectedProjectId(project.id);
    await refreshProjects();
  }

  async function generate() {
    if (!question.trim()) return;
    
    let pid = selectedProjectId || projects[0]?.id;
    if (!pid) {
      setError("Please create or select a project first.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const created = await api.createResearchJob({ projectId: pid, question });
      setActiveJobId(created.jobId);
      await refreshJobs(pid);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("rlm-theme") as Theme | null;
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("rlm-theme", theme);
  }, [theme]);

  useEffect(() => {
    refreshProjects().catch((e) => setError(String(e)));
    refreshDeps().catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      refreshJobs(selectedProjectId).catch((e) => setError(String(e)));
      setActiveJobId("");
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (!activeJobId || !selectedProjectId) return;
    const timer = setInterval(async () => {
      const job = await api.getResearchJob(activeJobId);
      setJobs((prev) => {
        const rest = prev.filter((item) => item.id !== job.id);
        return [job, ...rest];
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [activeJobId, selectedProjectId]);

  return (
    <main className="app-container">
      {/* Collapsible Sidebar */}
      <aside className={`side ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="side-header">
          <div className="brand">
            <h1>RLM Forge</h1>
            <p>AI Research OS</p>
          </div>
        </div>
        
        <div className="side-content">
          <button 
            className="primaryButton"
            onClick={() => {
              setActiveJobId("");
              setQuestion("");
            }}
          >
            + New Research
          </button>

          <div className="section">
            <label>Current Project</label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name"
            />
            <button className="smallButton" onClick={createProject} style={{ marginTop: "4px" }}>
              Update / Create Project
            </button>
          </div>

          <div className="section">
            <label>All Projects</label>
            <div className="list">
              {projects.map((project) => (
                <button
                  key={project.id}
                  className={project.id === selectedProjectId ? "item active" : "item"}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <span>{project.name}</span>
                  <small>{shortId(project.id)}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="section" style={{ flex: 1, minHeight: "150px" }}>
            <label>Chat History</label>
            <div className="list" style={{ overflowY: "auto", maxHeight: "250px" }}>
              {jobs.length === 0 ? (
                <div style={{ color: "var(--muted)", padding: "4px" }}>No history yet.</div>
              ) : (
                jobs.map((job) => (
                  <button
                    key={job.id}
                    className={job.id === activeJobId ? "item active" : "item"}
                    onClick={() => setActiveJobId(job.id)}
                  >
                    <span>{job.question}</span>
                    <small>{job.status === "completed" ? "✓" : "⚡"}</small>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="side-footer">
          <button className="collapse-btn" onClick={() => setSidebarOpen(false)} title="Collapse sidebar">
            ◀ Collapse
          </button>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <section className="chat-container">
        {/* Consolidated Top Bar Row */}
        <header className="chatHeader">
          <div className="header-left">
            {!sidebarOpen && (
              <button className="menu-toggle" onClick={() => setSidebarOpen(true)} title="Expand sidebar">
                ☰
              </button>
            )}
            <div className="header-title">
              <p>{selectedProject?.name || "No project selected"}</p>
              <h2>{activeJob ? "Research Session" : "RLM Forge Playground"}</h2>
            </div>
          </div>

          {/* Chat / Dev Mode Switch */}
          <div className="mode-toggle-container">
            <span className={`mode-label ${!devMode ? "active" : ""}`}>Chat</span>
            <div 
              className={`mode-switch ${devMode ? "active" : ""}`}
              onClick={() => setDevMode(!devMode)}
              title="Toggle Chat / Dev Workflow Mode"
            >
              <div className="mode-switch-handle">
                {devMode ? "</>" : "💬"}
              </div>
            </div>
            <span className={`mode-label ${devMode ? "active" : ""}`}>Dev</span>
          </div>

          {/* Status dots & Theme Switch */}
          <div className="header-right">
            <div className="status-row">
              {Object.entries(deps).map(([key, value]) => (
                <div 
                  key={key} 
                  className={`status-indicator ${value.includes("ok") ? "ok" : ""}`}
                  title={`${key}: ${value}`}
                >
                  <span className="dot" />
                  <span>{key === "rlmRuntime" ? "rlm" : key}</span>
                </div>
              ))}
            </div>
            <button
              className="theme-toggle-btn"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "☀ Light" : "☾ Dark"}
            </button>
          </div>
        </header>

        {/* Workspace Layout Content */}
        <div className="workspace-wrapper">
          {/* Left Column (Shared between Chat and Dev Mode flowcharts) */}
          <div className="workspace-left">
            {!devMode ? (
              /* CHAT MODE WORKSPACE */
              <section className="messages-wrapper">
                {activeJob ? (
                  <div className="messages">
                    <div className="bubble user">
                      <b>You</b>
                      <p>{activeJob.question}</p>
                    </div>
                    <div className="bubble assistant">
                      <b>RLM Forge · {activeJob.status}</b>
                      {activeJob.status === "completed" || activeJob.status === "failed" ? (
                        <TypewriterText text={answerText(activeJob)} />
                      ) : (
                        <p className="answerText">{answerText(activeJob) || "Waiting for answer..."}</p>
                      )}
                      {getSources(activeJob).length > 0 ? (
                        <div className="sources">
                          <div className="sourcesTitle">Sources</div>
                          {getSources(activeJob).map((source: any, index: number) => (
                            <a
                              key={`${source.url || source.title}-${index}`}
                              href={source.url || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="sourceItem"
                            >
                              <span>{index + 1}</span>
                              <div>
                                <b>{source.title || "Untitled source"}</b>
                                {source.url ? <small>{source.url}</small> : null}
                              </div>
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {activeJob.agentRuns?.length ? (
                        <details>
                          <summary>Trace Logs ({activeJob.agentRuns.length} runs)</summary>
                          <pre>{JSON.stringify(activeJob.agentRuns, null, 2)}</pre>
                        </details>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  /* Firecrawl inspired Welcome Screen */
                  <div className="welcome-dashboard">
                    <div className="welcome-logo">RLM FORGE</div>
                    <div className="welcome-subtitle">API, Docs and Recursive AI Research Engine</div>
                    
                    <div className="presets-container">
                      <button 
                        className="preset-pill" 
                        onClick={() => setQuestion("Deep search recursive runtime logs")}
                      >
                        Search
                      </button>
                      <button 
                        className="preset-pill" 
                        onClick={() => setQuestion("Extract structured entities from data sources")}
                      >
                        Extract
                      </button>
                      <button 
                        className="preset-pill" 
                        onClick={() => setQuestion("Crawl nested API documentations recursively")}
                      >
                        Crawl
                      </button>
                    </div>
                  </div>
                )}
                {error ? <div className="messages"><div className="error-message">{error}</div></div> : null}
              </section>
            ) : (
              /* DEV MODE WORKSPACE - LEFT VIEW FLOWCHART */
              <div className="workflow-canvas">
                {busy && (
                  <>
                    <div className="cloud-code-particle" style={{ left: "42%", animationDelay: "0s" }}>
                      {"const rlm = new RLM()"}
                    </div>
                    <div className="cloud-code-particle" style={{ left: "56%", animationDelay: "1.5s" }}>
                      {"qdrant.query({ text })"}
                    </div>
                    <div className="cloud-code-particle" style={{ left: "48%", animationDelay: "3s" }}>
                      {"redis.set(cache_key)"}
                    </div>
                    <div className="cloud-code-particle" style={{ left: "52%", animationDelay: "4.5s" }}>
                      {"agent.reason(task)"}
                    </div>
                  </>
                )}

                <div className="workflow-nodes">
                  {/* Stage 5: Final Report (Top) */}
                  <div className={`flow-card-wrapper ${stages.output ? "visible" : ""}`}>
                    <div className={`flow-card ${stages.active === "output" ? "active" : ""}`}>
                      <div className="flow-card-icon" style={{ backgroundColor: "var(--lime)" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                      </div>
                      <div className="flow-card-body">
                        <div className="flow-card-title">OUTPUT REPORT</div>
                        <div className="flow-card-desc">Final Knowledge Summary</div>
                      </div>
                      {stages.active === "output" && (
                        <div className="flow-card-tag" style={{ backgroundColor: "var(--lime)" }}>
                          Completed
                        </div>
                      )}
                    </div>
                  </div>

                  {stages.output && <div className="flow-connector" />}

                  {/* Stage 4: RLM Loop */}
                  <div className={`flow-card-wrapper ${stages.rlm ? "visible" : ""}`}>
                    <div className={`flow-card ${stages.active === "rlm" ? "active" : ""}`}>
                      <div className="flow-card-icon" style={{ backgroundColor: "var(--pink)" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      </div>
                      <div className="flow-card-body">
                        <div className="flow-card-title">RLM RUNTIME</div>
                        <div className="flow-card-desc">Recursive Execution Loop</div>
                      </div>
                      {stages.active === "rlm" && (
                        <div className="flow-card-tag" style={{ backgroundColor: "var(--pink)" }}>
                          RLM Loop
                        </div>
                      )}
                    </div>
                  </div>

                  {stages.rlm && <div className="flow-connector" />}

                  {/* Stage 3: Vector Retrieve */}
                  <div className={`flow-card-wrapper ${stages.vector ? "visible" : ""}`}>
                    <div className={`flow-card ${stages.active === "vector" ? "active" : ""}`}>
                      <div className="flow-card-icon" style={{ backgroundColor: "var(--orange)" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5">
                          <ellipse cx="12" cy="5" rx="9" ry="3" />
                          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
                        </svg>
                      </div>
                      <div className="flow-card-body">
                        <div className="flow-card-title">VECTOR RETRIEVE</div>
                        <div className="flow-card-desc">Qdrant DB & Cache Query</div>
                      </div>
                      {stages.active === "vector" && (
                        <div className="flow-card-tag" style={{ backgroundColor: "var(--orange)" }}>
                          DB Fetching
                        </div>
                      )}
                    </div>
                  </div>

                  {stages.vector && <div className="flow-connector" />}

                  {/* Stage 2: Agent Planner */}
                  <div className={`flow-card-wrapper ${stages.agent ? "visible" : ""}`}>
                    <div className={`flow-card ${stages.active === "agent" ? "active" : ""}`}>
                      <div className="flow-card-icon" style={{ backgroundColor: "var(--cyan)" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                      </div>
                      <div className="flow-card-body">
                        <div className="flow-card-title">AGENT PLANNER</div>
                        <div className="flow-card-desc">Reasoning Task Planning</div>
                      </div>
                      {stages.active === "agent" && (
                        <div className="flow-card-tag" style={{ backgroundColor: "var(--cyan)" }}>
                          Agent Planning
                        </div>
                      )}
                    </div>
                  </div>

                  {stages.agent && <div className="flow-connector" />}

                  {/* Stage 1: Query Input (Bottom) */}
                  <div className={`flow-card-wrapper ${stages.query ? "visible" : ""}`}>
                    <div className={`flow-card ${stages.active === "query" ? "active" : ""}`}>
                      <div className="flow-card-icon" style={{ backgroundColor: "var(--lime)" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>
                      <div className="flow-card-body">
                        <div className="flow-card-title">QUERY INPUT</div>
                        <div className="flow-card-desc">{activeJob ? activeJob.question.slice(0, 25) + (activeJob.question.length > 25 ? "..." : "") : "Idle"}</div>
                      </div>
                      {stages.active === "query" && (
                        <div className="flow-card-tag" style={{ backgroundColor: "var(--lime)" }}>
                          User Query
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Composer / Input Box - Nested inside workspace-left so it stays on the left column in Dev Mode! */}
            <footer className="composer-wrapper">
              <div className="composer-box">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask RLM Forge anything..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      generate();
                    }
                  }}
                />
                <div className="composer-actions">
                  <div className="composer-left-actions">
                    <button className="composer-btn" title="Attach Files">📎</button>
                    <button className="composer-btn" title="Clear input" onClick={() => setQuestion("")}>✕</button>
                  </div>
                  <button
                    className="generate-btn"
                    onClick={generate}
                    disabled={busy || !question.trim()}
                  >
                    {busy ? "Running..." : "Generate"}
                  </button>
                </div>
              </div>
            </footer>
          </div>

          {/* Right Column - Terminal Console (only visible in Dev Mode) */}
          {devMode && (
            <div className="dev-console-panel">
              <div className="console-header">
                <h3>Console Sandbox Trace</h3>
                <span style={{ color: "var(--lime)", fontFamily: "var(--font-pixel)", fontSize: "14px" }}>
                  {activeJob ? activeJob.status : "Idle"}
                </span>
              </div>
              <div className="console-body">
                {activeJob ? (
                  <>
                    <div className="console-line">
                      <span className="timestamp">[00:01]</span>
                      <span className="tag">[SYSTEM]</span>
                      <span>Initialized research sandbox session: {shortId(activeJob.id)}</span>
                    </div>
                    <div className="console-line">
                      <span className="timestamp">[00:02]</span>
                      <span className="tag">[SANDBOX]</span>
                      <span>Running RLM executive with prompt input.</span>
                    </div>
                    {activeJob.agentRuns?.map((run, idx) => (
                      <div key={run.id} className="console-line">
                        <span className="timestamp">[00:{idx + 3}]</span>
                        <span className="tag">[AGENT_RUN]</span>
                        <span>Depth {run.depth}: status={run.status}, query="{run.query}"</span>
                        {run.steps?.map((step) => (
                          <div key={step.id} style={{ paddingLeft: "12px", color: "var(--orange)" }}>
                            <span>Step {step.stepIndex}: {step.stdout || "Evaluating step..."}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {activeJob.error && (
                      <div className="console-line" style={{ color: "var(--bad)" }}>
                        <span className="timestamp">[ERR]</span>
                        <span>{activeJob.error}</span>
                      </div>
                    )}
                    {activeJob.status === "completed" && (
                      <>
                        <div className="console-line" style={{ color: "var(--lime)" }}>
                          <span className="timestamp">[DONE]</span>
                          <span>Report generated successfully! Sending output report.</span>
                        </div>
                        {/* Stream Final Answer inside Sandbox Panel under the whole logs */}
                        <div className="console-answer-section">
                          <div className="console-answer-header">&gt; FINAL REPORT OUTPUT:</div>
                          <TypewriterText text={answerText(activeJob)} />
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="muted">Waiting for research sandbox query...</div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
