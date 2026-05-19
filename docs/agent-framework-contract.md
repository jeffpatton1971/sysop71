# Agent Framework Contract

This repository is a PattonTech React/API site. Keep changes inside these
boundaries.

## Non-Negotiables

- This repo owns the React frontend, authored Markdown, generated-content build,
  media publishing, and Azure Web App deployment.
- This repo does not own API runtime code.
- The shared API is `ptech-sites-api`.
- All runtime API calls must use `/api/{siteid}/...`.
- The site id is explicit and must match `CONTENT_SITE_KEY` and
  `VITE_API_SITE_ID`.
- Generated `public/content/` is not committed.
- Source content in `_posts/` is retained unless a migration explicitly replaces
  the content compiler source.

## Before Editing

Read:

- `docs/framework-conformance-checklist.md`
- `content/site.config.json`
- `package.json`
- `.github/workflows/publish.yml`

Then run or inspect:

```powershell
git status --short
npm run content:validate
```

## Deployment Contract

The publish workflow:

1. Validates content.
2. Runs tests.
3. Publishes media to Blob Storage.
4. Publishes generated JSON content to Blob Storage.
5. Builds the React app.
6. Packages `dist/` with `webapp/server.cjs`.
7. Deploys to Azure App Service Web App.
8. Checks the shared API at `/api/{siteid}/home`.

Do not add a site-local API deployment workflow.
