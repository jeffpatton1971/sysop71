const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const scenario of ['success', 'expired', 'client-mismatch', 'no-refresh-token', 'extra-scope', 'wrong-channel', 'analytics-failed']) {
  test(`token storage: ${scenario}`, () => {
    const directory = fs.mkdtempSync(path.resolve('.tmp/youtube-save-'));
    const summary = path.join(directory, 'summary.md');
    const harness = path.join(directory, 'harness.ps1');
    fs.writeFileSync(harness, `
      $env:YT_CLIENT_ID = 'fake-client'
      $env:YT_CLIENT_SECRET = 'private-client-secret'
      $env:KEY_VAULT_NAME = 'fake-vault'
      $env:CHANNEL_ID = 'UCPnbKK1hVXihEXLBOHhLRbg'
      $createdAt = [datetimeoffset]::UtcNow.ToString('o')
      if ($env:SCENARIO -eq 'expired') { $createdAt = [datetimeoffset]::UtcNow.AddMinutes(-20).ToString('o') }
      $clientId = $env:YT_CLIENT_ID
      if ($env:SCENARIO -eq 'client-mismatch') { $clientId = 'different-client' }
      $env:YT_OAUTH_GRANT = @{ clientId = $clientId; channelId = $env:CHANNEL_ID; code = 'private-code'; verifier = ('z' * 64); redirectUri = 'http://localhost'; createdAt = $createdAt } | ConvertTo-Json -Compress
      function az {
        $fileIndex = [array]::IndexOf($args, '--file')
        $outputIndex = [array]::IndexOf($args, '--output')
        if ($fileIndex -lt 0 -or $args[$outputIndex + 1] -ne 'none') { throw 'Unsafe Key Vault write' }
        $content = [System.IO.File]::ReadAllText($args[$fileIndex + 1])
        if ($content -ne 'private-refresh-token') { throw 'Wrong token' }
        Set-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'saved.txt') -Value 'verified'
        $global:LASTEXITCODE = 0
      }
      function Invoke-RestMethod {
        param($Method, $Uri, $ContentType, $Body, $Headers)
        if ($Uri -eq 'https://oauth2.googleapis.com/token') {
          if ($env:SCENARIO -eq 'no-refresh-token') { return @{ access_token = 'private-access-token' } }
          return @{ access_token = 'private-access-token'; refresh_token = 'private-refresh-token' }
        }
        if ($Uri.StartsWith('https://oauth2.googleapis.com/tokeninfo?')) {
          $scope = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly'
          if ($env:SCENARIO -eq 'extra-scope') { $scope += ' https://www.googleapis.com/auth/youtube' }
          return @{ scope = $scope }
        }
        if ($Uri.StartsWith('https://www.googleapis.com/youtube/v3/channels?')) {
          if ($env:SCENARIO -eq 'wrong-channel') { return @{ items = @(@{ id = 'other' }) } }
          return @{ items = @(@{ id = $env:CHANNEL_ID }) }
        }
        if ($Uri.StartsWith('https://youtubeanalytics.googleapis.com/v2/reports?')) {
          if ($env:SCENARIO -eq 'analytics-failed') { throw 'private-access-token' }
          return @{ columnHeaders = @(@{ name = 'day' }); rows = @() }
        }
        throw 'Unexpected request'
      }
      & $env:CHECK_SCRIPT
      exit $LASTEXITCODE
    `);
    const result = spawnSync('pwsh', ['-NoProfile', '-File', harness], {
      encoding: 'utf8', env: { ...process.env, SCENARIO: scenario, RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: summary, CHECK_SCRIPT: path.resolve('scripts/Save-YouTubeAuthorization.ps1') },
    });
    const output = (result.stdout + result.stderr).split(/\r?\n/).filter(line => !line.startsWith('::add-mask::')).join('\n');
    const text = fs.readFileSync(summary, 'utf8');
    for (const secret of ['private-code', 'private-client-secret', 'private-refresh-token', 'private-access-token']) {
      assert.ok(!output.includes(secret), output);
      assert.ok(!text.includes(secret));
    }
    assert.equal(result.status, scenario === 'success' ? 0 : 1, output);
    assert.equal(fs.existsSync(path.join(directory, 'saved.txt')), scenario === 'success', 'Only a fully verified grant may update Key Vault');
    assert.deepEqual(fs.readdirSync(directory).filter(name => name.endsWith('.txt') && name !== 'saved.txt'), [], 'Temporary token file must be removed');
  });
}
