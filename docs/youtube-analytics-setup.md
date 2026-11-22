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
Leaving all three mode flags (`check_connection_only`, `renew_authorization`,
and `collect_reports`) false retains the existing backfill behavior, which
writes to MongoDB. Selecting more than one mode runs no operation.

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

### Existing web client with localhost redirect

The owner identified **Github Workflow Client**, a web application in the
`valued-etching-121717` Google project. Its registered redirect is exactly
`http://localhost`. The app is External and In production, and the owner added
both required read-only scopes. These settings were observed in the owner's
Google Cloud screenshots; the workflow still independently checks the client
and channel before saving anything.

The local sign-in helper reuses the client secret already stored in GitHub:

```powershell
npm ci
npx tsx scripts/authorize-youtube.ts --client-id <copy the existing web client ID from Google Cloud>
```

Run it on the same computer as the browser, while signed in to GitHub CLI with
permission to manage this repository's Actions secrets and run workflows.
Local port 80 must be free. Open the printed Google sign-in link, select the
account that owns Sysop71 Gaming, select the channel if Google prompts, and
approve the two read-only permissions. The helper waits up to 15 minutes.

The helper uses a random state value and PKCE challenge, accepts the callback
only on the local loopback interface, and never prints the authorization code.
It uploads the one-time code and verifier through standard input into the
encrypted `YT_OAUTH_GRANT` GitHub repository secret and dispatches the branch's
backfill workflow with `renew_authorization=true`. No code or token is passed in
workflow inputs. The helper deletes this temporary secret after the run.

The renewal workflow exchanges that code using `YT_CLIENT_ID` and
`YT_CLIENT_SECRET`, checks the exact read-only scopes and authorized channel,
and verifies Analytics access. Only then does it save a new version of
`YouTube-RefreshToken` in the existing Key Vault. Its temporary token file is
removed and the Azure CLI secret response is suppressed. It does not change
client credentials, YouTube content, MongoDB, or scheduled workflow settings.

If the helper is interrupted after upload, inspect the run and then delete
`YT_OAUTH_GRANT` from repository Actions secrets. A used or expired code cannot
be reused; restart the helper to authorize again. If no refresh token is
returned, the workflow fails without updating Key Vault.

This limited personal tool can use Google's limited-audience verification
exception. A sensitive-scope verification form or unverified-app notice does
not by itself require submitting a public-app demo video. The owner must make
the Google sign-in/consent decision. See [Google's verification exceptions](https://support.google.com/cloud/answer/13464323).

An External consent app in **Testing** normally issues a refresh token that
expires after seven days for these scopes. Resolve the app's publishing status
before planning unattended collection. Inactivity can also expire a refresh token
after six months. Do not infer the exact reason from `invalid_grant` alone.

The legacy renewal workflow writes a new Key Vault secret version and does not
suppress the Azure CLI secret-write response. Review that logging before enabling
it. A collector normally refreshes its access token as needed; a separate daily
job to rewrite the refresh token is unnecessary.

## Collect reports locally

The local command starts an on-demand GitHub Actions collection using the
existing Key Vault grant, waits for the run, and saves JSON/CSV reports on this
computer. It does not require local copies of the Google client secret or refresh
token, Azure CLI, or MongoDB. It requires Node 22 or newer, repository dependencies
(`npm ci`), and GitHub CLI signed in with permission to run Actions and download
artifacts from `jeffpatton1971/sysop71`.

```powershell
npm run youtube:collect -- --start 2026-09-01 --end 2026-11-20
```

Until this draft is merged, the default workflow branch is
`codex/youtube-local-analytics`. After merge, pass `--ref main`. Choose a window
of 1–90 days. Reports are saved in a unique folder under `.tmp/youtube-reports/`,
which is excluded from Git and the website build. No schedule is enabled.

Because the repository is public, the runner encrypts the report bundle with a
new RSA-3072 public key supplied by the local command and AES-256-GCM. Only the
encrypted bundle is uploaded as an artifact, retained for one day. The private
key stays in the local command's memory. Google tokens and credentials never
enter the report bundle. The local command decrypts the bundle and writes:

| File | Contents |
| --- | --- |
| `reports.json` | Original API headers/rows, exact queries, requested dates, collection timestamp, notes, and per-report status |
| `manifest.json` | Collection status, workflow link, report row counts, observed date bounds, and failed reports |
| `total.csv` | Channel totals for the requested window |
| `daily.csv` | Daily channel metrics |
| `daily-by-format.csv` | Daily metrics using Google's `creatorContentType` classification |
| `top-videos.csv` | Top 200 videos; this ranking is capped, not an exhaustive catalogue. Use daily reports for content-type classification. |
| `traffic-by-day-format.csv` | Traffic sources by day and content type |
| `devices-by-day-format.csv` | Device types by day and content type |
| `video-metadata.csv` | Current video IDs, titles, UTC publication timestamps, and ISO 8601 durations |
| `video-daily.csv` | Combined per-video daily metrics from batches of up to 50 video IDs |
| `video-daily-NNN.csv` | Individual batch results, traceable to exact queries in JSON |

The daily/content reports include views, engaged views, watch minutes, average
view duration, average percentage viewed, subscribers gained, and subscribers
lost. Traffic/device reports use the smaller supported metric set. Failed reports
are marked as errors; successful reports are still saved, and the command exits
with a failure status for a partial collection. Fix the failed request and rerun
before treating a partial bundle as complete.

Do not close the local command while it waits. If it is interrupted, its in-memory
private key is lost and the encrypted artifact cannot be recovered; run a fresh
collection. No API metrics are printed in public workflow logs. Ordinary local
JSON/CSV files contain private channel analytics and stay in the local ignored
directory (which may still follow the owner's existing OneDrive synchronization).

### Interpreting the output

- Analytics days use Pacific time (`America/Los_Angeles`). Metadata publication
  timestamps remain UTC. Convert timestamps to Pacific time before joining by day.
- The requested end date is not a guarantee of data availability. Observe the
  returned dates, especially for recent data. Missing rows are not filled as zeros.
- The metadata catalogue is current and can include videos outside the requested
  window. Missing/deleted items and different subscriber attribution can prevent
  per-video sums from exactly matching channel totals.
- Preserve Google's metric definitions across the November 16 reporting change.
  Do not use watch time divided by public views as a replacement for average view
  duration. A device breakdown does not provide a co-view correction by itself.
- Impressions/CTR, Shorts feed exposure, and co-view rate still require Studio
  exports when unsupported by these Analytics API report definitions.
- Reports describe aggregate viewing. They do not identify individual viewers or
  establish conversion from a specific Short into its companion full episode.

## Validation

### Weekly and monthly history

Build the private report archive from successful local collections:

```powershell
npm run youtube:reports -- --as-of 2026-11-22
```

The default archive is `../youtube-report-archive`, outside this public repository.
It contains an HTML index, readable reports with daily charts, report JSON, and
durable copies of the source bundles. Use `--archive <path>` to choose another
private location. The default as-of date uses America/Chicago.

The owner's Codex chat schedules the weekly report for Sunday at 00:00 Central
and the monthly report for the first day at 00:00 Central. These are chat
automations, not additional GitHub cron workflows. Each refresh collects the
latest 90 inclusive days (never earlier than September 1, 2026), then rebuilds
the archive. Sources preserve older dates beyond that moving collection window.

- Weeks run Sunday through Saturday, starting with the partial September 1–5
  week. A week still in progress can exist to support month-end accumulation.
- Months are calendar months. Their totals accumulate the weekly reports' daily
  records clipped to the month's boundaries, including any closing partial week.
  Whole cross-boundary weeks are never added to both months.
- Missing dates stay missing. Reports remain provisional until every channel
  reporting day is present. Later collections replace overlapping daily records
  with newer observations and rebuild affected reports without double counting.
- Historical reports are reconstructed using data available now, not represented
  as snapshots captured on their original scheduled dates. The JSON retains
  per-day collection timestamps and source request IDs.
- Watch time is explicitly the sum of daily integer-minute API rows and can
  differ from an independent aggregate query. Format comparisons remain separate;
  monthly growth uses per-day rates to account for unequal month lengths.
- Saved reports include evidence-linked experiment suggestions. Scheduled chat
  runs synthesize the current report and recent history, with measurable growth
  ideas and a clear distinction between observations and hypotheses.

The initial November 22 backfill creates 12 weekly reports and two monthly
reports (September and October). The November 15–21 week is provisional in the
initial source collection because November 20–21 have not been returned.

### Checks

```powershell
npm ci
npm run youtube:test
npx tsc -p tsconfig.node.json
```

Tests launch PowerShell with mocked Google and Azure responses. They cover
successful and empty reports, missing/broad scopes, wrong-channel selection,
OAuth/API errors, safe error-code reporting, secret redaction, and job selection.
Authorization tests also check callback state, the PKCE challenge, expired and
mismatched grants, token-file cleanup, and that only a fully validated token
can reach the Key Vault write.
History tests cover the initial short week, delayed dates, replacement of revised
observations, current-day exclusion, and monthly accumulation across week/month
boundaries without duplicate days.

## References

- [Google authorization for YouTube APIs](https://developers.google.com/youtube/reporting/guides/authorization)
- [Analytics queries and read-only scopes](https://developers.google.com/youtube/analytics/reference/reports/query)
- [Google refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
