```markdown
# Scout

Scout is a recursive AI research operating system designed to go beyond traditional static chatbot interactions. Instead of simply passing a user query directly to an LLM, Scout analyzes user intent, dynamically orchestrates tools, executes deep web research when internal project knowledge is missing, stores and vectorizes newly ingested data on the fly, and runs a programmable, sandboxed Python environment to synthesize deeply grounded, source-backed answers.

---

## 💡 The Mental Model


```

Traditional Chatbot:  User Question ──> LLM Answer

Scout:                User Question
│
├──> Intent Detection & Strategy Planning
├──> Project Knowledge Base Search (Semantic Search)
├──> Web Research / Deep Crawling (If knowledge is missing)
├──> Vector Ingestion & Real-time Chunk Embeddings
├──> Isolated Python Execution (Pyodide Pipeline)
└──> Answer Synthesis & Source Attribution

```

---

## 🏗️ System Architecture

Scout is built as a modular monorepo containing the following tightly decoupled layers:

* **Frontend UI (Next.js):** A clean, professional research-oriented chat interface focused on content readability, real-time job state tracking, expandable source drawers, and detailed runtime trace logs.
* **Central API (Fastify + Prisma):** The orchestrator managing project scopes, background research job dispatches, semantic document chunks, and tool routes.
* **Task Queue (Redis + BullMQ):** Decouples long-running asynchronous research workflows from API request-response lifecycles, enabling deterministic status polling.
* **Core Background Worker (Node.js):** Manages live job transitions (`QUEUED` -> `RUNNING` -> `COMPLETED`/`FAILED`), logging granular steps to the database.
* **The Heart: Scout Runtime (Deno + Pyodide):** An isolated runtime that translates LLM reasoning into dynamic Python scripts executed safely via Pyodide. Supports recursive asynchronous calls to tools like `search_kb()` and `web_research()`.
* **Model Layer (NVIDIA Service / OpenRouter):** Dedicated service handling specialized model endpoints for reasoning (`glm4.7`), code generation (`qwen3-coder-480b`), and high-performance embedding (`nv-embedqa-e5-v5`).
* **Web Ingestion Engine (Firecrawl):** Executes deep scraping and automated public web queries to parse unstructured documentation into rich, valid Markdown.
* **Vector Storage (Qdrant):** Handles high-dimensional semantic search across project workspaces, isolating indices by `projectId`.
* **Relational Storage (Supabase Postgres):** Houses structured entities including Jobs, Documents, relational Chunks, Reports, and granular Agent Execution traces.

---

## 🛠️ Tech Stack

| Component | Technology |
| :--- | :--- |
| **Frontend** | Next.js (App Router), Tailwind CSS |
| **Backend API** | Fastify, TypeScript, Prisma ORM |
| **Distributed Queue** | Redis, BullMQ |
| **Execution Sandbox** | Deno, Pyodide (WASM Python) |
| **Model Hosting** | NVIDIA Triton / OpenRouter API |
| **Vector Engine** | Qdrant DB |
| **Primary Database** | Supabase Postgres |
| **Web Scraping** | Firecrawl API |

---

## 🚀 Quick Start & Deployment

Scout is fully containerized. You can build and initialize the entire ecosystem—including all background databases, workers, runtime environments, API layers, and the UI—using either of the following methods.

### Prerequisites

Ensure you have the following installed on your machine:
* [Docker](https://www.docker.com/products/docker-desktop/) (Engine version 20.10.0 or higher)
* [Docker Compose](https://docs.docker.com/compose/) (v2.0.0 or higher)

### Method 1: Using the Unified Startup Script

A convenience shell script is provided in the root directory to clean, rebuild, and spin up all services simultaneously with a single command.

1. Give execution permissions to the script:
   ```bash
   chmod +x ./run.sh

```

2. Execute the script:
```bash
./run.sh

```



### Method 2: Standard Docker Compose Commands

Alternatively, you can run the build pipeline and bring up the images directly using native Docker commands:

```bash
# Build all system images from the monorepo context
docker-compose build

# Spin up all storage layers, workers, engines, and gateways simultaneously
docker-compose up

```

To run the services in detached (background) mode, append the `-d` flag:

```bash
docker-compose up -d

```

Once the containers are running, all services will automatically interconnect, run database migrations, and become fully operational.

---

## 📡 Core API Endpoints

### System Health

* `GET /health` — Check core gateway status.
* `GET /health/deps` — Verify background connectivity (Postgres, Qdrant, Redis).

### Project Management

* `POST /projects` — Initialize a new isolated workspace project.
* `GET /projects` — Fetch all active projects.
* `GET /projects/:id/jobs` — View execution history for a given project scope.

### Research Engine

* `POST /research-jobs` — Dispatch a raw question to the queue (returns a `jobId`).
* `GET /research-jobs/:id` — Poll state, trace steps, and progress logs for an active job.

### Data & Knowledge Exploration

* `GET /projects/:id/documents` — List all documents scraped into a project.
* `GET /documents/:id/chunks` — View sub-chunks and text parsing blocks.
* `GET /knowledge/vector/status` — Inspect overall collection status in Qdrant.

---

## 🔬 Testing the System End-to-End

To evaluate the recursive workflow, semantic fallback mechanisms, vector generation, and markdown matrix synthesis, execute the following benchmark query within the user interface:

### What Happens Behind the Scenes:

1. **Intent Analysis:** Scout identifies that public documentation is required, multiple external platforms are being compared, and structured Markdown matrix tables are requested.
2. **Knowledge Base Fallback:** The runtime checks Qdrant for existing records. Finding none, it systematically issues web search targets via Firecrawl.
3. **Ingestion Pipeline:** Documentation tables are mapped, embedded via the embedding engine, split structurally into clean chunks, and indexed into Qdrant.
4. **Execution Loop:** Pyodide runs dynamic evaluation scripts to parse comparative fields.
5. **Synthesis:** The Answer Synthesizer aggregates data points into a clear, unified comparison table, appending direct source references at the bottom of the interface.

---

## 🗺️ Next Up on the Roadmap

* [ ] **Streamlined UI Realignment:** Clean, distraction-free typography with definitive source drawers and hidden trace layouts.
* [ ] **SSE Token Streaming:** Complete implementation of Server-Sent Events for live token-by-token text generation and step metrics.
* [ ] **Domain Prioritization:** Source ranking filters to elevate official developers subdomains (`developers.facebook.com`, `ads.tiktok.com`) above secondary discussion blogs.
* [ ] **Entity-Claim Knowledge Graphs:** Deeper extraction of explicit code entities and transactional relations stored as Graph networks.

```

```
