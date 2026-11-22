import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory, dates, ledger, type DayRecord } from '../../scripts/youtube-report-history';
import { CHANNEL_ID, type Bundle } from '../../scripts/youtube-analytics-lib';
const daily = (start: string, end: string): DayRecord[] => dates(start, end).map(day => ({ day, collectedAt: '2026-11-22T00:00:00Z', source: 'test', channel: { day, views: 1, engagedViews: 1, estimatedMinutesWatched: 2, subscribersGained: 0, subscribersLost: 0 }, formats: [], videos: [], traffic: [], devices: [] }));

test('backfill starts with a five-day week and marks the latest delayed week provisional', () => {
  const h = buildHistory(daily('2026-09-01', '2026-11-19'), '2026-11-22');
  assert.equal(h.weekly.length, 12);
  assert.equal(h.monthly.length, 2);
  assert.equal(h.weekly[0].start, '2026-09-01');
  assert.equal(h.weekly[0].end, '2026-09-05');
  assert.equal(h.weekly[0].days.length, 5);
  assert.equal(h.weekly[0].previous.complete, false);
  assert.deepEqual(h.weekly.at(-1)?.missingDates, ['2026-11-20', '2026-11-21']);
  assert.equal(h.weekly.at(-1)?.complete, false);
});

test('monthly accumulation clips weeks at boundaries and includes the unfinished closing week', () => {
  const h = buildHistory(daily('2026-09-01', '2026-11-30'), '2026-12-01');
  assert.deepEqual(h.monthly.map(m => m.metrics.views), [30, 31, 30]);
  for (const m of h.monthly) {
    assert.equal(m.weeklySegments?.reduce((s, w) => s + w.metrics.views, 0), m.metrics.views);
    assert.equal(new Set(m.days.map(d => d.day)).size, m.days.length);
  }
  assert.equal(h.weekly.at(-1)?.open, true);
  assert.equal(h.monthly.at(-1)?.complete, true);
  assert.equal(h.monthly.at(-1)?.weeklySegments?.at(-1)?.end, '2026-11-30');
});

test('new source revises matching dates without doubling them or erasing older available dates', () => {
  const make = (collectedAt: string, rows: (string | number)[][]): Bundle => ({ version: 1, requestId: collectedAt, channelId: CHANNEL_ID, startDate: '2026-09-01', endDate: '2026-09-02', collectedAt, timezone: 'America/Los_Angeles', complete: true, videos: [], notes: [], reports: [{ name: 'daily', query: {}, status: 'ok', data: { columnHeaders: [{ name: 'day' }, { name: 'views' }], rows } }] });
  const old = make('2026-09-04T00:00:00Z', [['2026-09-01', 2], ['2026-09-02', 3]]);
  const newer = make('2026-09-05T00:00:00Z', [['2026-09-01', 4]]);
  const result = ledger([newer, old]);
  assert.deepEqual(result.map(d => d.channel.views), [4, 3]);
  const partial = { ...newer, complete: false };
  assert.deepEqual(ledger([old, partial]).map(d => d.channel.views), [2, 3]);
});

test('missing dates are not invented as zeros and current-day observations are excluded', () => {
  const ds = daily('2026-09-01', '2026-09-13').filter(d => d.day !== '2026-09-08');
  const h = buildHistory(ds, '2026-09-13');
  assert.deepEqual(h.weekly[1].missingDates, ['2026-09-08']);
  assert.equal(h.weekly[1].metrics.views, 6);
  assert.ok(h.weekly.every(w => w.days.every(d => d.day < '2026-09-13')));
});
