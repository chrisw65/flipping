# Implementation Plan

## Phase 0: Baseline & Tooling
Goal: establish local dev workflow and shared conventions.
- Confirm local prerequisites: Node.js 20, pnpm.
- Verify workspace scripts: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm e2e`.
- Configure linting and shared TS settings (already present).
Deliverables:
- Root tooling configs in place.
- Frontend and backend dev servers boot locally.
Checklist:
- Owner: [name], ETA: [date], Status: [todo/in-progress/done]

## Phase 1: Backend Rasterization Service
Goal: deliver secure, server-side rasterized pages with cacheable URLs.
- Implement session lifecycle: `POST /sessions` returns JWT + session ID.
- Document registry for local testing: `POST /documents`, `GET /documents`.
- Rasterization pipeline:
  - Load PDF via `mupdf-js`.
  - Render page at scale.
  - Resize/crop/tile with Sharp.
  - Embed watermark in raw pixel buffer.
  - Save to cache and return signed URL.
- Harden access:
  - JWT auth for `/documents`, `/rasterize`, `/page`.
  - HMAC-signed cache keys, TTL-based cache pruning.
Deliverables:
- `/rasterize` returns signed, cacheable URLs.
- `/page` validates session + signature and streams PNG.
Checklist:
- Owner: [name], ETA: [date], Status: [todo/in-progress/done]

## Phase 2: Frontend Renderer Core
Goal: render a page mesh with shader-driven deformation and load textures.
- Three.js scene setup with camera constants per spec.
- Shader pipeline:
  - Vertex shader placeholder for conical deformation.
  - Fragment shader to display page textures.
- Texture pipeline:
  - Fetch `/rasterize`, then load `/page` image.
  - Cache recent textures (LRU or fixed ring).
Deliverables:
- Single page render with live texture from backend.
- Basic animation loop and performance baseline.
Checklist:
- Owner: [name], ETA: [date], Status: [todo/in-progress/done]

## Phase 3: Flipbook Mechanics & Interaction
Goal: multi-page stack with realistic mechanics.
- Page stack data model (left/right, current index).
- Turn states (idle, dragging, settling).
- Z-fighting mitigation (depth bias or offset on stacked pages).
- Touch and mobile hover alternative per addendum.
- Audio cues with Web Audio resume handling.
Deliverables:
- User can turn pages with mouse/touch.
- Settled pages render cleanly with no flicker.
Checklist:
- Owner: [name], ETA: [date], Status: [todo/in-progress/done]

## Phase 4: Security, Watermarking, Forensics
Goal: enforce forensic traceability and recovery workflows.
- DCT watermark tuning (strength, redundancy).
- Add extraction endpoint for internal verification.
- Log watermark payloads on rasterize + serve events.
Deliverables:
- Watermark survives compression tests.
- Verification flow validates watermark payloads.
Checklist:
- Owner: [name], ETA: [date], Status: [todo/in-progress/done]

## Phase 5: Testing & Performance
Goal: guarantee correctness and fps targets.
- Unit tests:
  - Shader math helpers.
  - Watermark encode/decode.
  - Cache key signing.
- E2E tests:
  - Page loads and turns.
  - Visual regression snapshots.
- Performance checks:
  - Frame time metrics on desktop and mobile.
Deliverables:
- Green CI suite for unit + E2E.
- FPS budget documented and enforced.
Checklist:
- Owner: [name], ETA: [date], Status: [todo/in-progress/done]

## Phase 6: Local Deployment Readiness
Goal: run locally with production-like configuration.
- Document `.env` usage for backend secrets.
- Add Dockerfiles (frontend + backend) when ready.
- Add a local fixture PDF set.
Deliverables:
- One-command local start with env files.
- Docker build/run steps documented.
Checklist:
- Owner: [name], ETA: [date], Status: [todo/in-progress/done]

## Phase 7: Production Prep (DigitalOcean)
Goal: prepare deployment checklist and infra outlines.
- Choose hosting pattern (App Platform vs Droplet + Docker).
- Add health checks and log aggregation.
- Document backup and cache invalidation strategy.
Deliverables:
- Deployment checklist for DigitalOcean.
- Rollout and rollback plan.
Checklist:
- Owner: [name], ETA: [date], Status: [todo/in-progress/done]
