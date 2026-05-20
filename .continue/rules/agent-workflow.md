# Agent Workflow

- Search/read before editing (`docs/`, `content/`, `src/`, `tests/`, workflows, manifests).
- Summarize intended changes before editing.
- Prefer small, focused, reversible edits.
- Preserve existing patterns and file ownership boundaries.
- Do not invent file paths, APIs, classes, methods, config keys, or env vars.
- Keep API route pattern `/api/{siteid}/...` and explicit site id behavior.
- Update tests/docs when behavior or workflows change.
- Avoid editing generated/build output folders (`dist/`, `public/content/`, `.tmp/`, reports).
- Ask before large refactors, architecture shifts, or cross-workflow cleanup.
- If uncertain (especially in legacy notification workflows), mark **Verify before changing**.
