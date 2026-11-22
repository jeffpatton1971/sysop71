import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const scopes = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];
const repo = 'jeffpatton1971/sysop71';
const channelId = 'UCPnbKK1hVXihEXLBOHhLRbg';
const branch = 'codex/youtube-local-analytics';
const secretName = 'YT_OAUTH_GRANT';
export const redirectUri = 'http://localhost';

export function makeAuthorization(clientId: string) {
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('Supply the Google OAuth client ID with --client-id.');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(64).toString('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: scopes.join(' '), access_type: 'offline', prompt: 'consent select_account',
    include_granted_scopes: 'false', state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return { state, verifier, url: url.toString() };
}

export function callbackCode(url: URL, expectedState: string): string {
  const receivedState = url.searchParams.get('state') || '';
  const expected = Buffer.from(expectedState);
  const received = Buffer.from(receivedState);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('Authorization state did not match.');
  if (url.searchParams.has('error')) throw new Error('Google authorization was not granted.');
  const codes = url.searchParams.getAll('code');
  if (codes.length !== 1 || !codes[0] || codes[0].length > 4096) throw new Error('Google did not return a valid authorization code.');
  return codes[0];
}

function gh(args: string[], input?: string, timeout = 60_000): Promise<{ status: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    // Never expose raw gh errors: a failure could reference secret input.
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('GitHub CLI could not start.')); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('GitHub operation timed out.')); }, timeout);
    child.on('close', status => { clearTimeout(timer); resolve({ status: status ?? 1, output }); });
    child.stdin.on('error', () => { /* close/error handles an early process exit */ });
    child.stdin.end(input);
  });
}

async function submitGrant(clientId: string, code: string, verifier: string): Promise<void> {
  const payload = JSON.stringify({ clientId, channelId, code, verifier, redirectUri, createdAt: new Date().toISOString() });
  let saved = false;
  try {
    const upload = await gh(['secret', 'set', secretName, '--repo', repo], payload);
    if (upload.status !== 0) throw new Error('Could not save the one-time authorization as an encrypted GitHub secret.');
    saved = true;
    const dispatch = await gh(['workflow', 'run', 'backfill-youtube-metrics.yml', '--repo', repo, '--ref', branch, '-f', 'renew_authorization=true']);
    if (dispatch.status !== 0) throw new Error('Could not start the authorization workflow.');
    const match = dispatch.output.match(/https:\/\/github\.com\/jeffpatton1971\/sysop71\/actions\/runs\/(\d+)/);
    if (!match) throw new Error('Authorization dispatched, but its run ID was not returned. Check GitHub Actions.');
    console.log(`Authorization workflow: ${match[0]}`);
    const result = await gh(['run', 'watch', match[1], '--repo', repo, '--exit-status', '--interval', '5'], undefined, 360_000);
    if (result.status !== 0) throw new Error('The authorization workflow did not succeed. Inspect its sanitized summary.');
    console.log('Verified read-only authorization saved in Azure Key Vault.');
  } finally {
    if (saved) {
      const cleanup = await gh(['secret', 'delete', secretName, '--repo', repo]);
      if (cleanup.status !== 0) console.log('Remove the temporary YT_OAUTH_GRANT repository secret after checking the run.');
      else console.log('Removed the temporary one-time authorization secret.');
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'client-id': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: npx tsx scripts/authorize-youtube.ts --client-id <existing Google web client ID>');
    return;
  }
  const clientId = values['client-id'] || '';
  const authorization = makeAuthorization(clientId);
  const auth = await gh(['auth', 'status']);
  if (auth.status !== 0) throw new Error('Sign in to GitHub CLI with access to this repository before authorizing Google.');
  let accepted = false;
  let finish: () => void;
  let fail: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (request.method !== 'GET' || !['localhost', 'localhost:80'].includes(request.headers.host || '')) {
      response.writeHead(400); response.end('Invalid request.'); return;
    }
    const url = new URL(request.url || '/', redirectUri);
    if (url.pathname === '/complete') {
      response.end('Google authorization received. Return to Codex while GitHub verifies the channel and saves the token.'); return;
    }
    if (url.pathname !== '/' || accepted) { response.writeHead(404); response.end(); return; }
    let code: string;
    try { code = callbackCode(url, authorization.state); }
    catch {
      response.writeHead(400); response.end('Authorization was not accepted. Return to Codex to retry.'); return;
    }
    accepted = true;
    clearTimeout(timer);
    response.writeHead(303, { Location: '/complete' }); response.end();
    console.log('Google callback received. Verifying and storing the new authorization through GitHub.');
    void submitGrant(clientId, code, authorization.verifier).then(() => finish()).catch(error => fail(error));
  });
  const timer = setTimeout(() => fail(new Error('The sign-in window expired. Start the helper again.')), 15 * 60_000);
  server.on('error', () => fail(new Error('Could not listen on localhost port 80. Another application may already use that port.')));
  server.listen(80, '127.0.0.1', () => {
    console.log('Open this link on this computer and select Sysop71 Gaming:');
    console.log(authorization.url);
    console.log('Waiting up to 15 minutes. No client secret or refresh token will be stored locally.');
  });
  try { await completed; }
  finally { clearTimeout(timer); server.closeAllConnections(); server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Authorization failed.'); process.exitCode = 1; });
}
