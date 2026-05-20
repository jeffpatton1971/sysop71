# Coding Standards

- Language stack: TypeScript (`strict: true`), React 19, Vite 8.
- Keep code in ESM style for site/scripts; `webapp/server.cjs` is intentionally CommonJS.
- Use existing path alias `@/*` for `src/*` imports.
- Follow existing style:
  - 2-space indentation
  - semicolons
  - single quotes
  - explicit exported types for API/domain models

## API and domain rules

- All API calls must flow through `src/content.ts` patterns.
- Keep shared API route shape: `/api/{siteid}/...`.
- Do not introduce fallback site ids; fail clearly if site id is missing.
- Preserve existing content types/contracts (`post`, `story`, `gallery`, image/search/taxonomy shapes).

## Dependency and framework rules

- Prefer existing dependencies/utilities over adding new packages.
- Keep shadcn/radix/lucide patterns consistent with existing components.
- Do not replace framework scripts/workflows with ad-hoc alternatives.

## Error handling and logging

- Surface actionable errors (e.g., include URL/status for fetch failures like `src/content.ts`).
- In scripts, keep validation errors structured and actionable.
- In server/workflow code, fail fast on missing required environment values.

## Agent must not do

- Do not invent file paths, APIs, env var names, or content schema fields.
- Do not add API deployment/runtime code to this repo.
- Do not commit generated artifacts (`dist/`, `public/content/`, `.tmp/`, reports).
- Do not alter unrelated notification workflows unless explicitly requested.
