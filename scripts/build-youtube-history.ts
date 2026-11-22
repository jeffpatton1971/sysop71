import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CHANNEL_ID, validateRange, type Bundle } from './youtube-analytics-lib';
import { HISTORY_START, buildHistory, dates, grouped, ledger, type Period } from './youtube-report-history';

const esc = (value: unknown) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const formatName = (key: string) => ({ shorts: 'Shorts', videoOnDemand: 'Full-length / on-demand', liveStream: 'Livestreams', creatorContentTypeUnspecified: 'Unspecified' }[key] || key);
const trafficName = (key: string) => ({ YT_SEARCH: 'YouTube search', SUBSCRIBER: 'Home and subscription feeds', RELATED_VIDEO: 'Related videos', YT_CHANNEL: 'Channel pages', SHORTS_CONTENT_LINKS: 'Links in Shorts (SHORTS_CONTENT_LINKS)', NOTIFICATION: 'Notifications', EXT_URL: 'External websites', PLAYLIST: 'Playlists', NO_LINK_OTHER: 'Direct / other', YT_OTHER_PAGE: 'Other YouTube pages' }[key] || key);
function trendChart(report: Period): string {
  const all = dates(report.start, report.end), rows = new Map(report.days.map(d => [d.day, Number(d.channel.views)]));
  const maximum = Math.max(1, ...rows.values());
  const x = (i: number) => 42 + i / Math.max(1, all.length - 1) * 330;
  const y = (v: number) => 150 - v / maximum * 120;
  let points = '', marks = '', priorPresent = false;
  all.forEach((day, i) => {
    const value = rows.get(day);
    if (value === undefined) { priorPresent = false; return; }
    points += `${priorPresent ? 'L' : 'M'}${x(i)},${y(value)} `;
    marks += `<circle cx="${x(i)}" cy="${y(value)}" r="2" fill="currentColor"><title>${day}: ${value} views</title></circle>`;
    priorPresent = true;
  });
  return `<svg viewBox="0 0 410 190" role="img" aria-label="Daily channel views. Missing dates appear as gaps." style="width:100%;max-width:820px;height:auto"><line x1="42" x2="372" y1="150" y2="150" stroke="currentColor" opacity=".4"/><text x="35" y="155" text-anchor="end" fill="currentColor" font-size="14">0</text><text x="35" y="35" text-anchor="end" fill="currentColor" font-size="14">${maximum}</text><path d="${points}" fill="none" stroke="currentColor" stroke-width="2"/>${marks}<text x="42" y="177" fill="currentColor" font-size="14">${report.start.slice(5)}</text><text x="372" y="177" text-anchor="end" fill="currentColor" font-size="14">${report.end.slice(5)}</text></svg>`;
}
const table = (head: string[], rows: unknown[][]) => `<div class="table-wrap"><table><thead><tr>${head.map(v => `<th>${esc(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:1050px;margin:auto;padding:24px;color:#20262c;background:#fff}h1{font-size:28px}h2{font-size:20px;margin-top:30px}a{color:#145ca1}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #d9dee2}th{background:#f0f3f5}.table-wrap{overflow:auto}.note{color:#48515b}li{margin-bottom:8px}@media(prefers-color-scheme:dark){body{background:#15191d;color:#edf1f4}a{color:#8bc1ff}th{background:#252c32}th,td{border-color:#45505b}.note{color:#c2cbd3}}</style></head><body>${body}</body></html>`;
function render(report: Period, titles: Map<string, string>, generatedAt: string): string {
  const m = report.metrics, prior = report.previous;
  const comparable = report.complete && !report.open && prior.complete && (report.kind === 'monthly' || report.days.length === 7);
  const trend = comparable ? `Views per day: ${number(m.views / report.days.length)} versus ${number(prior.metrics.views / prior.days)} in the preceding ${report.kind === 'weekly' ? 'week' : 'month'}. ${prior.metrics.views ? `Change: ${number(((m.views / report.days.length) / (prior.metrics.views / prior.days) - 1) * 100)}%.` : 'The preceding period had zero views; percentage growth is undefined.'}` : 'Both periods must be complete and comparable before reporting a growth percentage. This comparison does not yet meet that requirement.';
  const videos = grouped(report.days.flatMap(d => d.videos), 'video');
  const topVideos = Object.entries(videos).sort((a, b) => b[1].engagedViews - a[1].engagedViews).slice(0, 5);
  const episodeRows = grouped(report.days.flatMap(d => d.videos).filter(r => r.creatorContentType === 'videoOnDemand'), 'video');
  const topEpisodes = Object.entries(episodeRows).sort((a, b) => b[1].estimatedMinutesWatched - a[1].estimatedMinutesWatched).slice(0, 3);
  const traffic = grouped(report.days.flatMap(d => d.traffic).filter(r => r.creatorContentType === 'videoOnDemand'), 'insightTrafficSourceType');
  const shorts = report.formats.shorts?.views || 0, full = report.formats.videoOnDemand?.views || 0;
  const links = traffic.SHORTS_CONTENT_LINKS?.views || 0;
  const ideas = [
    shorts > 0 ? `Shorts recorded ${number(shorts)} views; the full-length traffic rows recorded ${number(links)} views under SHORTS_CONTENT_LINKS. Test a closely matched Short with its related episode link. Measure linked episode engaged views and watch time over four comparable weeks; Shorts reach alone is not proof of episode growth.` : `No Shorts views were present in the returned format rows. If production time allows, test one episode-linked Short per week for four weeks. Track Shorts reach separately from full-length engaged views and linked traffic.`,
    `Full-length videos recorded ${number(full)} views. Compare the strongest episode's opening and title with a similar episode, then test one packaging change. Review impressions, click-through rate and retention in Studio before attributing a change to the title or thumbnail.`
  ];
  return shell(`Sysop71 Gaming ${report.kind} report`, `<p><a href="../index.html">Report archive</a></p><h1>Sysop71 Gaming ${report.kind} report</h1><p>${report.start} through ${report.end} · scheduled ${report.due} at midnight Central</p><p><strong>${report.open ? 'Open week' : report.complete ? 'All daily channel rows available' : 'Provisional: delayed or missing data'}</strong> · ${report.days.length} of ${dates(report.start, report.end).length} days observed.</p>${report.missingDates.length ? `<p>Missing dates: ${report.missingDates.map(esc).join(', ')}. Missing dates are not zero activity.</p>` : ''}<p class="note">Reconstructed/updated ${esc(generatedAt)} from currently available API history. These are not snapshots originally captured on the historical scheduled date.</p>
    ${table(['Metric', 'Observed period'], [['Views', number(m.views)], ['Engaged views', number(m.engagedViews)], ['Watch hours (sum of daily whole-minute rows)', number(m.estimatedMinutesWatched / 60)], ['Subscribers gained / lost', `${m.subscribersGained} / ${m.subscribersLost}`], ['Net subscribers', m.subscribersGained - m.subscribersLost]])}
    <h2>Daily views</h2>${trendChart(report)}<h2>Growth trend</h2><p>${esc(trend)}</p>
    ${comparable ? table(['Metric', 'Current period', 'Prior period'], [['Views', m.views, prior.metrics.views], ['Engaged views', m.engagedViews, prior.metrics.engagedViews], ['Net subscribers', m.subscribersGained - m.subscribersLost, prior.metrics.subscribersGained - prior.metrics.subscribersLost]]) : ''}
    <h2>Formats</h2>${table(['Format', 'Views', 'Engaged views', 'Subscribers gained'], Object.entries(report.formats).map(([name, values]) => [formatName(name), values.views, values.engagedViews, values.subscribersGained]))}
    ${comparable ? `<h2>Format growth</h2>${table(['Format', 'Current views/day', 'Prior views/day', 'Current engaged views', 'Prior engaged views'], [...new Set([...Object.keys(report.formats), ...Object.keys(prior.formats)])].map(name => [formatName(name), report.formats[name] ? number(report.formats[name].views / report.days.length) : 'No returned rows', prior.formats[name] ? number(prior.formats[name].views / prior.days) : 'No returned rows', report.formats[name]?.engagedViews ?? '—', prior.formats[name]?.engagedViews ?? '—']))}` : ''}
    <h2>Leading videos by engaged views</h2>${table(['Video', 'Views', 'Engaged views', 'Watch minutes (daily row sum)'], topVideos.map(([id, values]) => [titles.get(id) || id, values.views, values.engagedViews, values.estimatedMinutesWatched]))}
    <h2>Leading full-length videos by watch minutes</h2>${table(['Video', 'Engaged views', 'Watch minutes (daily row sum)'], topEpisodes.map(([id, values]) => [titles.get(id) || id, values.engagedViews, values.estimatedMinutesWatched]))}
    <h2>Full-length discovery</h2>${table(['Traffic source', 'Views', 'Engaged views'], Object.entries(traffic).sort((a, b) => b[1].views - a[1].views).map(([source, v]) => [trafficName(source), v.views, v.engagedViews]))}
    ${report.weeklySegments ? `<h2>Weekly contributions within this month</h2>${table(['Dates within month', 'Observed days', 'Views', 'Engaged views'], report.weeklySegments.map(w => [`${w.start}–${w.end}`, w.observedDays, w.metrics.views, w.metrics.engagedViews]))}` : ''}
    <h2>Growth experiments to consider</h2><ul>${ideas.map(idea => `<li>${esc(idea)}</li>`).join('')}</ul>
    <h2>Coverage and interpretation</h2><ul><li>Analytics dates use Pacific time. Report delivery uses America/Chicago, including daylight saving time. September 1–5 is the initial partial week.</li><li>Daily watch minutes are returned as integers; their sum can differ from an independent period-total query. No average duration is calculated by dividing public views into watch time.</li><li>Season labels and video titles alone are not evidence that Shorts viewers became episode viewers. No causal growth claim is made.</li><li>The November 16, 2026 co-view methodology change can affect comparisons spanning that date. Preserve reported values; engaged views provide an additional comparison, not a complete correction.</li><li>Later runs refresh overlapping historical dates and rebuild these reports. Monthly totals use dated weekly records clipped to the calendar month, avoiding overlap.</li></ul><p class="note">Machine-readable data and source request IDs: <a href="${report.kind}-${report.start}.json">report JSON</a>. <a href="https://developers.google.com/youtube/analytics/metrics">YouTube metric definitions</a>.</p>`);
}
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'as-of': { type: 'string' }, archive: { type: 'string', default: '../youtube-report-archive' } } });
  const asOf = values['as-of'] || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  validateRange(asOf, asOf);
  if (asOf <= HISTORY_START) throw new Error('As-of date must be after September 1, 2026.');
  const archive = path.resolve(values.archive!);
  const sources = path.join(archive, 'sources');
  await mkdir(sources, { recursive: true });
  const input = path.resolve('.tmp/youtube-reports');
  for (const entry of await readdir(input, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let bundle: Bundle;
    try { bundle = JSON.parse(await readFile(path.join(input, entry.name, 'reports.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (bundle.channelId !== CHANNEL_ID || !/^[a-f0-9]{32}$/.test(bundle.requestId)) throw new Error('Unexpected source identity.');
    if (!bundle.complete) continue;
    await writeFile(path.join(sources, `${bundle.requestId}.json`), JSON.stringify(bundle));
  }
  const bundles: Bundle[] = [];
  for (const file of await readdir(sources)) if (/^[a-f0-9]{32}\.json$/.test(file)) {
    const bundle = JSON.parse(await readFile(path.join(sources, file), 'utf8')) as Bundle;
    if (bundle.channelId !== CHANNEL_ID) throw new Error('Unexpected archived channel.');
    bundles.push(bundle);
  }
  if (!bundles.length) throw new Error('No successful source collections available.');
  const history = buildHistory(ledger(bundles), asOf);
  const titles = new Map(bundles.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).flatMap(b => b.videos.map(v => [v.id, v.title] as const)));
  const generatedAt = new Date().toISOString();
  const atomicWrite = async (file: string, body: string) => {
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, body);
    await rename(temporary, file);
  };
  for (const report of [...history.weekly, ...history.monthly]) {
    const dir = path.join(archive, report.kind);
    await mkdir(dir, { recursive: true });
    const stem = path.join(dir, `${report.kind}-${report.start}`);
    await atomicWrite(`${stem}.json`, JSON.stringify({ ...report, generatedAt, asOf }, null, 2));
    await atomicWrite(`${stem}.html`, render(report, titles, generatedAt));
  }
  const list = (reports: Period[]) => `<ul>${[...reports].reverse().map(r => `<li><a href="${r.kind}/${r.kind}-${r.start}.html">${r.start} through ${r.end}</a> — ${r.open ? 'open week' : r.complete ? 'daily rows available' : 'provisional'}; ${number(r.metrics.views)} observed views</li>`).join('')}</ul>`;
  await atomicWrite(path.join(archive, 'index.html'), shell('Sysop71 Gaming report archive', `<h1>Sysop71 Gaming report archive</h1><p>Weekly: Sunday at midnight Central. Monthly: first day at midnight Central.</p><p>History begins September 1, 2026. Updated ${esc(generatedAt)}. Historical reports are reconstructed from current API data; provisional reports are refreshed on subsequent runs.</p><h2>Monthly reports</h2>${list(history.monthly)}<h2>Weekly reports</h2>${list(history.weekly)}`));
  await atomicWrite(path.join(archive, 'history.json'), JSON.stringify({ asOf, generatedAt, weekly: history.weekly.map(r => ({ start: r.start, end: r.end, complete: r.complete, open: r.open, metrics: r.metrics })), monthly: history.monthly.map(r => ({ start: r.start, end: r.end, complete: r.complete, metrics: r.metrics })) }, null, 2));
  console.log(`Saved ${history.weekly.length} weekly and ${history.monthly.length} monthly reports: ${path.join(archive, 'index.html')}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Report history failed.'); process.exitCode = 1; });
