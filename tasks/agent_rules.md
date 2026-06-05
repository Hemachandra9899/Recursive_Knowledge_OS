# RLM Forge Agent Rules

## Operating Mode

For any non-trivial task, start in plan mode.

A non-trivial task means:

* 3 or more implementation steps
* architectural decisions
* database/schema changes
* runtime changes
* queue/worker changes
* model integration
* retrieval/GraphRAG changes

Before coding:

1. Read `tasks/todo.md`.
2. Read `tasks/lessons.md`.
3. Write a short implementation plan.
4. Keep scope minimal.
5. Touch the fewest files possible.

## Code Quality Rules

Use simple, readable code.

Follow:

* DRY: do not repeat logic unnecessarily.
* KISS: prefer boring, obvious solutions.
* Minimal impact: change only what the task requires.
* No hidden magic: avoid clever abstractions too early.
* Strong types where useful.
* Clear function names.
* Small files.
* Small functions.
* Explicit errors.
* No temporary hacks.

## Architecture Rules

Current architecture:

* Next.js = UI
* Fastify = API
* Prisma = ORM
* Supabase Postgres = durable source of truth
* Redis + BullMQ = jobs and cache
* Qdrant = vector search
* Deno = RLM runtime
* Python model-service = NVIDIA LLM calls
* Firecrawl = web ingestion later
* MCP = external tool interface later

Do not introduce new frameworks unless clearly needed.

## Verification Rules

Never mark work complete without proving it works.

For every task:

1. Run the relevant command.
2. Check logs.
3. Hit the health endpoint if applicable.
4. Add a short review section to `tasks/todo.md`.
5. Mention what was verified.

## Bug Fixing Rules

When an error appears:

1. Read the exact error.
2. Find the root cause.
3. Fix the smallest correct thing.
4. Re-run the failed command.
5. Update `tasks/lessons.md` if this came from a previous wrong assumption.

## Self-Improvement Rule

After every correction from the user, update `tasks/lessons.md`.

Write:

* what went wrong
* why it happened
* what rule prevents it next time

## Completion Standard

Before saying done, ask:

Would a staff engineer approve this?

The answer must be yes.
