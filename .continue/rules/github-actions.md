# GitHub Actions

- This repo has two workflow categories:
  - **Site CI/CD**: `pr-ci.yml`, `publish.yml`
  - **Ops/notification automations**: stream/game/post/youtube workflows
- Prefer changing only the workflow category relevant to the task.

## CI/CD specifics

- Keep Node version aligned to workflow (`22`) and local tooling.
- Keep content validation + tests in PR gating.
- Keep publish steps in order: validate/test -> publish content/media -> build -> deploy -> verify.
- Preserve required env variable names used by `publish.yml`.

## Legacy automation caution

- Some workflows still target legacy branches/triggers (e.g., `master`) and PowerShell-heavy flows.
- Verify before changing legacy notification workflows; they may support external posting pipelines.
- Do not hardcode secrets; continue using GitHub Secrets/Variables.
