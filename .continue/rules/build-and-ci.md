# Build and CI

## Local prerequisites

- Node.js 22.x (matches workflows and `webapp/package.json` engines).
- npm lockfile workflow (`npm ci`).
- Playwright Chromium for e2e/smoke tests.

## Core commands

- Dev: `npm run dev`
- Build content only: `npm run build:content`
- Validate content: `npm run content:validate`
- Full build: `npm run build`
- Test: `npm run test`
- Preview built app: `npm run preview`

## Publish-related commands

- Incremental plan: `npm run publish:plan`
- Publish media: `npm run publish:media`
- Publish content: `npm run publish:content` or incremental variants
- Cleanup published media refs: `npm run publish:cleanup-media[:write]`

## CI behavior

- `pr-ci.yml` (PR to `main`):
  - `npm ci`
  - install Playwright Chromium
  - `npm run content:validate`
  - `npm run test`
- `publish.yml` (push to `main`, tags, manual):
  - validates/tests
  - publishes media/content
  - builds site
  - packages `dist/` + `webapp/server.cjs`
  - deploys Azure Web App
  - verifies frontend + shared API endpoints

## Versioning/release notes

- `package.json` currently `0.1.0` and private.
- Tag pushes trigger full rebuild publish path.
- Verify before changing release/versioning flow because publish is workflow-driven.
