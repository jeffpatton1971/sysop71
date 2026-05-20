# Architecture

- **Purpose**: React + TypeScript frontend for `sysop71.com`, with authored markdown in `_posts/`, generated JSON content, and Azure Web App deployment.
- **API boundary**: This repo **does not** host API runtime code. It consumes the shared API (`ptech-sites-api`) via `/api/{siteid}/...`.
- **Site identity**:
  - `content/site.config.json` (`key: sysop71`)
  - `VITE_API_SITE_ID`
  - `CONTENT_SITE_KEY`
  - Keep these aligned.

## Major folders

- `src/` — React app (routes/pages/components/content client).
- `scripts/` — content build/validation/publish tooling (`tsx` TypeScript scripts).
- `content/` — site metadata, taxonomy aliases, media manifest.
- `_posts/` — authored source content.
- `tests/site/` — Playwright smoke tests.
- `webapp/` — Node 22 static host/proxy used for Azure App Service deployment.
- `.github/workflows/` — CI, publish, and separate notification/ops workflows.

## Common change locations

- Update UI/routes/pages: `src/pages/*`, `src/App.tsx`, `src/components/*`.
- Update API request behavior: `src/content.ts`.
- Update content schema/build logic: `scripts/build-content.ts` + `scripts/validate-content.ts`.
- Update site identity/nav/branding: `content/site.config.json`.
- Update CI/publish: `.github/workflows/pr-ci.yml` and `.github/workflows/publish.yml`.

## Ownership boundaries

- Do not add `api/` runtime services in this repo.
- Do not commit generated `public/content/`, `dist/`, or other build output.
- Preserve framework shape documented in `docs/agent-framework-contract.md` and `docs/framework-conformance-checklist.md`.
- Legacy/notification workflows exist beside app CI; verify intent before changing unrelated workflows.
