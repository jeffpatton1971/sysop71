# YouTube analytics connection

The existing integration uses repository secrets `YT_CLIENT_ID`,
`YT_CLIENT_SECRET`, `AZURE_CREDENTIALS`, and `AZURE_KEYVAULT_NAME`.
`CHANNEL_ID` is a repository variable, currently
`UCPnbKK1hVXihEXLBOHhLRbg` (Sysop71 Gaming). The refresh token is the
`YouTube-RefreshToken` secret in the configured Azure Key Vault.

GitHub credentials do not grant access to a YouTube channel. Google OAuth consent
grants that access. GitHub stores the settings used to authenticate.

## Test the existing connection

After the diagnostic is merged, run **Test YouTube Read-Only Connection** from
Actions. It has no schedule and does not write to YouTube, Key Vault, or MongoDB.
Its summary reports each completed stage without exposing tokens or metric values.

Before merging, run the existing **YouTube Backfill Metrics** workflow on the
diagnostic branch with `check_connection_only=true`:

```powershell
gh workflow run backfill-youtube-metrics.yml --repo jeffpatton1971/sysop71 --ref codex/youtube-local-analytics -f check_connection_only=true
```

The flag selects the diagnostic job and skips the original backfill job.
Omitting it retains the existing backfill behavior, which writes to MongoDB.

The check reads the existing refresh token, exchanges it for a short-lived access
token, validates the exact scopes below, checks the authorized channel against
`CHANNEL_ID`, and requests daily Analytics rows for September 1–10, 2026.
An empty report is recorded as unavailable/empty, not assumed to mean zero views.

Required scopes:

```text
https://www.googleapis.com/auth/youtube.readonly
https://www.googleapis.com/auth/yt-analytics.readonly
```

Extra scopes deliberately fail the permission check. A successful token exchange
does not by itself establish that a token is limited to read-only access.

## Renew a rejected refresh grant

`invalid_grant` indicates Google rejected the refresh grant. Expiration,
revocation, or a client/token mismatch can cause it; it does not establish that
the client ID or client secret needs replacement. `invalid_client` instead points
to client authentication.

1. Sign in to the [Google Cloud project selector](https://console.cloud.google.com/cloud-resource-manager)
   with the account used for the original integration.
2. In likely projects, inspect **Google Auth Platform → Clients** (or
   **APIs & Services → Credentials**) for the existing YouTube OAuth client.
   Record its application type. GitHub cannot display an existing secret's value.
3. Confirm **YouTube Analytics API** and **YouTube Data API v3** are enabled.
4. Use the authorization flow appropriate to the existing client type, requesting
   the two scopes above and offline access. The owner must sign in and select
   Sysop71 Gaming. A new refresh token requires user authorization; running the
   old refresh workflow cannot revive a rejected grant.
5. Validate the returned scopes and channel identity before storing a new version
   of `YouTube-RefreshToken` in the same Key Vault. Never put a token in an issue,
   workflow input, commit, log, or public artifact.
6. Rerun the diagnostic and confirm all stages pass before enabling collection.

An External consent app in **Testing** normally issues a refresh token that
expires after seven days for these scopes. Resolve the app's publishing status
before planning unattended collection. Inactivity can also expire a refresh token
after six months. Do not infer the exact reason from `invalid_grant` alone.

The legacy renewal workflow writes a new Key Vault secret version and does not
suppress the Azure CLI secret-write response. Review that logging before enabling
it. A collector normally refreshes its access token as needed; a separate daily
job to rewrite the refresh token is unnecessary.

Local collector implementation and a live data export remain pending a valid
read-only grant. The diagnostic does not publish analytics to the public site.

## Validation

```powershell
npm ci
node --test tests/youtube/connection-check.test.cjs
```

Tests launch PowerShell with mocked Google and Azure responses. They cover
successful and empty reports, missing/broad scopes, wrong-channel selection,
OAuth/API errors, safe error-code reporting, secret redaction, and job selection.

## References

- [Google authorization for YouTube APIs](https://developers.google.com/youtube/reporting/guides/authorization)
- [Analytics queries and read-only scopes](https://developers.google.com/youtube/analytics/reference/reports/query)
- [Google refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
