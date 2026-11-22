import { createCipheriv, createDecipheriv, publicEncrypt, privateDecrypt, randomBytes, constants } from 'node:crypto';

export const CHANNEL_ID = 'UCPnbKK1hVXihEXLBOHhLRbg';
export const METRICS = 'views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost';
export interface Report {
  columnHeaders: { name: string; dataType?: string; columnType?: string }[];
  rows?: (string | number)[][];
}
export type Query = Record<string, string>;
export type GetJson = <T>(endpoint: string, query: Query) => Promise<T>;
export interface Envelope {
  version: 1; key: string; iv: string; tag: string; data: string; requestId: string;
}
export interface CollectedReport {
  name: string; query: Query; status: 'ok' | 'error'; data?: Report; error?: string;
}
export interface Bundle {
  version: 1; requestId: string; channelId: string; startDate: string; endDate: string;
  collectedAt: string; timezone: string; complete: boolean; reports: CollectedReport[];
  videos: { id: string; title: string; publishedAt: string; duration: string }[];
  notes: string[];
}

export function validateRange(start: string, end: string): void {
  for (const date of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Use valid dates in YYYY-MM-DD format.');
  }
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
  if (days < 1 || days > 90) throw new Error('Choose a reporting window of 1 to 90 days.');
}

export function encryptBundle(data: Bundle, publicKey: string): Envelope {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(data.requestId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return {
    version: 1, requestId: data.requestId,
    key: publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, key).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64'),
  };
}

export function decryptBundle(envelope: Envelope, privateKey: string, requestId: string): Bundle {
  if (envelope.version !== 1 || envelope.requestId !== requestId) throw new Error('Downloaded report belongs to a different request.');
  const key = privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.key, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(requestId));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')) as Bundle;
  if (data.version !== 1 || data.requestId !== requestId || data.channelId !== CHANNEL_ID) throw new Error('Unexpected report identity.');
  return data;
}

export function reportCsv(report: Report): string {
  const escape = (value: string | number) => {
    const text = typeof value === 'string' && /^[=+@\-\t\r]/.test(value) ? `'${value}` : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [report.columnHeaders.map(header => header.name), ...(report.rows || [])].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
}

export async function fetchReport(get: GetJson, query: Query, pageSize = 200): Promise<Report> {
  const rows: NonNullable<Report['rows']> = [];
  let headers: Report['columnHeaders'] | undefined;
  const seen = new Set<string>();
  for (let index = 1; index <= 1_000_000; index += pageSize) {
    const data = await get<Report>('https://youtubeanalytics.googleapis.com/v2/reports', { ...query, maxResults: String(pageSize), startIndex: String(index) });
    if (!Array.isArray(data.columnHeaders)) throw new Error('Missing report column headers.');
    if (headers && JSON.stringify(headers) !== JSON.stringify(data.columnHeaders)) throw new Error('Report columns changed during pagination.');
    headers = data.columnHeaders;
    const batch = data.rows || [];
    if (batch.some(row => row.length !== headers!.length)) throw new Error('Malformed report row.');
    if (batch.length) {
      const signature = JSON.stringify(batch);
      if (seen.has(signature)) throw new Error('Repeated report page; stopped to prevent double counting.');
      seen.add(signature);
    }
    rows.push(...batch);
    if (batch.length < pageSize) return { columnHeaders: headers, rows };
  }
  throw new Error('Report pagination safety limit reached.');
}

export function makePlan(start: string, end: string): { name: string; query: Query }[] {
  validateRange(start, end);
  const base = { ids: `channel==${CHANNEL_ID}`, startDate: start, endDate: end };
  const core = 'views,engagedViews,estimatedMinutesWatched';
  return [
    { name: 'total', query: { ...base, metrics: METRICS } },
    { name: 'daily', query: { ...base, dimensions: 'day', metrics: METRICS, sort: 'day' } },
    { name: 'daily-by-format', query: { ...base, dimensions: 'day,creatorContentType', metrics: METRICS, sort: 'day,creatorContentType' } },
    { name: 'videos-by-format', query: { ...base, dimensions: 'video,creatorContentType', metrics: METRICS, sort: '-views' } },
    { name: 'traffic-by-day-format', query: { ...base, dimensions: 'day,insightTrafficSourceType,creatorContentType', metrics: core, sort: 'day,insightTrafficSourceType,creatorContentType' } },
    { name: 'devices-by-day-format', query: { ...base, dimensions: 'day,deviceType,creatorContentType', metrics: core, sort: 'day,deviceType,creatorContentType' } },
  ];
}
