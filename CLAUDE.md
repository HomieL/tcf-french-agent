# TCF French Learning Agent

Adaptive French learning system for TCF Canada (target: NCLC 7 in all four skills).
Full design: `docs/design.md`. Read it before making architectural decisions.

## Current status

Phase 1 (text-only MVP) implemented: onboarding, deterministic planner, adaptive sessions (drill / reading /
writing / reflection), attempt pipeline state machine, Claude tool-calling analysis with validated proposals,
error library with dedupe, Beta-Bernoulli mastery, FSRS reviews, progress + model telemetry.
Not yet: audio (listening/speaking), TCF rule store (Layer 1), weekly reports, fixed eval set, auth.

## Layout

- `src/lib/domain/` pure logic (planner, mastery, FSRS, validation, attempt state machine). No I/O.
- `src/lib/llm/` provider interface, Claude provider, mock provider, prompts (versioned), schemas + proposal validation.
- `src/lib/services/` orchestration over the db (PGlite via Drizzle). API routes in `src/app/api/` are thin wrappers.
- Tests: `npm test` (vitest unit + integration on in-memory Postgres), `npm run test:e2e` (Playwright, mock provider),
  `npm run smoke -- <url>` (HTTP walkthrough against a throwaway server).
- Schema change: edit `src/lib/db/schema.ts`, then `npm run db:generate`.

## Workflow

Test every feature (unit/integration + e2e) before calling it done. After major changes, start `npm run dev`
for the user to try manually.

## Non-negotiable design rules

- **Deterministic state machine owns the flow.** The LLM fills constrained steps and calls explicit tools; it never drives the app loop on its own.
- **Model output never mutates persistent state directly.** LLM responses are validated against JSON Schema, then the application applies proposed mutations.
- **Exact exam facts (timing, NCLC tables, thresholds) come from deterministic lookup** over versioned, provenance-tracked records — never from semantic retrieval or model knowledge.
- **Keep the four data layers separate:** official rules, curated language knowledge, learner data, synthetic content. Synthetic content never silently becomes trusted content.
- **Report uncertainty, not false precision.** No phoneme-level pronunciation scores; NCLC estimates are ranges with confidence.
- **Modular monolith.** No Kubernetes, Kafka, microservices, separate vector DB, or multi-agent setups.
- No copyrighted textbook content or live exam-recall material.

## Resume alignment

The resume describes this project with four bullets (stateful adaptive sessions; tool-calling orchestrator
behind a state machine with JSON Schema validation; provenance-aware retrieval with deterministic exam-fact lookup;
fixed LLM eval suite + observability tracking correction accuracy, unsupported claims, human agreement,
p50/p95 latency, tokens, cost). Prioritize work that makes those bullets true. Never invent metrics —
any number must come from real, reproducible measurements recorded in this repo.

## Stack

Next.js 16 + React 19 + TypeScript, Postgres via PGlite (embedded; swap driver for hosted Postgres), Drizzle,
ts-fsrs, Zod, Anthropic SDK (`claude-opus-5`), Vitest + Playwright.

@AGENTS.md
