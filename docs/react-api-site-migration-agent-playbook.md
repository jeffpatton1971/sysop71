# React/API Site Migration Agent Playbook

This document is written for ChatGPT, Codex, GitHub Copilot coding agent, or a
similar AI agent. Drop it into a legacy GitHub Pages/Jekyll-style site repo and
use it as the migration contract for moving that site to the shared React site
and `ptech-sites-api` architecture.

For repeatable seeding, use the repo template kit in
`templates/react-api-site/`. It contains placeholder scaffold files, an apply
script, and a conformance checklist that should be copied into every migrated
site repo.

Important: this is not a prompt to build a similar React app. The migrated repo
must use the reference site framework files and generated-content contract. Do
not invent alternate package scripts, alternate JSON shapes, a simpler React
shell, or a custom publish workflow unless the framework itself is being changed
first.

## Mission

Convert the repository from a GitHub Pages/Jekyll blog into a React site that:

- builds generated content JSON from authored Markdown,
- deploys the React app to Azure App Service Web App,
- publishes generated content and media to Azure Blob Storage,
- reads content through the shared API at `/api/{siteid}/...`,
- supports posts, stories, galleries, and images,
- keeps source content in Git and generated/runtime assets out of Git unless a
  checked-in source manifest is explicitly required.

Do not deploy an API from the site repo. The shared API lives in
`ptech-sites-api` and must serve this site by site id.

## Framework Source Of Truth

Use the current reference site repo as the source of truth for framework code.
At the time this playbook was written, that reference is `kansaspattons`.

Framework-owned paths must be copied from the reference repo, not reimplemented:

```text
src/
scripts/
tests/
webapp/
.github/workflows/pr-ci.yml
.github/workflows/publish.yml
components.json
index.html
package.json
package-lock.json
playwright.config.ts
tsconfig.app.json
tsconfig.json
tsconfig.node.json
vite.config.ts
```

After copying, make only site-specific substitutions:

- package name,
- `content/site.config.json`,
- smoke-test expected site title/search term,
- documentation text,
- optional theme/branding values.

Do not replace the framework app with a minimal React app that dumps JSON. Do
not replace TypeScript scripts with smaller `.mjs` equivalents. Do not upload
`public/content` with ad hoc Azure CLI commands when the framework publish
scripts already own that behavior.

## Required Inputs

Before changing files, identify or ask for these values:

| Value | Example | Notes |
| --- | --- | --- |
| Site id | `kansaspattons` | Lowercase letters, numbers, and hyphens. This becomes `CONTENT_SITE_KEY` and `VITE_API_SITE_ID`. |
| Site title | `KansasPattons` | Used in `content/site.config.json` and generated `site.json`. |
| Canonical site URL | `https://kansaspattons.azurewebsites.net` | Use the final custom domain when ready. |
| Azure Web App name | `kansaspattons` | Existing or new App Service Web App for the React frontend. |
| Azure Web App resource group | `WebApplications` | Resource group that contains the Web App. |
| Shared API URL | `https://ptech-sites-api.azurewebsites.net` | Must already serve `/api/{siteid}/...` after API config is updated. |
| Storage account | `prdwebappstorage` | Blob account for generated JSON and media. |
| Storage container | `kansaspattons` or `sites` | Per-site container or shared container. |
| Storage prefix | `current` or `content/{siteid}/current` | Must match the API repo content base URL template. |
| Source format | Jekyll posts, WordPress export, Instagram export, Facebook export | Determines importer strategy. |
| Media source paths | `assets/`, `images/`, export folders | Needed for image migration. |

Fail early if the site id is missing. Do not silently fall back to a default
site id.

## Target Repository Shape

Create or preserve this shape in the site repo:

```text
.github/workflows/
  pr-ci.yml
  publish.yml
content/
  site.config.json
  taxonomy.aliases.json
  media/index.json
_posts/
  yyyy-mm-dd-slug.md
docs/
  react-api-site-migration-agent-playbook.md
public/
  content/              # generated, gitignored
scripts/
src/
tests/
webapp/
index.html
package.json
vite.config.ts
```

Remove Jekyll rendering/runtime files after the React build is working:

```text
_config.yml
_data/
_includes/
_layouts/
_pages/
_sass/
_site/
*.html archive pages generated only for Jekyll
.github/workflows/pages*.yml
.github/workflows/jekyll*.yml
Gemfile
Gemfile.lock
```

Keep `_posts/` unless the migration also rewrites the content compiler to use a
new source folder. In this architecture, `_posts/` is authored source content,
not a Jekyll runtime dependency.

Run the framework drift check from the reference repo after applying the
template:

```powershell
.\templates\react-api-site\check-framework.ps1 -TargetRepo C:\code\sites\<target>
```

This check must pass before the migration is considered framework-aligned.

## GitHub Setup

Create a `Production` environment in the site GitHub repository.

Add these environment secrets:

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
```

Add these environment variables:

```text
AZURE_WEBAPP_NAME=<frontend-webapp-name>
AZURE_WEBAPP_RESOURCE_GROUP=<frontend-resource-group>
AZURE_WEBAPP_URL=https://<frontend-webapp-name>.azurewebsites.net
AZURE_API_BASE_URL=https://ptech-sites-api.azurewebsites.net
VITE_API_BASE_URL=https://ptech-sites-api.azurewebsites.net
VITE_API_SITE_ID=<siteid>
CONTENT_SITE_KEY=<siteid>
CONTENT_SITE_URL=https://<frontend-webapp-name>.azurewebsites.net
CONTENT_STORAGE_ACCOUNT=<storage-account>
CONTENT_STORAGE_CONTAINER=<container>
CONTENT_STORAGE_PREFIX=<prefix>
REQUIRE_API_VERIFICATION=false
```

Set `REQUIRE_API_VERIFICATION=true` only after the shared API successfully
returns:

```text
https://ptech-sites-api.azurewebsites.net/api/<siteid>/health
https://ptech-sites-api.azurewebsites.net/api/<siteid>/home
```

The site workflow must have:

```yaml
permissions:
  contents: write
  id-token: write
```

The `Production` environment causes the GitHub OIDC subject to be:

```text
repo:<owner>/<repo>:environment:Production
```

Create or update the Azure Entra app registration federated credential with:

```text
Issuer: https://token.actions.githubusercontent.com
Subject: repo:<owner>/<repo>:environment:Production
Audience: api://AzureADTokenExchange
```

Assign the Entra service principal:

- `Website Contributor` on the frontend Web App or its resource group.
- `Storage Blob Data Contributor` on the storage account or site container.

The API repository needs its own federated credential for its own repo subject.
Do not reuse the site repo subject for the API repo.

## Azure Setup

Create or verify the frontend Web App:

- Resource type: Azure App Service Web App.
- Runtime stack: Node 22 LTS on Linux.
- HTTPS only: enabled.
- Startup: the package includes `webapp/server.cjs`; no API runtime is hosted
  here.

Create or verify Blob Storage:

- Raw media prefix: `images/`
- Thumbnail/poster prefix: `thumbs/`
- Generated content prefix: the selected `CONTENT_STORAGE_PREFIX`
- CORS: allow the frontend and API origins if direct browser access to blobs is
  required.

Configure the shared API repo separately so the API can resolve this site id.
Preferred API setting:

```text
CONTENT_BASE_URL_TEMPLATE=https://<storage-account>.blob.core.windows.net/<container>/{site}/current/
```

If using a shared `sites` container and default prefix:

```text
CONTENT_BASE_URL_TEMPLATE=https://<storage-account>.blob.core.windows.net/sites/content/{site}/current/
```

If using per-site containers or nonstandard prefixes, configure the API repo
with a site map or site-specific setting as documented in `ptech-sites-api`.

## File Migration Steps

1. Apply the seed template from the reference repo:

```powershell
Copy-Item .\templates\react-api-site\variables.example.json .\.tmp\<siteid>.vars.json
# Edit .tmp\<siteid>.vars.json
.\templates\react-api-site\apply-template.ps1 `
  -TargetRepo C:\code\sites\<siteid> `
  -VariablesPath .\.tmp\<siteid>.vars.json
```

2. Copy the React site application files from the reference site repo into the
   target repo. These are framework-owned files; copy them directly rather than
   hand-porting behavior:

```text
src/
scripts/
tests/
webapp/
components.json
index.html
package.json
package-lock.json
playwright.config.ts
tsconfig*.json
vite.config.ts
```

3. Patch site-specific values:

- `package.json` package name.
- top-level package name in `package-lock.json`.
- `webapp/package.json` package name.
- `content/site.config.json`.
- `content/media/index.json`.
- smoke-test expected site title and a search term that exists in the target
  content.

4. Preserve or import authored content into `_posts/`.

5. Create or update `content/site.config.json`:

```json
{
  "key": "<siteid>",
  "title": "<Site Title>",
  "url": "https://<frontend-host>",
  "nav": [
    { "label": "Home", "href": "/" },
    { "label": "Posts", "href": "/posts" },
    { "label": "Stories", "href": "/stories" },
    { "label": "Galleries", "href": "/galleries" },
    { "label": "Images", "href": "/images" },
    { "label": "Search", "href": "/search" }
  ],
  "author": {
    "name": "",
    "imageUrl": "/assets/images/bio-photo.jpg"
  },
  "footer": {
    "brandText": "<Site Title>"
  }
}
```

6. Create `content/taxonomy.aliases.json` with empty families if there are no
   known aliases:

```json
{
  "categories": {},
  "hashtags": {},
  "people": {},
  "locations": {}
}
```

7. Create `content/media/index.json`:

```json
{
  "schemaVersion": "2026-05-15",
  "generatedAt": "2026-05-18T00:00:00.000Z",
  "site": {
    "key": "<siteid>",
    "title": "<Site Title>"
  },
  "storage": {
    "accountName": "<storage-account>",
    "containerName": "<container>",
    "baseUrl": "https://<storage-account>.blob.core.windows.net/<container>",
    "rawPrefix": "images",
    "thumbPrefix": "thumbs"
  },
  "assets": []
}
```

8. Create or update `.gitignore`:

```text
.tmp/
.instagram/
.facebook/
node_modules/
.vite/
dist/
public/content/
test-results/
playwright-report/
```

9. Create `.github/workflows/pr-ci.yml` and `.github/workflows/publish.yml`
   using the reference repo workflows. The publish workflow must deploy the
   React site to Azure Web App and must not deploy `api/`.

10. Run the framework drift check. Fix every failure before continuing.

## Generated Content Contract

The shared API does not read arbitrary flat JSON files. The site build must
produce the same generated-content shape as the reference framework.

Required generated files include:

```text
public/content/site.json
public/content/home.json
public/content/entries/index.json
public/content/posts/index.json
public/content/posts/{year}/{month}/{day}/{slug}.json
public/content/stories/index.json
public/content/stories/{year}/{month}/{day}/{slug}.json
public/content/galleries/index.json
public/content/galleries/{year}/{month}/{day}/{slug}.json
public/content/images/index.json
public/content/search/index.json
public/content/taxonomy/index.json
```

Some indexes may contain empty arrays for sites with no stories, galleries, or
images, but the API path shape must still exist where the framework expects it.

Do not generate only this simplified shape:

```text
public/content/posts.json
public/content/stories.json
public/content/search.json
```

That shape is not enough for `ptech-sites-api`.

The package scripts must include the framework names:

```text
build:content
content:validate
build
test
publish:plan
publish:media
publish:prepare
publish:content
publish:content:incremental
```

Do not rename `build:content` to `content:generate` or replace the publish
scripts with placeholders.

## Content Conversion Rules

Every authored Markdown document must have YAML frontmatter. Normalize to this
shape:

```yaml
---
content_type: post
title: Example Title
slug: example-title
post_id: 2026-05-18-example-title
date: 2026-05-18 10:00:00
status: published
authors: []
summary: ""
categories: []
hashtags: []
people: []
locations: []
cover_image:
images: []
related: []
legacy:
  source: jekyll
---
```

Use `content_type: post` for long-form blog entries.

Use `content_type: story` for social/imported short-form entries, Instagram
captions, Facebook timeline items, and other date-based micro-posts.

Use `content_type: gallery` for image collections. A gallery may have body
Markdown, but its primary payload is the `images` array.

Do not use topical `tags`. Convert tags to `hashtags` unless the tag is really
a site section, in which case use `categories`.

Convert people and places into `people` and `locations`; do not leave them as
categories.

Remove Jekyll-only frontmatter such as:

```yaml
layout:
permalink:
published:
comments:
share:
```

Convert `published: false` to:

```yaml
status: draft
```

Convert Jekyll gallery includes:

```liquid
{% include gallery.html id="pumpkin-patch" %}
```

to explicit frontmatter:

```yaml
related:
  - type: gallery
    id: pumpkin-patch-gallery
    rel: photos
```

If the include contains inline image paths and there is no gallery document,
create a gallery Markdown document with `content_type: gallery`.

## Post Example

```md
---
content_type: post
title: Pumpkin Patch
slug: pumpkin-patch
post_id: 2009-10-18-pumpkin-patch
date: 2009-10-18
status: published
authors:
  - Jeff Patton
summary: "A family trip to the pumpkin patch."
categories:
  - Family
hashtags:
  - pumpkinpatch
people:
  - Natalie
locations: []
cover_image: 2009/10/18/img58363.jpg
related:
  - type: gallery
    id: 2009-10-18-pumpkin-patch-gallery
    rel: photos
---

We had a great day at the pumpkin patch.
```

## Story Example

```md
---
content_type: story
title: Breakfast
slug: breakfast
post_id: 2026-04-12-105120-breakfast
date: 2026-04-12 10:51:20
status: published
authors: []
summary: "Breakfast."
categories: []
hashtags:
  - breakfast
people: []
locations: []
cover_image: 2026/04/12/breakfast-01.jpg
images:
  - id: 2026/04/12/breakfast-01.jpg
    alt: Breakfast.
    caption: Breakfast.
legacy:
  source: instagram
---

Breakfast.
```

## Gallery Example

```md
---
content_type: gallery
title: Pumpkin Patch
slug: pumpkin-patch
post_id: 2009-10-18-pumpkin-patch-gallery
date: 2009-10-18
status: published
authors:
  - Jeff Patton
summary: "Fourteen photos from the family pumpkin patch trip."
categories:
  - Family
hashtags:
  - pumpkinpatch
people:
  - Natalie
locations: []
cover_image: 2009/10/18/img58363.jpg
images:
  - id: 2009/10/18/img58363.jpg
    alt: Natalie at the pumpkin patch.
    caption:
  - id: 2009/10/18/img58393.jpg
    alt:
    caption:
legacy:
  source: jekyll-gallery
---
```

## Image And Media Migration

Inventory all source media before changing Markdown:

```powershell
Get-ChildItem -Recurse -File assets, images, galleries, uploads -ErrorAction SilentlyContinue |
  Select-Object FullName, Length
```

For each media asset:

1. Determine the owning content date. Prefer the post/story/gallery date.
2. Compute canonical id:

```text
yyyy/mm/dd/original-filename.ext
```

3. Upload raw file to:

```text
https://<storage-account>.blob.core.windows.net/<container>/images/yyyy/mm/dd/original-filename.ext
```

4. Generate thumbnail or poster and upload to:

```text
https://<storage-account>.blob.core.windows.net/<container>/thumbs/yyyy/mm/dd/original-filename.ext
```

5. Add or update the asset in `content/media/index.json`.
6. Rewrite Markdown `cover_image`, `images[].id`, and inline Markdown image
   references to the canonical id.

Use the built-in publish flow for new or changed local draft media:

```powershell
npm run publish:plan
npm run publish:media:dry-run
npm run publish:media
npm run publish:prepare
npm run publish:cleanup-media
npm run publish:cleanup-media:write
```

For a legacy bulk migration, write an idempotent script under `tools/` or
`scripts/` that:

- scans source media,
- hashes files with SHA-256,
- detects duplicate filenames and duplicate hashes,
- creates collision-safe canonical ids,
- uploads raw images and thumbnails,
- writes `content/media/index.json`,
- updates Markdown references,
- writes a migration report.

Do not delete original media until:

- the raw blob exists,
- the thumbnail/poster blob exists when expected,
- Markdown references were rewritten,
- `content/media/index.json` contains the asset,
- `npm run build` succeeds,
- spot checks show the image in the React app.

## Importing WordPress, Instagram, Or Facebook Exports

If export data exists, create importer scripts rather than hand-editing hundreds
of files.

WordPress:

- Convert exported posts to `content_type: post`.
- Preserve original publish date, title, slug, author, categories, and summary.
- Convert uploaded images to media assets.
- Convert WordPress image references to canonical media ids.
- Store old URLs in `legacy` metadata if useful for redirects.

Instagram:

- Convert single-caption items to `content_type: story`.
- Convert multi-image carousel items to a story plus associated image list, or a
  `gallery` when the image set is the primary content.
- Use the Instagram timestamp for `date`.
- Put captions in `summary` and body Markdown.
- Convert hashtags to normalized `hashtags`.

Facebook:

- Convert album records to `content_type: gallery`.
- Convert timeline posts with text to `story`.
- Preserve album title, caption, date, and source ids in `legacy`.
- Prefer album/post date for canonical media paths.

Importer scripts should emit reports under `tools/` and should be safe to rerun.

## Validation Commands

After each migration stage, run:

```powershell
npm ci
npm run content:validate
npm run build
npm run test
```

Also run:

```powershell
.\templates\react-api-site\check-framework.ps1 -TargetRepo C:\code\sites\<target>
```

Validation is not complete just because a custom build passes. The generated
content must satisfy `npm run content:validate`, and the framework drift check
must pass.

For publish dry runs:

```powershell
npm run publish:plan
npm run publish:content:dry-run
```

Before committing:

```powershell
git diff --check
git status --short
```

If Playwright fails because the browser is missing locally, install it:

```powershell
npx playwright install chromium
```

## First Deployment Sequence

1. Create Azure Web App and storage resources.
2. Configure GitHub `Production` environment secrets and variables.
3. Configure Azure OIDC federated credential and RBAC.
4. Configure `ptech-sites-api` so it can resolve this site id.
5. Run local validation commands.
6. Push the migration branch and open a pull request.
7. Confirm PR CI passes.
8. Merge to `main`.
9. Run the site `Publish` workflow.
10. Confirm frontend routes:

```text
https://<frontend-host>/
https://<frontend-host>/posts
https://<frontend-host>/stories
https://<frontend-host>/galleries
https://<frontend-host>/images
https://<frontend-host>/search
```

11. Confirm API routes:

```text
https://ptech-sites-api.azurewebsites.net/api/<siteid>/health
https://ptech-sites-api.azurewebsites.net/api/<siteid>/home
https://ptech-sites-api.azurewebsites.net/api/<siteid>/posts
https://ptech-sites-api.azurewebsites.net/api/<siteid>/stories
https://ptech-sites-api.azurewebsites.net/api/<siteid>/galleries
https://ptech-sites-api.azurewebsites.net/api/<siteid>/images
https://ptech-sites-api.azurewebsites.net/api/<siteid>/search?q=test
```

12. Set `REQUIRE_API_VERIFICATION=true` only after the API routes are stable.
13. Configure custom domain and DNS.
14. Remove old GitHub Pages settings only after the Azure Web App is verified.

## Redirects And Legacy URLs

Inventory legacy public URLs before removing GitHub Pages:

- `/YYYY/MM/DD/slug.html`
- `/blog/YYYY/MM/DD/slug.html`
- `/categories/...`
- `/tags/...`
- `/galleries/...`
- image URLs under `/assets`, `/uploads`, or old CDN paths

For each legacy URL pattern, decide whether to:

- preserve it in React routing,
- redirect it from the Web App host,
- store it in generated content as `legacyUrl`,
- accept a 404 for private/low-value migration debris.

Do not change DNS until high-value legacy URLs have a planned behavior.

## Agent Safety Rules

- Read the existing repo before editing.
- Copy framework files from the reference repo instead of rebuilding a lookalike.
- Do not delete `_posts/` unless replacing the content source and updating all
  scripts.
- Do not delete source media until uploaded blobs and rewritten Markdown are
  verified.
- Do not create API runtime code in the site repo.
- Do not support fallback site ids or ambiguous API route shapes.
- Use `/api/{siteid}/...` only.
- Do not generate flat `posts.json`/`search.json`-only content for the shared
  API.
- Do not deploy the whole repository as the Web App package; package `dist/`
  under `.tmp/webapp-package/public` with `webapp/server.cjs` and
  `webapp/package.json`.
- Keep generated `public/content/` out of Git unless the repo explicitly chooses
  to commit generated artifacts.
- Keep historical changelogs and iteration logs intact unless asked to curate
  them.
- Run validation before declaring the migration complete.

## Completion Criteria

The migration is complete when:

- `npm run build` succeeds.
- `npm run test` succeeds.
- `npm run content:validate` succeeds.
- The framework drift check succeeds.
- The site deploys to Azure Web App.
- Generated content and media publish to Blob Storage.
- The shared API returns `/api/{siteid}/home`.
- React pages render posts, stories, galleries, images, and search results.
- Jekyll runtime files and GitHub Pages workflows are removed.
- GitHub environment variables/secrets and Azure OIDC/RBAC are documented.
- Any intentionally retained legacy files are listed with reasons.

## Anti-Patterns That Mean The Migration Missed

If you see any of these, stop and realign with the reference framework:

- `src/App.jsx` is a tiny custom app that renders `<pre>{JSON.stringify(...)}</pre>`.
- package scripts use `content:generate` instead of `build:content`.
- generated content is only flat files such as `posts.json` and `search.json`.
- publish scripts only print placeholder messages.
- the workflow deploys `package: .` to Azure Web App.
- `webapp/server.cjs` serves `../dist` instead of the packaged `public` folder.
- the repo has an `api/` folder or deploys Azure Functions.
- `CONTENT_SITE_KEY` or `VITE_API_SITE_ID` falls back to another site's id.
- tests only validate frontmatter helpers and do not smoke test the rendered
  React site.

## Common Gaps To Check

These are easy to miss:

- DNS and custom domain cutover.
- Legacy URL redirects.
- Blob CORS and public/private access model.
- API repo site configuration for the new site id.
- Production `CONTENT_STORAGE_PREFIX` matching the API content base URL.
- Playwright browser installation in CI.
- GitHub environment protection rules that block workflow access to secrets.
- Large media files accidentally committed to Git.
- Duplicate image filenames from different dates or import sources.
- Draft/private posts accidentally marked `published`.
- Imported tags that should be people or locations.
