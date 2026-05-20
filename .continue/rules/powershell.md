# PowerShell Guidance

- PowerShell is used mainly in legacy/ops GitHub workflows (especially YouTube/token/notification tasks).
- Keep shell choice explicit in workflows (`shell: pwsh` when required).
- Preserve existing Azure CLI + Key Vault + env export patterns unless migration is explicitly requested.
- Prefer safe failure handling (`Write-Error`, explicit `exit 1`) for missing secrets/tokens.
- Do not print sensitive values (tokens, client secrets, connection strings).
- Verify before changing module usage (e.g., `PoshMongo`) or Windows runner dependencies.
