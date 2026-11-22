import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { CHANNEL_ID, decryptBundle, encryptBundle, fetchReport, makePlan, reportCsv, validateRange, type Bundle, type GetJson } from '../../scripts/youtube-analytics-lib';

test('date range rejects impossible, reversed, and excessive periods', () => {
  validateRange('2026-09-01', '2026-11-20');
  for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-11-20', '2026-09-01'], ['2026-01-01', '2026-11-20']]) assert.throws(() => validateRange(start, end));
});

test('report pagination retains all rows, including an empty trailing page', async () => {
  const calls: string[] = [];
  const get: GetJson = async <T>(_url: string, query: Record<string, string>) => {
    calls.push(query.startIndex);
    return { columnHeaders: [{ name: 'day' }], rows: query.startIndex === '1' ? [['2026-09-01'], ['2026-09-02']] : [] } as T;
  };
  const result = await fetchReport(get, {}, 2);
  assert.equal(result.rows?.length, 2);
  assert.deepEqual(calls, ['1', '3']);
});

test('pagination rejects repeated pages and changed columns', async () => {
  const repeated: GetJson = async <T>() => ({ columnHeaders: [{ name: 'day' }], rows: [['2026-09-01']] }) as T;
  await assert.rejects(fetchReport(repeated, {}, 1), /Repeated report page/);
  const changed: GetJson = async <T>(_url: string, query: Record<string, string>) => ({ columnHeaders: [{ name: query.startIndex === '1' ? 'day' : 'views' }], rows: [['2026-09-01']] }) as T;
  await assert.rejects(fetchReport(changed, {}, 1), /columns changed/);
});

test('CSV quotes cells and neutralizes text formulas without changing numbers', () => {
  const text = reportCsv({ columnHeaders: [{ name: 'title' }, { name: 'views' }], rows: [['=1+1', -1], ['A,"B"\nC', 2]] });
  assert.ok(text.includes('"\'=1+1","-1"'));
  assert.ok(text.includes('"A,""B""\nC","2"'));
});

test('only this local private key can decrypt an unmodified report for this request', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const data: Bundle = { version: 1, requestId: 'a'.repeat(32), channelId: CHANNEL_ID, startDate: '2026-09-01', endDate: '2026-11-20', collectedAt: '2026-11-22T00:00:00Z', timezone: 'America/Los_Angeles', complete: true, reports: [], videos: [{ id: 'test', title: 'private title', publishedAt: '', duration: '' }], notes: [] };
  const encrypted = encryptBundle(data, pair.publicKey);
  assert.ok(!JSON.stringify(encrypted).includes('private title'));
  assert.deepEqual(decryptBundle(encrypted, pair.privateKey, data.requestId), data);
  assert.throws(() => decryptBundle(encrypted, pair.privateKey, 'b'.repeat(32)), /different request/);
  const bytes = Buffer.from(encrypted.data, 'base64'); bytes[0] ^= 1;
  assert.throws(() => decryptBundle({ ...encrypted, data: bytes.toString('base64') }, pair.privateKey, data.requestId));
});

test('format reports use YouTube classification and retain engaged views', () => {
  const plan = makePlan('2026-09-01', '2026-11-20');
  assert.equal(plan.length, 6);
  assert.ok(plan.find(item => item.name === 'daily-by-format')?.query.dimensions.includes('creatorContentType'));
  assert.ok(plan.every(item => item.query.metrics.includes('engagedViews')));
});
