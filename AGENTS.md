# Repository Guidelines

## Project Structure & Module Organization
This repository currently contains project references and a minimal README.
- `README.md`: top-level project overview (currently minimal).
- `reference/`: source documentation for the flipbook specifications (Word docs).
  - `reference/Flipbook_Production_Specification_v2.docx`: primary technical spec for a secure, WebGL-based flipbook system.
  - `reference/Flipbook_Specification_Addendum_v2.1.docx`: corrections and production optimizations; supersedes specific v2.0 sections.
- `packages/frontend/`: Three.js + TypeScript + Vite frontend.
- `packages/backend/`: Fastify + TypeScript backend for rasterization and delivery.
- `packages/shared/`: shared types and constants.
- `packages/watermark/`: DCT watermarking utilities.
- `docs/`: implementation notes and plans (see `docs/IMPLEMENTATION_PLAN.md`).

Each package uses a `src/` directory for implementation. Frontend assets live alongside code in `packages/frontend/`.

## Build, Test, and Development Commands
Monorepo scripts are defined at the root (pnpm + Turbo):
- `pnpm dev`: run frontend and backend dev servers in parallel.
- `pnpm build`: build all packages.
- `pnpm test`: run tests across packages.
- `pnpm lint`: run linting across packages.
- `pnpm typecheck`: run TypeScript type checks across packages.
- `pnpm e2e`: run Playwright end-to-end tests (frontend).
Local defaults: frontend on `http://localhost:5173`, backend on `http://localhost:3000`.

## Coding Style & Naming Conventions
ESLint is configured at the repo root (`eslint.config.js`) using `typescript-eslint` defaults. Keep formatting consistent and add a formatter (for example: Prettier) if you want enforced style. Use clear, descriptive names, and align naming with the language’s standard conventions.

## Testing Guidelines
Testing uses Vitest (configured per package) and Playwright for E2E. Use `*.test.ts` or `*.spec.ts` next to the code under `src/`. Run unit tests with `pnpm test` and E2E tests with `pnpm e2e` (ensure the frontend dev server is running).

## Commit & Pull Request Guidelines
Git history currently contains only an `Initial commit` and no established convention. For now:
- Use short, imperative commit messages (for example: `Add flipbook parser`).
- In PRs, include a clear description of scope and any relevant context.
- If changes affect documentation sources in `reference/`, note what was updated.

## Security & Configuration Tips
Reference documents in `reference/` are the authoritative spec sources. The addendum explicitly supersedes parts of the v2.0 spec; treat it as higher priority when implementing. Avoid editing the docx files unless you are intentionally updating the spec; prefer adding derived artifacts (notes, summaries, code) elsewhere.

Backend configuration lives in `packages/backend/.env.example`. Set `JWT_SECRET` and `CACHE_KEY_SECRET` for signed sessions and cache URLs.
