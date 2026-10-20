// Anonymous page-view counts. Only aggregate daily counters are persisted.
const PUBLIC_ORIGIN = 'https://idfcjapan.github.io';
const PUBLIC_BASE = '/idfc-website';
const TIMEZONE = 'Asia/Tokyo';
const MAX_BODY_BYTES = 4096;
const DAY_MS = 86400000;
const START_KEY = 'collection_started_at';
const BOT_AGENT = /bot\b|crawler|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|bingpreview|ChatGPT-User|Claude-User|Perplexity|Google-InspectionTool|python-requests|curl\/|wget\//i;
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const dayAt = timestamp => dayFormatter.format(new Date(timestamp));
const knownPaths = pages => new Set(pages.map(page => page.path));

export function canonicalAnalyticsPath(value, pages) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/')) return null;
  let path;
  try { path = decodeURIComponent(value); } catch { return null; }
  if (/[?#\u0000-\u001f\u007f\\]/.test(path) || path.startsWith('//')) return null;
  if (path === PUBLIC_BASE || path.startsWith(PUBLIC_BASE + '/')) path = path.slice(PUBLIC_BASE.length) || '/';
  if (path.endsWith('/index.html')) path = path.slice(0, -10);
  if (!path.endsWith('/')) path += '/';
  if (!knownPaths(pages).has(path)) return null;
  if (path.startsWith('/en/')) path = path.slice(3);
  if (['/idfc2027/', '/idfc2027/活動/', '/idfc2027/実行委員/', '/idfc2027/資料/'].includes(path)) path = '/idfc2027/';
  return path;
}

function corsHeaders(request) {
  const origin = request.headers.get('origin');
  if (origin !== PUBLIC_ORIGIN && origin !== new URL(request.url).origin) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin',
    'cache-control': 'no-store',
  };
}

async function readSmallJSON(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    return { error: 'JSONが必要です。', status: 415 };
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    return { error: '入力のサイズが上限を超えています。', status: 413 };
  }
  const reader = request.body?.getReader();
  if (!reader) return { error: '入力内容を確認してください。', status: 400 };
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { error: '入力のサイズが上限を超えています。', status: 413 };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !Object.hasOwn(body, 'path')) throw new Error('Invalid body');
    return { body };
  } catch {
    return { error: '入力内容を確認してください。', status: 400 };
  }
}

export async function recordPublicView(request, env, pages, now = Date.now()) {
  const headers = corsHeaders(request);
  if (!headers) return json({ error: 'このサイトからの記録は許可されていません。' }, 403);
  if (request.method === 'OPTIONS') {
    if (request.headers.get('access-control-request-method') !== 'POST') return json({ error: 'POST only' }, 405, headers);
    const requestedHeaders = (request.headers.get('access-control-request-headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (requestedHeaders.some(value => value !== 'content-type')) return json({ error: '許可されていないヘッダーです。' }, 403, headers);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, { ...headers, allow: 'POST, OPTIONS' });
  const input = await readSmallJSON(request);
  if (input.error) return json({ error: input.error }, input.status, headers);
  const path = canonicalAnalyticsPath(input.body.path, pages);
  if (!path) return json({ error: 'ページが見つかりません。' }, 404, headers);
  // A preview iframe never represents a public page view. User-agent filtering
  // is intentionally best-effort; these are PV totals, not unique visitors.
  if (request.headers.get('sec-fetch-dest') === 'iframe' || BOT_AGENT.test(request.headers.get('user-agent') || '')) {
    return new Response(null, { status: 204, headers });
  }
  if (!env.DB) return json({ error: '閲覧数を記録できませんでした。' }, 503, headers);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO analytics_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(START_KEY, now),
      env.DB.prepare('INSERT INTO page_views_daily (day, path, views) VALUES (?, ?, 1) ON CONFLICT(day, path) DO UPDATE SET views = views + 1').bind(dayAt(now), path),
    ]);
    return new Response(null, { status: 204, headers });
  } catch (error) {
    console.error('Page-view recording failed:', error.message);
    return json({ error: '閲覧数を記録できませんでした。' }, 503, headers);
  }
}

// The caller must authenticate before invoking this handler. It never sets CORS
// headers, so private analytics cannot be read from the public GitHub site.
export async function editorAnalytics(request, env, pages, now = Date.now()) {
  const url = new URL(request.url);
  const rawDays = url.searchParams.get('days') || '30';
  if (!['30', 'all'].includes(rawDays)) return json({ error: '表示期間は「過去30日」か「今まで全部」を選んでください。' }, 400);
  const rawPath = url.searchParams.get('path');
  const path = rawPath === null ? null : canonicalAnalyticsPath(rawPath, pages);
  if (rawPath !== null && path === null) return json({ error: 'ページが見つかりません。' }, 404);
  if (!env.DB) return json({ error: '閲覧数を読み込めませんでした。' }, 503);
  const days = rawDays === 'all' ? 'all' : 30;
  const today = dayAt(now);
  const result = await env.DB.batch([
    days === 'all'
      ? env.DB.prepare('SELECT day, path, views FROM page_views_daily WHERE day <= ? ORDER BY day, path').bind(today)
      : env.DB.prepare('SELECT day, path, views FROM page_views_daily WHERE day >= ? AND day <= ? ORDER BY day, path').bind(dayAt(now - 29 * DAY_MS), today),
    env.DB.prepare('SELECT path, SUM(views) AS views FROM page_views_daily GROUP BY path'),
    env.DB.prepare('SELECT value FROM analytics_metadata WHERE key = ?').bind(START_KEY),
  ]);
  const collectionStartedAt = result[2].results?.[0]?.value ?? null;
  const collectionStartedDate = collectionStartedAt === null ? null : dayAt(collectionStartedAt);
  const allFrom = collectionStartedDate && collectionStartedDate <= today ? collectionStartedDate : today;
  const dayCount = days === 'all'
    ? Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(allFrom + 'T00:00:00Z')) / DAY_MS) + 1
    : 30;
  const dates = Array.from({ length: dayCount }, (_, index) => dayAt(now - (dayCount - index - 1) * DAY_MS));
  const from = dates[0], to = dates.at(-1);
  const dailyRows = result[0].results || [];
  const totals = new Map((result[1].results || []).map(row => [row.path, Number(row.views)]));
  const dailyTotals = new Map(dates.map(date => [date, 0]));
  const periodTotals = new Map();
  for (const row of dailyRows) {
    if (row.day < from || row.day > to) continue;
    const views = Number(row.views);
    periodTotals.set(row.path, (periodTotals.get(row.path) || 0) + views);
    if (path === null || row.path === path) dailyTotals.set(row.day, (dailyTotals.get(row.day) || 0) + views);
  }
  const listedPages = new Map();
  for (const page of pages) {
    if (page.path.startsWith('/en/')) continue;
    const canonical = canonicalAnalyticsPath(page.path, pages);
    if (!canonical || page.path !== canonical || listedPages.has(canonical)) continue;
    listedPages.set(canonical, { path: canonical, title: page.title, total: periodTotals.get(canonical) || 0, allTimeTotal: totals.get(canonical) || 0 });
  }
  const daily = dates.map(date => ({ date, views: dailyTotals.get(date) }));
  const partialDates = [...new Set([to, collectionStartedDate].filter(date => date && date >= from && date <= to))];
  return json({
    path, days, timezone: TIMEZONE, period: { from, to },
    total: daily.reduce((sum, day) => sum + day.views, 0),
    allTimeTotal: path === null ? [...totals.values()].reduce((sum, views) => sum + views, 0) : totals.get(path) || 0,
    collectionStartedAt, collectionStartedDate, partialDates, daily, pages: [...listedPages.values()],
  });
}
