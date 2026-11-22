import type { Bundle, Report } from './youtube-analytics-lib';

export const HISTORY_START = '2026-09-01';
type Row = Record<string, string | number>;
export interface DayRecord {
  day: string; collectedAt: string; source: string; channel: Row;
  formats: Row[]; videos: Row[]; traffic: Row[]; devices: Row[];
}
export interface Metrics { views: number; engagedViews: number; estimatedMinutesWatched: number; subscribersGained: number; subscribersLost: number }
export interface Period {
  kind: 'weekly' | 'monthly'; start: string; end: string; due: string;
  days: DayRecord[]; missingDates: string[]; complete: boolean; open: boolean;
  metrics: Metrics; formats: Record<string, Metrics>; previous: { start: string; end: string; complete: boolean; days: number; metrics: Metrics; formats: Record<string, Metrics> };
  weeklySegments?: { start: string; end: string; report: string; metrics: Metrics; observedDays: number }[];
}
export function shift(date: string, amount: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + amount * 86400000).toISOString().slice(0, 10);
}
export function dates(start: string, end: string): string[] {
  const result: string[] = [];
  for (let d = start; d <= end; d = shift(d, 1)) result.push(d);
  return result;
}
export function records(report?: Report): Row[] {
  return (report?.rows || []).map(row => Object.fromEntries(report!.columnHeaders.map((h, i) => [h.name, row[i]])));
}
export function sum(rows: Row[]): Metrics {
  const keys = ['views', 'engagedViews', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost'] as const;
  return Object.fromEntries(keys.map(key => [key, rows.reduce((a, r) => a + Number(r[key] || 0), 0)])) as unknown as Metrics;
}
export function grouped(rows: Row[], key: string): Record<string, Metrics> {
  return Object.fromEntries([...new Set(rows.map(r => String(r[key])))].map(value => [value, sum(rows.filter(r => String(r[key]) === value))]));
}
export function ledger(bundles: Bundle[]): DayRecord[] {
  const days = new Map<string, DayRecord>();
  for (const bundle of [...bundles].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))) {
    if (!bundle.complete) continue;
    const get = (name: string) => records(bundle.reports.find(r => r.name === name && r.status === 'ok')?.data);
    const formats = get('daily-by-format'), traffic = get('traffic-by-day-format'), devices = get('devices-by-day-format');
    const videos = bundle.reports.filter(r => r.name.startsWith('video-daily-') && r.status === 'ok').flatMap(r => records(r.data));
    for (const row of get('daily')) {
      const day = String(row.day);
      if (day < HISTORY_START) continue;
      days.set(day, { day, collectedAt: bundle.collectedAt, source: bundle.requestId, channel: row,
        formats: formats.filter(r => r.day === day), videos: videos.filter(r => r.day === day),
        traffic: traffic.filter(r => r.day === day), devices: devices.filter(r => r.day === day) });
    }
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
function monthStart(date: string): string { return date.slice(0, 7) + '-01'; }
function nextMonth(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}
function period(kind: Period['kind'], start: string, end: string, allDays: DayRecord[], asOf: string): Period {
  const days = allDays.filter(d => d.day >= start && d.day <= end);
  const observed = new Set(days.map(d => d.day));
  const missingDates = dates(start, end).filter(d => !observed.has(d));
  const previousEnd = shift(start, -1);
  const previousStart = kind === 'weekly' ? shift(start, -7) : monthStart(previousEnd);
  const prior = allDays.filter(d => d.day >= previousStart && d.day <= previousEnd);
  return { kind, start, end, due: shift(end, 1), days, missingDates, complete: !missingDates.length,
    open: end >= asOf, metrics: sum(days.map(d => d.channel)), formats: grouped(days.flatMap(d => d.formats), 'creatorContentType'),
    previous: { start: previousStart, end: previousEnd, complete: prior.length === dates(previousStart, previousEnd).length, days: prior.length, metrics: sum(prior.map(d => d.channel)), formats: grouped(prior.flatMap(d => d.formats), 'creatorContentType') } };
}
export function buildHistory(allDays: DayRecord[], asOf: string): { weekly: Period[]; monthly: Period[] } {
  const weekly: Period[] = [], monthly: Period[] = [];
  for (let start = HISTORY_START; start < asOf;) {
    const weekday = new Date(start + 'T00:00:00Z').getUTCDay();
    const end = shift(start, 6 - weekday);
    weekly.push(period('weekly', start, end, allDays.filter(d => d.day < asOf), asOf));
    start = shift(end, 1);
  }
  // Calendar months accumulate the daily records held by weekly reports, never whole overlapping weeks.
  const weeklyDays = weekly.flatMap(w => w.days);
  if (new Set(weeklyDays.map(d => d.day)).size !== weeklyDays.length) throw new Error('Weekly reports overlap.');
  for (let start = HISTORY_START; nextMonth(start) <= asOf; start = nextMonth(start)) {
    const end = shift(nextMonth(start), -1);
    const report = period('monthly', start, end, weeklyDays, asOf);
    report.weeklySegments = weekly.filter(w => w.start <= end && w.end >= start).map(w => {
      const segmentStart = w.start < start ? start : w.start, segmentEnd = w.end > end ? end : w.end;
      const ds = w.days.filter(d => d.day >= segmentStart && d.day <= segmentEnd);
      return { start: segmentStart, end: segmentEnd, report: `weekly-${w.start}`, metrics: sum(ds.map(d => d.channel)), observedDays: ds.length };
    });
    monthly.push(report);
  }
  return { weekly, monthly };
}
