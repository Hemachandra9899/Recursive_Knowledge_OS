# RLM Forge Todo

## Day 1 — Minimal Monorepo Foundation

- [x] Create monorepo folder structure
- [x] Add root workspace package.json
- [x] Add .env.example and .env
- [x] Add Prisma schema
- [x] Add Fastify API
- [x] Add BullMQ worker
- [x] Add Deno runtime placeholder
- [x] Add NVIDIA model service
- [x] Add Next.js placeholder
- [x] Add Docker Compose
- [x] Add agent rules
- [x] npm install — works ✅
- [x] Prisma generate — works ✅
- [x] Prisma db push — syncs to Supabase ✅
- [x] Start infra — Redis (Docker) ✅ Qdrant (local binary) ✅
- [x] Verify health endpoints — all "ok" ✅
- [x] Create project via API — Supabase + Prisma connected ✅
- [x] Install Python model-service deps — all pip installed ✅
- [x] Start model-service — uvicorn on 8100 ✅
- [x] Start rlm-runtime — Deno on 8787 ✅
- [x] Start API — Fastify on 8000 ✅
- [x] Test research job — STATUS: COMPLETED with report, agent run, steps ✅

## Notes

- Docker pull failed for Qdrant (TLS timeout). Qdrant running from downloaded binary instead.
- .env updated for local URLs (localhost not Docker service names). Revert to Docker-style URLs when using `docker compose up --build`.
- Deno v2.7.14 installed locally.
- Next/web is a placeholder — not tested (needs `npm run dev:web`).
- Full `docker compose up --build` not tested due to Qdrant pull issue.
- NVIDIA and Firecrawl real API keys in .env — rotate after local setup.
- NVIDIA models updated: reasoning=`meta/llama-3.3-70b-instruct`, coding=`qwen/qwen2-7b-instruct`
- Deno needs `--env-file` or env vars passed explicitly; deno.json updated

## Day 2 + Day 3 Review

Implemented:
- Deno runtime loads Pyodide.
- `/execute` calls NVIDIA coding model.
- Generated Python is sanitized (markdown fences stripped).
- Python code executes in Pyodide sandbox.
- stdout is captured via StringIO redirect.
- final(value) is supported.
- Multi-step RLM loop runs until final() or maxSteps.
- TypeScript types for all interfaces.

Verified:
- `GET /health` — returns `modelServiceOk: true` ✅
- `POST /execute` with `"Calculate 12 * 8"` — `status: "completed"`, `final: 96` ✅
- response includes `generatedCode`, `stdout`, `final`, `steps` trace ✅
- No markdown code fences in executed code ✅
- No recursion yet.
- No `llm_query()` yet.
- No Firecrawl tools yet.
- No Qdrant retrieval yet.
- No graph memory yet.
