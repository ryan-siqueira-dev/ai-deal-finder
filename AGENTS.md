# Repository Guidelines

## Project Structure & Module Organization

Application code lives in `src/`. Marketplace adapters are isolated under `src/marketplaces/{facebook,olx,mercadolivre}`, category rules under `src/categories/`, orchestration under `src/jobs/`, and persistence logic under `src/listings/`. CLIs are in `src/cli/`; shared configuration and utilities are in `src/config/` and `src/utils/`. Prisma models and timestamped migrations live in `prisma/`. Vitest tests use `tests/*.test.ts`, with synthetic data in `tests/fixtures/`. Operational documentation is in `README.md`, `SECURITY.md`, and `docs/`.

## Build, Test, and Development Commands

- `npm run dev`: run the TypeScript entrypoint in watch mode.
- `npm run typecheck`: check strict TypeScript without emitting files.
- `npm run build`: compile production output into `dist/`.
- `npm test`: run the complete Vitest suite once.
- `npm run test:coverage`: run tests and enforce V8 coverage thresholds.
- `npm run prisma:validate`: validate the Prisma schema.
- `npm run prisma:migrate`: apply committed migrations.
- `docker compose up -d postgres`: start only the local database.

Run `npm run prisma:generate` after changing `prisma/schema.prisma`.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, double quotes, semicolons, and trailing commas where existing code does. The project uses ESM and NodeNext resolution, so relative TypeScript imports must end in `.js`. Prefer `camelCase` for functions and variables, `PascalCase` for classes and types, and kebab-case filenames such as `search-runner.ts`. Keep adapters, analyzers, and persistence concerns separate. No formatter or linter is configured; match nearby code and run `git diff --check`.

## Testing Guidelines

Use Vitest and name files `*.test.ts`. Add regression tests beside the closest existing suite and use fixtures rather than real marketplace traffic. Coverage gates are 45% statements, 65% branches, 60% functions, and 45% lines. Changes to concurrency, migrations, parsers, URLs, authentication, or notification idempotency require targeted tests.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `Optimize paid LLM routing`. Keep commits focused. Pull requests should explain what changed, why, user impact, migrations or environment changes, and commands used to validate the work. Link relevant issues. Include screenshots only for browser/parser diagnostics, and redact account or listing data first.

## Security & Configuration

Never commit `.env`, tokens, browser profiles, `data/`, `.runtime/`, logs, or screenshots. Keep providers opt-in and use only authorized integrations. Represent schema changes with reviewed Prisma migrations; do not edit production data manually.
