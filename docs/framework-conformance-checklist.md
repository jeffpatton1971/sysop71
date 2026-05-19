# Framework Conformance Checklist

Use this checklist before opening a migration pull request and before each
production deployment.

## Identity

- `content/site.config.json` has the real site id in `key`.
- `CONTENT_SITE_KEY` and `VITE_API_SITE_ID` are identical.
- No code path silently falls back to another site's id.
- API routes use `/api/{siteid}/...`.

## Repository Shape

Required source/runtime files:

- `.github/workflows/pr-ci.yml`
- `.github/workflows/publish.yml`
- `content/site.config.json`
- `content/taxonomy.aliases.json`
- `content/media/index.json`
- `_posts/`
- `src/`
- `scripts/`
- `tests/`
- `webapp/`
- `index.html`
- `package.json`
- `vite.config.ts`

Generated or local-only paths must stay out of Git:

- `.tmp/`
- `dist/`
- `public/content/`
- `node_modules/`
- `test-results/`
- `playwright-report/`

Forbidden site-runtime leftovers:

- `api/`
- `_config.yml`
- `_data/`
- `_includes/`
- `_layouts/`
- `_pages/`
- `_sass/`
- `_site/`
- `Gemfile`
- `Gemfile.lock`
- GitHub Pages or Jekyll deployment workflows

## GitHub Environment

The site repository has a `Production` environment.

Environment secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Environment variables:

- `AZURE_WEBAPP_NAME`
- `AZURE_WEBAPP_RESOURCE_GROUP`
- `AZURE_WEBAPP_URL`
- `AZURE_API_BASE_URL`
- `VITE_API_BASE_URL`
- `VITE_API_SITE_ID`
- `CONTENT_SITE_KEY`
- `CONTENT_SITE_URL`
- `CONTENT_STORAGE_ACCOUNT`
- `CONTENT_STORAGE_CONTAINER`
- `CONTENT_STORAGE_PREFIX`
- `REQUIRE_API_VERIFICATION`

The Azure federated credential subject must be:

```text
repo:<owner>/<repo>:environment:Production
```

## Azure

- The frontend resource is an Azure App Service Web App running Node 22 LTS on Linux.
- The frontend Web App starts `webapp/server.cjs`.
- The frontend Web App does not host Azure Functions.
- The service principal has `Website Contributor` on the frontend Web App or resource group.
- The service principal has `Storage Blob Data Contributor` on the storage account or container.
- Generated content is published to the configured storage prefix.
- The shared API has a matching `CONTENT_BASE_URL_TEMPLATE`, site map, or site-specific setting.
- Function App CORS allows the frontend origin.

## Validation

Run locally:

```powershell
npm ci
npm run content:validate
npm run build
npm run test
git diff --check
git status --short
```

Verify deployed frontend:

```text
https://<frontend-host>/
https://<frontend-host>/posts
https://<frontend-host>/stories
https://<frontend-host>/galleries
https://<frontend-host>/images
https://<frontend-host>/search
```

Verify shared API:

```text
https://ptech-sites-api.azurewebsites.net/api/<siteid>/health
https://ptech-sites-api.azurewebsites.net/api/<siteid>/home
https://ptech-sites-api.azurewebsites.net/api/<siteid>/posts
https://ptech-sites-api.azurewebsites.net/api/<siteid>/stories
https://ptech-sites-api.azurewebsites.net/api/<siteid>/galleries
https://ptech-sites-api.azurewebsites.net/api/<siteid>/images
https://ptech-sites-api.azurewebsites.net/api/<siteid>/search?q=test
```

Set `REQUIRE_API_VERIFICATION=true` only after the shared API routes are stable.
