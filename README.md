# Adaptive TCF Canada French Learning Agent

A personal learning system that keeps a persistent learner model, plans adaptive daily French sessions,
tracks recurring errors, schedules spaced reviews, and prepares for the TCF Canada exam.
Design: [docs/design.md](docs/design.md).

## Run it

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY for real AI feedback (optional)
npm run dev                  # http://localhost:3000
```

Without a key the app runs in **Mock AI mode**: exercises come from the seed bank and feedback is rule-based.
Data lives in `data/pglite` (`npm run db:reset` to start over).

## Test it

```bash
npm test            # unit + integration (in-memory Postgres, mock model)
npm run test:e2e    # browser tests (Playwright)
npm run typecheck && npm run lint
```

## Status

Phase 1 (text-only MVP) is implemented. Audio, the official TCF rule store, weekly reports, and the fixed
evaluation set are not built yet. No usage or accuracy metrics have been measured.
