# TCF French Learning Agent

Adaptive French learning system for TCF Canada (target: NCLC 7 in all four skills).
Full design: `docs/design.md`. Read it before making architectural decisions.

## Current status

Design / Phase 1 (text-only MVP) not started. Nothing is implemented yet.

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

## Stack (planned)

Next.js + React + TypeScript, PostgreSQL (pgvector only where needed), FSRS for review scheduling,
Vitest + Playwright, GitHub Actions.
