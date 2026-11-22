const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const workflow = yaml.load(fs.readFileSync('.github/workflows/test-youtube-readonly.yml', 'utf8'));
const caller = yaml.load(fs.readFileSync('.github/workflows/backfill-youtube-metrics.yml', 'utf8'));
const script = workflow.jobs['check-connection'].steps.find(step => step.run).run;
const directory = fs.mkdtempSync(path.resolve('.tmp/youtube-check-'));
const scriptFile = path.join(directory, 'check.ps1');
fs.writeFileSync(scriptFile, script);

test('manual diagnostic cannot execute the backfill job', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(caller.jobs['check-connection'].if, '${{ inputs.check_connection_only && !inputs.renew_authorization && !inputs.collect_reports }}');
  assert.equal(caller.jobs['backfill-youtube-metrics'].if, '${{ !inputs.check_connection_only && !inputs.renew_authorization && !inputs.collect_reports }}');
  assert.equal(caller.jobs['renew-authorization'].if, '${{ inputs.renew_authorization && !inputs.check_connection_only && !inputs.collect_reports }}');
  assert.equal(caller.jobs['collect-reports'].if, '${{ inputs.collect_reports && !inputs.check_connection_only && !inputs.renew_authorization }}');
  assert.equal(workflow.on.schedule, undefined);
});

for (const scenario of ['success', 'empty', 'missing-scope', 'broad-scope', 'wrong-channel', 'token-failure', 'invalid-grant', 'analytics-failure']) {
  test(`connection check: ${scenario}`, () => {
    const summary = path.join(directory, `${scenario}.md`);
    const harness = path.join(directory, `${scenario}.ps1`);
    fs.writeFileSync(harness, `
      $env:YT_CLIENT_ID = 'fake-client'
      $env:YT_CLIENT_SECRET = 'secret-client-value'
      $env:KEY_VAULT_NAME = 'fake-vault'
      $env:CHANNEL_ID = 'UCPnbKK1hVXihEXLBOHhLRbg'
      function az { $global:LASTEXITCODE = 0; return 'secret-refresh-value' }
      function Invoke-RestMethod {
        param($Method, $Uri, $ContentType, $Body, $Headers)
        if ($Uri -eq 'https://oauth2.googleapis.com/token') {
          if ($env:SCENARIO -eq 'token-failure') { throw 'secret-client-value secret-refresh-value' }
          if ($env:SCENARIO -eq 'invalid-grant') {
            $errorRecord = [System.Management.Automation.ErrorRecord]::new([Exception]::new('secret-refresh-value'), 'mock', 'InvalidOperation', $null)
            $errorRecord.ErrorDetails = [System.Management.Automation.ErrorDetails]::new('{"error":"invalid_grant","error_description":"secret-refresh-value"}')
            throw $errorRecord
          }
          return @{ access_token = 'secret-access-value' }
        }
        if ($Uri.StartsWith('https://oauth2.googleapis.com/tokeninfo?')) {
          $scope = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly'
          if ($env:SCENARIO -eq 'missing-scope') { $scope = 'https://www.googleapis.com/auth/yt-analytics.readonly' }
          if ($env:SCENARIO -eq 'broad-scope') { $scope += ' https://www.googleapis.com/auth/youtube' }
          return @{ scope = $scope }
        }
        if ($Uri.StartsWith('https://www.googleapis.com/youtube/v3/channels?')) {
          if ($env:SCENARIO -eq 'wrong-channel') { return @{ items = @(@{ id = 'other-channel' }) } }
          return @{ items = @(@{ id = $env:CHANNEL_ID }) }
        }
        if ($Uri.StartsWith('https://youtubeanalytics.googleapis.com/v2/reports?')) {
          if ($env:SCENARIO -eq 'analytics-failure') { throw 'secret-access-value' }
          if ($env:SCENARIO -eq 'empty') { return @{ rows = @() } }
          return @{ rows = @(@('2026-09-01', 1, 1, 2), @('2026-09-02', 2, 2, 4)) }
        }
        throw 'Unexpected request'
      }
      & $env:CHECK_SCRIPT
      exit $LASTEXITCODE
    `);
    const result = spawnSync('pwsh', ['-NoProfile', '-File', harness], {
      encoding: 'utf8', env: { ...process.env, SCENARIO: scenario, CHECK_SCRIPT: scriptFile, GITHUB_STEP_SUMMARY: summary },
    });
    const text = fs.readFileSync(summary, 'utf8');
    // Mask-registration lines intentionally contain tokens for the Actions runner.
    const output = (result.stdout + result.stderr).split(/\r?\n/).filter(line => !line.startsWith('::add-mask::')).join('\n');
    for (const secret of ['secret-client-value', 'secret-refresh-value', 'secret-access-value']) {
      assert.ok(!text.includes(secret), 'summary must never contain credentials');
      assert.ok(!output.includes(secret), 'ordinary logs/errors must never contain credentials');
    }
    assert.equal(result.status, ['success', 'empty'].includes(scenario) ? 0 : 1, output);
    if (scenario === 'success') assert.match(text, /2 daily rows returned/);
    if (scenario === 'empty') assert.match(text, /Empty history is not proof of zero/);
    if (scenario === 'invalid-grant') assert.match(text, /Google OAuth error: `invalid_grant`/);
    if (!['success', 'empty'].includes(scenario)) assert.match(text, /FAILED while/);
  });
}
