# Testing

- Primary test suite: Playwright smoke tests in `tests/site/site-smoke.spec.ts`.
- Test config: `playwright.config.ts`.
- Tests run against preview server (`npm run preview -- --host 127.0.0.1 --port 4173`).
- API is mocked in tests via `page.route('**/api/**', ...)` and `public/content` fixture data.

## Commands

- Install deps: `npm ci`
- Validate content: `npm run content:validate`
- Full test flow: `npm run test`
- Site test flow only: `npm run test:site`
- Install Playwright browser when needed: `npx playwright install --with-deps chromium`

## Expectations when changing behavior

- Update/add Playwright coverage for route/UI behavior changes.
- Keep tests user-visible and route-focused (home, posts, search patterns already exist).
- Keep test names descriptive (`<page/feature> <expected behavior>` pattern).
- If content contract changes, run `content:validate` and confirm generated content-dependent tests still pass.
