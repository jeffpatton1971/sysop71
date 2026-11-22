import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { decryptBundle, validateRange, reportCsv, type Envelope, type Report } from './youtube-analytics-lib';

const repo = 'jeffpatton1971/sysop71';
function gh(args: string[], input?: string, timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('gh', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    process.stdout.on('data', data => { output += String(data); });
    process.stderr.resume();
    process.on('error', () => { clearTimeout(timer); reject(new Error('GitHub CLI could not start.')); });
    const timer = setTimeout(() => { process.kill(); reject(new Error('GitHub operation timed out.')); }, timeout);
    process.on('close', status => {
      clearTimeout(timer);
      if (status !== 0) reject(new Error(`GitHub ${args[0]} ${args[1]} failed. Check repository access or the workflow run.`));
      else resolve(output.trim());
    });
    process.stdin.on('error', () => {});
    process.stdin.end(input);
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    start: { type: 'string' }, end: { type: 'string' }, ref: { type: 'string', default: 'codex/youtube-local-analytics' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log('Usage: npm run youtube:collect -- --start YYYY-MM-DD --end YYYY-MM-DD [--ref branch]\nReports are saved locally under .tmp/youtube-reports/. GitHub fetches and encrypts data using the existing Key Vault grant.'); return; }
  const start = values.start || '';
  const end = values.end || '';
  validateRange(start, end);
  await gh(['auth', 'status']);
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const requestId = randomBytes(16).toString('hex');
  const outputDir = path.resolve('.tmp/youtube-reports', `${start}_${end}_${requestId.slice(0, 8)}`);
  await mkdir(outputDir, { recursive: true });
  const inputs = { collect_reports: 'true', report_start: start, report_end: end, report_public_key: Buffer.from(publicKey).toString('base64'), report_request_id: requestId };
  const dispatch = await gh(['workflow', 'run', 'backfill-youtube-metrics.yml', '--repo', repo, '--ref', values.ref!, '--json'], JSON.stringify(inputs));
  const run = dispatch.match(/https:\/\/github\.com\/jeffpatton1971\/sysop71\/actions\/runs\/(\d+)/);
  if (!run) throw new Error('GitHub did not return a run URL. Check Actions; rerun collection if needed.');
  console.log(`Collecting reports: ${run[0]}`);
  await gh(['run', 'watch', run[1], '--repo', repo, '--exit-status', '--interval', '10'], undefined, 25 * 60_000);
  await gh(['run', 'download', run[1], '--repo', repo, '--name', `youtube-${requestId}`, '--dir', outputDir]);
  const encrypted = JSON.parse(await readFile(path.join(outputDir, 'report.enc.json'), 'utf8')) as Envelope;
  const bundle = decryptBundle(encrypted, privateKey, requestId);
  if (bundle.startDate !== start || bundle.endDate !== end) throw new Error('Downloaded report dates do not match the request.');
  await writeFile(path.join(outputDir, 'reports.json'), JSON.stringify(bundle, null, 2));
  for (const report of bundle.reports) {
    // Report names are supplied by the runner; never allow output path traversal.
    if (!/^[a-z0-9-]+$/.test(report.name)) throw new Error('Invalid report name.');
    if (report.status === 'ok' && report.data) await writeFile(path.join(outputDir, `${report.name}.csv`), reportCsv(report.data));
  }
  const videos: Report = {
    columnHeaders: ['video', 'title', 'publishedAt', 'duration'].map(name => ({ name })),
    rows: bundle.videos.map(video => [video.id, video.title, video.publishedAt, video.duration]),
  };
  await writeFile(path.join(outputDir, 'video-metadata.csv'), reportCsv(videos));
  const dailyParts = bundle.reports.filter(report => report.name.startsWith('video-daily-') && report.status === 'ok' && report.data);
  if (dailyParts.length) {
    const headers = dailyParts[0].data!.columnHeaders;
    if (dailyParts.some(report => JSON.stringify(report.data!.columnHeaders) !== JSON.stringify(headers))) throw new Error('Daily report headers differ between batches.');
    await writeFile(path.join(outputDir, 'video-daily.csv'), reportCsv({ columnHeaders: headers, rows: dailyParts.flatMap(report => report.data!.rows || []) }));
  }
  const manifest = {
    channelId: bundle.channelId, requestedStart: start, requestedEnd: end, collectedAt: bundle.collectedAt, timezone: bundle.timezone,
    complete: bundle.complete, workflow: run[0], notes: bundle.notes,
    reports: bundle.reports.map(report => {
      const dayIndex = report.data?.columnHeaders.findIndex(header => header.name === 'day') ?? -1;
      const dates = dayIndex >= 0 ? [...new Set(report.data?.rows?.map(row => String(row[dayIndex])))].sort() : [];
      return { name: report.name, status: report.status, rows: report.data?.rows?.length ?? 0, firstObservedDate: dates[0] ?? null, lastObservedDate: dates.at(-1) ?? null, error: report.error, query: report.query };
    }),
  };
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Reports saved locally: ${outputDir}`);
  console.log(`Status: ${bundle.complete ? 'complete' : 'partial; see manifest.json for failed reports'}`);
  if (!bundle.complete) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Collection failed.'); process.exitCode = 1; });
