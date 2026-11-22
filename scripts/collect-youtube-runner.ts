import { writeFile, mkdir } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { CHANNEL_ID, METRICS, encryptBundle, fetchReport, makePlan, type Bundle, type GetJson, type Query } from './youtube-analytics-lib';

async function main(): Promise<void> {
  const accessToken = process.env.YT_ACCESS_TOKEN;
  const start = process.env.REPORT_START || '';
  const end = process.env.REPORT_END || '';
  const requestId = process.env.REPORT_REQUEST_ID || '';
  const publicKey = Buffer.from(process.env.REPORT_PUBLIC_KEY || '', 'base64').toString('utf8');
  const plan = makePlan(start, end);
  if (!/^[a-f0-9]{32}$/.test(requestId)) throw new Error('Invalid report request ID.');
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 3072) throw new Error('Report encryption requires an RSA key of at least 3072 bits.');
  if (!accessToken || process.env.CHANNEL_ID !== CHANNEL_ID) throw new Error('Missing token or unexpected channel configuration.');
  const get: GetJson = async <T>(endpoint: string, query: Query): Promise<T> => {
    const url = new URL(endpoint);
    url.search = new URLSearchParams(query).toString();
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try { response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) }); }
      catch { throw new Error('Google request failed before an HTTP response.'); }
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** attempt)));
        continue;
      }
      if (!response.ok) {
        // Analytics errors are retained only inside the encrypted bundle, never runner logs.
        let detail = '';
        if (endpoint === 'https://youtubeanalytics.googleapis.com/v2/reports') {
          try {
            const body = await response.json() as { error?: { message?: string } };
            detail = typeof body.error?.message === 'string' ? body.error.message.replaceAll(accessToken, '[redacted]').slice(0, 500) : '';
          } catch { /* Status alone remains useful when the error body is unavailable. */ }
        }
        throw new Error(`Google API returned HTTP ${response.status}.${detail ? ` ${detail}` : ''}`);
      }
      try { return await response.json() as T; }
      catch { throw new Error('Google API returned invalid JSON.'); }
    }
  };
  // Verify the token and channel on every collection, even when issued from Key Vault.
  const tokenInfo = await get<{ scope: string }>('https://oauth2.googleapis.com/tokeninfo', { access_token: accessToken });
  const required = ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'];
  const granted = tokenInfo.scope.split(' ');
  if (required.some(scope => !granted.includes(scope)) || granted.some(scope => !required.includes(scope))) throw new Error('Token scopes do not match the required read-only grant.');
  const channels = await get<{ items: { id: string; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>('https://www.googleapis.com/youtube/v3/channels', { part: 'contentDetails', mine: 'true' });
  const channel = channels.items.find(item => item.id === CHANNEL_ID);
  if (!channel) throw new Error('Authorized channel does not match Sysop71 Gaming.');
  const bundle: Bundle = {
    version: 1, requestId, channelId: CHANNEL_ID, startDate: start, endDate: end,
    collectedAt: new Date().toISOString(), timezone: 'America/Los_Angeles', complete: true, reports: [], videos: [],
    notes: [
      'Absent rows are not converted into zero activity. Recent days may be incomplete or unavailable.',
      'Views and watch time retain YouTube methodology, including applicable co-view estimates. No adjustment was invented.',
      'Average duration/percentage are returned by Google, not calculated from public views.',
      'Video metadata is a current catalogue, not a publication count for the requested date range.',
      'The top-videos report is capped at 200 rows. Per-video daily reports separately cover the available uploads catalogue and IDs returned by that ranking.',
      'Subscriber attribution can differ between channel-level and video-level reports.',
      'Thumbnail impressions/CTR, Shorts feed exposure, and co-view rate still require Studio exports where unavailable through these report definitions.',
    ],
  };
  for (const item of plan) {
    try {
      const data = await fetchReport(get, item.query, 200, item.name === 'top-videos');
      bundle.reports.push({ ...item, status: 'ok', data });
      console.log(`Collected ${item.name}.`);
    } catch (error) {
      bundle.complete = false;
      bundle.reports.push({ ...item, status: 'error', error: (error as Error).message });
      console.log(`Could not collect ${item.name}; details retained in the encrypted report.`);
    }
  }
  const ids = new Set<string>();
  let pageToken = '';
  const seenTokens = new Set<string>();
  do {
    const page = await get<{ items: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>('https://www.googleapis.com/youtube/v3/playlistItems', {
      part: 'contentDetails', playlistId: channel.contentDetails.relatedPlaylists.uploads, maxResults: '50', ...(pageToken ? { pageToken } : {}),
    });
    page.items.forEach(item => ids.add(item.contentDetails.videoId));
    pageToken = page.nextPageToken || '';
    if (pageToken && seenTokens.has(pageToken)) throw new Error('Repeated metadata page token.');
    seenTokens.add(pageToken);
  } while (pageToken);
  // Include available videos that earned historical views but are absent from today's uploads listing.
  const videoReport = bundle.reports.find(report => report.name === 'top-videos')?.data;
  const videoColumn = videoReport?.columnHeaders.findIndex(header => header.name === 'video') ?? -1;
  if (videoColumn >= 0) videoReport?.rows?.forEach(row => ids.add(String(row[videoColumn])));
  const allIds = [...ids];
  for (let offset = 0; offset < allIds.length; offset += 50) {
    const chunk = allIds.slice(offset, offset + 50);
    const metadata = await get<{ items: { id: string; snippet: { title: string; publishedAt: string; channelId: string }; contentDetails: { duration: string } }[] }>('https://www.googleapis.com/youtube/v3/videos', { part: 'snippet,contentDetails', id: chunk.join(',') });
    for (const video of metadata.items) {
      if (video.snippet.channelId !== CHANNEL_ID) throw new Error('Video metadata belongs to an unexpected channel.');
      bundle.videos.push({ id: video.id, title: video.snippet.title, publishedAt: video.snippet.publishedAt, duration: video.contentDetails.duration });
    }
  }
  // The documented multi-video filter allows adding video as a dimension to the daily report.
  // This retains zero-view catalogue entries in metadata without inventing daily rows for them.
  for (let offset = 0; offset < allIds.length; offset += 50) {
    const query = {
      ids: `channel==${CHANNEL_ID}`, startDate: start, endDate: end,
      dimensions: 'day,video,creatorContentType', metrics: METRICS,
      filters: `video==${allIds.slice(offset, offset + 50).join(',')}`, sort: 'day,video,creatorContentType',
    };
    const name = `video-daily-${String(offset / 50 + 1).padStart(3, '0')}`;
    try { bundle.reports.push({ name, query, status: 'ok', data: await fetchReport(get, query) }); }
    catch (error) { bundle.complete = false; bundle.reports.push({ name, query, status: 'error', error: (error as Error).message }); }
  }
  await mkdir('.tmp/youtube-encrypted', { recursive: true });
  await writeFile('.tmp/youtube-encrypted/report.enc.json', JSON.stringify(encryptBundle(bundle, publicKey)));
  console.log(`Encrypted report prepared. Collection status: ${bundle.complete ? 'complete' : 'partial; inspect local manifest'}.`);
}
main().catch(() => { console.error('Collection failed. No credentials or raw API errors were logged. Check the workflow stage and required configuration.'); process.exitCode = 1; });
