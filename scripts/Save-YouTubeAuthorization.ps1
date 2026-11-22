# Run only in the manual authorization workflow. Never print raw HTTP errors.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$stage = 'validating the one-time authorization'
$summary = [System.Collections.Generic.List[string]]::new()
$summary.Add('## YouTube authorization renewal')
$tokenFile = $null
try {
  foreach ($name in @('YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_OAUTH_GRANT', 'KEY_VAULT_NAME', 'CHANNEL_ID')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw 'Required configuration missing.' }
  }
  $grant = $env:YT_OAUTH_GRANT | ConvertFrom-Json
  if ($grant.code) { Write-Output "::add-mask::$($grant.code)" }
  if ($grant.verifier) { Write-Output "::add-mask::$($grant.verifier)" }
  if ($grant.clientId -cne $env:YT_CLIENT_ID -or $grant.channelId -cne $env:CHANNEL_ID) { throw 'Client or channel mismatch.' }
  if ($env:CHANNEL_ID -notmatch '^UC[A-Za-z0-9_-]{22}$') { throw 'Invalid channel ID.' }
  if ($grant.redirectUri -cne 'http://localhost') { throw 'Unexpected redirect URI.' }
  if ([string]::IsNullOrWhiteSpace($grant.code) -or $grant.verifier -notmatch '^[A-Za-z0-9_-]{43,128}$') { throw 'Invalid authorization payload.' }
  $age = [datetimeoffset]::UtcNow - [datetimeoffset]::Parse($grant.createdAt)
  if ($age.TotalMinutes -gt 10 -or $age.TotalSeconds -lt -60) { throw 'Authorization payload expired.' }

  $stage = 'exchanging the authorization code with Google'
  $token = Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
    client_id = $env:YT_CLIENT_ID
    client_secret = $env:YT_CLIENT_SECRET
    code = $grant.code
    code_verifier = $grant.verifier
    redirect_uri = $grant.redirectUri
    grant_type = 'authorization_code'
  }
  if ($token.access_token) { Write-Output "::add-mask::$($token.access_token)" }
  if ($token.refresh_token) { Write-Output "::add-mask::$($token.refresh_token)" }
  if ([string]::IsNullOrWhiteSpace($token.access_token) -or [string]::IsNullOrWhiteSpace($token.refresh_token)) { throw 'Google did not return both tokens.' }
  $summary.Add('- Google returned a new refresh token using the existing OAuth client.')

  $stage = 'verifying the read-only permissions'
  $info = Invoke-RestMethod -Uri ('https://oauth2.googleapis.com/tokeninfo?access_token=' + [uri]::EscapeDataString($token.access_token))
  $scopes = @($info.scope -split ' ' | Where-Object { $_ })
  $required = @('https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly')
  if (@($required | Where-Object { $_ -notin $scopes }).Count -or @($scopes | Where-Object { $_ -notin $required }).Count) { throw 'Scope mismatch.' }
  $summary.Add('- Granted scopes: exactly youtube.readonly and yt-analytics.readonly.')

  $stage = 'verifying Sysop71 Gaming channel access'
  $headers = @{ Authorization = "Bearer $($token.access_token)" }
  $channels = Invoke-RestMethod -Uri 'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true' -Headers $headers
  if ($env:CHANNEL_ID -notin @($channels.items.id)) { throw 'Authorized channel does not match CHANNEL_ID.' }
  $summary.Add('- Authorized channel matches the configured Sysop71 Gaming channel ID.')

  $stage = 'verifying YouTube Analytics access'
  $query = @{
    ids = "channel==$($env:CHANNEL_ID)"
    startDate = '2026-09-01'
    endDate = '2026-09-10'
    dimensions = 'day'
    metrics = 'views,engagedViews,estimatedMinutesWatched'
    sort = 'day'
  }
  $queryString = ($query.GetEnumerator() | ForEach-Object { [uri]::EscapeDataString($_.Key) + '=' + [uri]::EscapeDataString($_.Value) }) -join '&'
  $report = Invoke-RestMethod -Uri ("https://youtubeanalytics.googleapis.com/v2/reports?$queryString") -Headers $headers
  if (-not $report.columnHeaders) { throw 'Analytics response missing headers.' }
  $summary.Add('- Analytics request succeeded; no private metric values were logged.')

  $stage = 'saving the verified refresh token in Key Vault'
  # Avoid putting the refresh token in CLI arguments or emitting the secret response.
  $tokenFile = Join-Path $env:RUNNER_TEMP ([guid]::NewGuid().ToString() + '.txt')
  [System.IO.File]::WriteAllText($tokenFile, $token.refresh_token)
  az keyvault secret set --vault-name $env:KEY_VAULT_NAME --name 'YouTube-RefreshToken' --file $tokenFile --encoding utf-8 --output none --only-show-errors 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Key Vault write failed.' }
  $summary.Add('- Saved a new version of YouTube-RefreshToken in the existing Key Vault.')
  $summary.Add('- OAuth client credentials and scheduled workflows were not changed.')
} catch {
  $status = $null
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  $summary.Add("- FAILED while $stage$(if ($status) { " (HTTP $status)" }).")
  $summary.Add('- No unverified token was intentionally saved. Raw error bodies were withheld.')
  Write-Host "::error::YouTube authorization failed while $stage. See the run summary."
  exit 1
} finally {
  if ($tokenFile -and (Test-Path -LiteralPath $tokenFile)) { Remove-Item -LiteralPath $tokenFile -Force }
  $summary -join "`n" | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
  foreach ($line in $summary) { Write-Host $line }
}
