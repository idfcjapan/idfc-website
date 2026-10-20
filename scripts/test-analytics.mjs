// Uses only a disposable local D1 database. Never contacts or edits production.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { canonicalAnalyticsPath, recordPublicView, editorAnalytics } from '../worker/analytics.js';

const { Miniflare } = createRequire(createRequire(import.meta.url).resolve('wrangler/package.json'))('miniflare');
const pages = JSON.parse(await readFile('worker/pages.json', 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'idfc-analytics-'));
const base = 'https://editor.test', publicOrigin = 'https://idfcjapan.github.io';
const password = randomBytes(25).toString('base64url');
const settings = {
  modules: true, scriptPath: resolve('dist/server/index.js'), compatibilityDate: '2026-05-15',
  d1Databases: ['DB'], d1Persist: join(directory, 'db'), r2Buckets: ['BUCKET'], r2Persist: join(directory, 'r2'),
  bindings: { EDITOR_PASSWORD: password },
  assets: { directory: resolve('dist/client'), binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
};
let mf, cookie = '', csrf = '', checks = 0;
const check = (value, note) => { assert.ok(value, note); checks++; };
const equal = (a, b, note) => { assert.deepEqual(a, b, note); checks++; };
async function request(path, { method = 'GET', body, auth = false, origin = base, headers = {} } = {}) {
  return mf.dispatchFetch(base + path, {
    method,
    headers: {
      ...(origin === null ? {} : { origin }),
      ...(auth ? { cookie, 'x-csrf-token': csrf } : {}),
      ...(body === undefined || body instanceof Uint8Array ? {} : { 'content-type': 'application/json' }),
      'user-agent': 'Mozilla/5.0 IDFC analytics verification', ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) }),
  });
}
const privateURL = '/api/editor/analytics';
const publicURL = '/api/public/views';
const analytics = async query => {
  const response = await request(privateURL + (query ? '?' + query : ''), { auth: true });
  equal(response.status, 200, 'Authenticated analytics response');
  return response.json();
};
const post = (path = '/', options = {}) => request(publicURL, { method: 'POST', body: { path }, origin: publicOrigin, ...options });
const schemaKeys = ['allTimeTotal', 'collectionStartedAt', 'collectionStartedDate', 'daily', 'days', 'pages', 'partialDates', 'path', 'period', 'timezone', 'total'].sort();
const dayMS = 86400000;
// Independent JST calculation; assertions do not reuse the production formatter.
const jstDay = timestamp => new Date(timestamp + 9 * 3600000).toISOString().slice(0, 10);

async function testTracker() {
  const source = (await readFile('site/assets/js/analytics.js', 'utf8')).replace('export function recordPageView', 'function recordPageView') + '\nthis.recordPageView = recordPageView;';
  function tracker({ origin = publicOrigin, path = '/idfc-website/about-idfc/', hidden = false, prerendering = false, iframe = false, webdriver = false, ua = 'Mozilla/5.0', reject = false } = {}) {
    const calls = [], events = new Map(), window = {};
    window.self = window; window.top = iframe ? {} : window;
    const document = {
      visibilityState: hidden ? 'hidden' : 'visible', prerendering,
      addEventListener(name, listener, options) { events.set(name, { listener, options }); },
      removeEventListener(name, listener) { if (events.get(name)?.listener === listener) events.delete(name); },
    };
    const sandbox = { window, document, navigator: { webdriver, userAgent: ua }, location: { origin, pathname: path },
      fetch: (...args) => { calls.push(args); return reject ? Promise.reject(new Error('Offline')) : Promise.resolve({ ok: true }); } };
    runInNewContext(source, sandbox, { filename: 'analytics.js' });
    return { ...sandbox, calls, events, record: () => sandbox.recordPageView() };
  }
  const normal = tracker(); normal.record(); normal.record();
  equal(normal.calls.length, 1, 'Public tracker sends at most once per page load');
  const [url, options] = normal.calls[0];
  equal(url, 'https://idfc-japan-myanmar.hannaowo.chatgpt.site/api/public/views', 'Tracker uses existing editing service');
  equal(JSON.parse(options.body), { path: '/about-idfc/' }, 'Tracker strips GitHub publication prefix');
  equal({ method: options.method, mode: options.mode, credentials: options.credentials, cache: options.cache, keepalive: options.keepalive },
    { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', keepalive: true }, 'Tracker never sends credentials or cached counters');
  equal(Object.keys(JSON.parse(options.body)), ['path'], 'Tracker sends no visitor identity or page query');
  const service = tracker({ origin: 'https://idfc-japan-myanmar.hannaowo.chatgpt.site', path: '/en/about-idfc/' }); service.record();
  equal(JSON.parse(service.calls[0][1].body), { path: '/en/about-idfc/' }, 'Service-hosted public pages are counted');
  for (const variant of [
    { origin: 'http://localhost:5173' }, { origin: 'https://unrelated.test' },
    { path: '/other-project/' }, { iframe: true }, { webdriver: true },
    { path: '/idfc-website/edit/' }, { path: '/idfc-website/en/edit/' },
    { path: '/idfc-website/api/public/views' }, { path: '/idfc-website/assets/js/site.js' },
    { path: '/idfc-website/uploads/images/test.jpg' },
  ]) { const item = tracker(variant); item.record(); equal(item.calls.length, 0, 'Tracker excludes ' + JSON.stringify(variant)); }
  for (const ua of ['Googlebot', 'Bingbot', 'Crawler', 'Spider', 'HeadlessChrome', 'Lighthouse', 'facebookexternalhit', 'Slurp']) {
    const item = tracker({ ua }); item.record(); equal(item.calls.length, 0, 'Tracker excludes automated agent ' + ua);
  }
  for (const variant of [{ hidden: true }, { prerendering: true }]) {
    const item = tracker(variant); item.record(); equal(item.calls.length, 0, 'Unseen/prerendered page does not count');
    check(item.events.has('visibilitychange'), 'Tracker waits for visible publication');
    item.events.get('visibilitychange').listener();
    equal(item.calls.length, 0, 'Repeated visibility events while still hidden do not count');
    check(item.events.has('visibilitychange'), 'Still-hidden callback preserves visibility observation');
    item.document.visibilityState = 'visible'; item.document.prerendering = false;
    item.events.get('visibilitychange').listener(); item.record();
    equal(item.calls.length, 1, 'Visible publication counts exactly once after deferred start');
    check(!item.events.has('visibilitychange'), 'Visibility observer is removed after a successful visible start');
  }
  const offline = tracker({ reject: true }); offline.record(); await Promise.resolve(); offline.record();
  equal(offline.calls.length, 1, 'Offline recording fails safely without retries or duplicate page views');
}

try {
  mf = new Miniflare(settings);
  let db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort()) {
    for (const sql of (await readFile('drizzle/' + file, 'utf8')).split('--> statement-breakpoint')) if (sql.trim()) await db.prepare(sql.trim()).run();
  }
  for (const query of ['', '?days=all', '?path=%2Fen%2F']) equal((await request(privateURL + query)).status, 401, 'Analytics requires editor authentication');
  const privatePublicOrigin = await request(privateURL, { origin: publicOrigin });
  equal(privatePublicOrigin.status, 401, 'Public origin cannot access private analytics');
  check(!privatePublicOrigin.headers.has('access-control-allow-origin'), 'Private analytics has no public CORS grant');
  const login = await request('/api/editor/login', { method: 'POST', body: { password } });
  equal(login.status, 200, 'Local test login succeeds'); cookie = login.headers.get('set-cookie').split(';')[0]; csrf = (await login.json()).csrf;
  const empty = await analytics();
  equal(Object.keys(empty).sort(), schemaKeys, 'Analytics exposes only aggregate contract');
  equal([empty.path, empty.days, empty.timezone, empty.total, empty.allTimeTotal, empty.collectionStartedAt, empty.collectionStartedDate], [null, 30, 'Asia/Tokyo', 0, 0, null, null], 'Empty database has honest zero totals and no invented collection start');
  equal(empty.daily.length, 30, 'Default month is zero-filled'); check(empty.daily.every(row => row.views === 0), 'Empty days are zeros');
  const emptyAll = await analytics('days=all');
  equal([emptyAll.days, emptyAll.total, emptyAll.allTimeTotal, emptyAll.collectionStartedAt], ['all', 0, 0, null], 'All-history view retains honest empty metadata');
  equal(emptyAll.daily.length, 1, 'All-history view without collection history shows today only');
  equal(emptyAll.period, { from: emptyAll.daily[0].date, to: emptyAll.daily[0].date }, 'Empty all-history range does not invent prior collection dates');
  check(empty.pages.length > 0 && empty.pages.every(row => row.total === 0 && row.allTimeTotal === 0), 'Known publications appear with zero totals');
  equal(new Set(empty.pages.map(row => row.path)).size, empty.pages.length, 'Language pairs and aliases have one publication row');
  check(empty.pages.every(row => !row.path.startsWith('/en/') && !/^\/idfc2027\/(活動|実行委員|資料)\/$/.test(row.path)), 'Listing omits duplicate languages and year aliases');
  check(empty.pages.every(row => row.title === pages.find(page => page.path === row.path)?.title), 'All publication titles use the canonical Japanese page');
  equal(empty.pages.find(page => page.path === '/about-idfc/').title, 'IDFCについて - IDFC日本ミャンマー学生会議', 'Page picker labels the canonical Japanese publication');
  for (const days of ['0', '1', '7', '8', '31', '90', '91', '-7', '7.0', 'seven', '7%20', '007', 'ALL', 'all%20']) equal((await request(privateURL + '?days=' + days, { auth: true })).status, 400, 'Only past 30 days and all-history periods are accepted: ' + days);
  for (const path of ['/not-real/', '/edit/', '/api/', '/assets/', '/about-idfc/?secret=x', '//evil.test/', '/%ZZ', '/about-idfc/../']) {
    equal((await request(privateURL + '?path=' + encodeURIComponent(path), { auth: true })).status, 404, 'Invalid analytics path rejected: ' + path);
  }
  const privateRead = await request(privateURL, { auth: true, origin: publicOrigin });
  check(!privateRead.headers.has('access-control-allow-origin'), 'Authenticated analytics never grants GitHub CORS');
  equal(privateRead.headers.get('cache-control'), 'no-store', 'Private counts are never cacheable');
  equal((await request(privateURL, { method: 'POST', auth: true, body: {} })).status, 404, 'Analytics endpoint is read-only');

  const preflight = await request(publicURL, { method: 'OPTIONS', origin: publicOrigin, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  equal(preflight.status, 204, 'GitHub JSON tracker CORS preflight succeeds');
  equal(preflight.headers.get('access-control-allow-origin'), publicOrigin, 'CORS grants exact GitHub origin');
  check(!preflight.headers.has('access-control-allow-credentials'), 'Public tracker has no credential grant');
  equal((await request(publicURL, { method: 'OPTIONS', origin: 'https://evil.test', headers: { 'access-control-request-method': 'POST' } })).status, 403, 'Unrelated CORS origin rejected');
  equal((await request(publicURL, { method: 'OPTIONS', origin: publicOrigin, headers: { 'access-control-request-method': 'DELETE' } })).status, 405, 'Preflight cannot grant mutating methods');
  equal((await request(publicURL, { method: 'OPTIONS', origin: publicOrigin, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' } })).status, 403, 'Preflight cannot grant arbitrary headers');
  for (const method of ['GET', 'PUT', 'DELETE']) equal((await request(publicURL, { method, origin: publicOrigin })).status, 405, 'Public counter rejects ' + method);
  equal((await post('/', { origin: null })).status, 403, 'Missing Origin cannot create a count');
  equal((await post('/', { origin: 'https://evil.test' })).status, 403, 'Unrelated Origin cannot create a count');
  equal((await post('/', { headers: { 'content-type': 'text/plain' } })).status, 415, 'Non-JSON body rejected');
  equal((await post('/', { body: '{' })).status, 400, 'Malformed JSON rejected');
  for (const body of [{}, [], null, { path: '/' , ip: '198.51.100.42' }, { path: 2 }, { path: null }]) {
    const expected = body && !Array.isArray(body) && Object.keys(body).length === 1 ? 404 : 400;
    equal((await post('/', { body })).status, expected, 'Malformed or non-path payload rejected: ' + JSON.stringify(body));
  }
  equal((await post('/not-real/')).status, 404, 'Unknown publication never creates an arbitrary series');
  equal((await post('/' + 'x'.repeat(5000))).status, 413, 'Streaming body is bounded');
  // Direct invocation avoids the HTTP client's own length-mismatch rejection.
  const declaredOversize = new Request(base + publicURL, { method: 'POST', headers: { origin: publicOrigin, 'content-type': 'application/json', 'content-length': '5000' }, body: '{"path":"/"}' });
  equal((await recordPublicView(declaredOversize, { DB: db }, pages)).status, 413, 'Declared oversized request rejected before JSON parsing');
  for (const agent of ['Googlebot/2.1', 'Bingbot', 'HeadlessChrome', 'Lighthouse', 'curl/8.0', 'python-requests/2.0', 'ChatGPT-User/1.0', 'Claude-User', 'PerplexityBot']) {
    equal((await post('/', { headers: { 'user-agent': agent } })).status, 204, 'Known automated client ignored without disrupting content: ' + agent);
  }
  equal((await post('/', { headers: { 'sec-fetch-dest': 'iframe' } })).status, 204, 'Embedded editor preview excluded');
  equal((await analytics()).allTimeTotal, 0, 'Preflight, invalid payloads, bots and previews do not create counts');
  equal((await analytics()).collectionStartedAt, null, 'Ignored requests do not invent a collection start');

  const startedBefore = Date.now();
  const concurrent = await Promise.all(Array.from({ length: 32 }, () => post('/')));
  check(concurrent.every(response => response.status === 204), 'Concurrent public views are accepted');
  for (const path of ['/en/', '/idfc-website/en/index.html', '/about-idfc/', '/en/about-idfc/index.html', '/idfc2027/', '/en/idfc2027/', '/idfc2027/活動/', '/idfc2027/実行委員/', '/idfc2027/資料/', '/en/idfc2027/活動/', '/en/idfc2027/実行委員/', '/en/idfc2027/資料/']) {
    const response = await post(path); equal(response.status, 204, 'Known language/alias counts: ' + path);
    check(!response.headers.has('set-cookie'), 'Public view never creates an editor or tracking cookie');
    equal(await response.text(), '', 'Public response reveals no metrics or secrets');
  }
  equal((await post('/about-idfc/', { origin: base, headers: { 'cf-connecting-ip': '198.51.100.42' } })).status, 204, 'Public service origin also records a view');
  const counted = await analytics('days=30');
  equal(counted.allTimeTotal, 45, 'Atomic upserts preserve every concurrent increment');
  equal(counted.total, 45, 'Current period equals accepted counts');
  equal(counted.pages.find(page => page.path === '/').allTimeTotal, 34, 'Japanese and English home pages share one total');
  equal(counted.pages.find(page => page.path === '/about-idfc/').allTimeTotal, 3, 'English index.html normalizes to publication');
  equal(counted.pages.find(page => page.path === '/idfc2027/').allTimeTotal, 8, 'All year hub aliases share one total');
  check(counted.collectionStartedAt >= startedBefore && counted.collectionStartedAt <= Date.now(), 'First accepted view establishes actual collection timestamp');
  equal(counted.collectionStartedDate, jstDay(counted.collectionStartedAt), 'Collection start is described in Japan time');
  const filtered = await analytics('days=30&path=%2Fen%2Fidfc2027%2F%E6%B4%BB%E5%8B%95%2F');
  equal([filtered.path, filtered.total, filtered.allTimeTotal], ['/idfc2027/', 8, 8], 'Filtered English alias resolves to canonical publication');
  equal(filtered.pages, counted.pages, 'Per-page picker totals stay comprehensive while chart is filtered');
  const countedAll = await analytics('days=all');
  equal([countedAll.days, countedAll.total, countedAll.allTimeTotal], ['all', 45, 45], 'All-history view includes every accepted request');
  equal(countedAll.period.from, counted.collectionStartedDate, 'All-history chart begins on actual first collection date');
  const serialized = JSON.stringify(counted);
  check(![password, csrf, cookie, '198.51.100.42', 'Mozilla'].some(value => serialized.includes(value)), 'Aggregate response contains no credentials or visitor data');
  equal((await db.prepare('PRAGMA table_info(page_views_daily)').all()).results.map(column => column.name), ['day', 'path', 'views'], 'View storage has no visitor or device identity columns');
  equal((await db.prepare('SELECT COUNT(*) AS count FROM page_edits').first()).count, 0, 'Analytics tests never publish or save page content');
  await mf.dispose(); mf = new Miniflare(settings); db = await mf.getD1Database('DB');
  const persisted = await analytics();
  equal(persisted.allTimeTotal, 45, 'Counters survive local service restart');
  equal(persisted.collectionStartedAt, counted.collectionStartedAt, 'Original collection start survives service restart');

  // Deterministic handler checks use the same disposable D1, with a controlled
  // clock that straddles midnight in Japan while the UTC date remains unchanged.
  await db.batch([db.prepare('DELETE FROM page_views_daily'), db.prepare('DELETE FROM analytics_metadata')]);
  const now = Date.parse('2026-10-20T15:00:01.000Z');
  const directRecord = async (at, path = '/') => recordPublicView(new Request(base + publicURL, { method: 'POST', headers: { origin: publicOrigin, 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' }, body: JSON.stringify({ path }) }), { DB: db }, pages, at);
  equal((await directRecord(now - 2000)).status, 204, 'View immediately before Japan midnight records');
  equal((await directRecord(now - 1000, '/en/')).status, 204, 'English view immediately after Japan midnight records');
  equal((await db.prepare('SELECT day, path, views FROM page_views_daily ORDER BY day').all()).results,
    [{ day: '2026-10-20', path: '/', views: 1 }, { day: '2026-10-21', path: '/', views: 1 }], 'Counters roll over at Japan midnight rather than UTC midnight');
  equal((await db.prepare("SELECT value FROM analytics_metadata WHERE key='collection_started_at'").first()).value, now - 2000, 'First accepted timestamp remains immutable after Japan midnight');
  const seeds = [[0, '/', 3], [6, '/', 2], [7, '/', 3], [29, '/', 4], [30, '/', 5], [89, '/', 6], [90, '/', 7], [0, '/about-idfc/', 10], [29, '/about-idfc/', 20], [90, '/about-idfc/', 30]];
  await db.batch(seeds.map(([offset, path, count]) => db.prepare('INSERT INTO page_views_daily(day,path,views) VALUES(?,?,?) ON CONFLICT(day,path) DO UPDATE SET views=views+excluded.views').bind(jstDay(now - offset * dayMS), path, count)));
  // Historical seeded counters must have the matching actual collection start.
  const historyStart = now - 90 * dayMS;
  await db.prepare("UPDATE analytics_metadata SET value=? WHERE key='collection_started_at'").bind(historyStart).run();
  const directGet = async (days, path) => {
    const query = new URLSearchParams({ days: String(days) }); if (path !== undefined) query.set('path', path);
    const response = await editorAnalytics(new Request(base + privateURL + '?' + query), { DB: db }, pages, now);
    equal(response.status, 200, 'Controlled-clock analytics succeeds'); return response.json();
  };
  for (const [days, length, total, homeTotal] of [[30, 30, 44, 14], ['all', 91, 92, 32]]) {
    const summary = await directGet(days), home = await directGet(days, '/en/index.html');
    equal(summary.days, days, 'Response identifies the selected 30-day or all-history range');
    equal(summary.daily.length, length, 'Selected range contains every day through today');
    equal(summary.daily.map(row => row.date), Array.from({ length }, (_, index) => jstDay(now - (length - index - 1) * dayMS)), 'Date series is continuous, sorted and Japan-local');
    equal(summary.period, { from: jstDay(now - (length - 1) * dayMS), to: '2026-10-21' }, 'Both date-range boundaries are inclusive');
    equal([summary.total, summary.allTimeTotal, home.total, home.allTimeTotal], [total, 92, homeTotal, 32], 'Window totals exclude older views while all-time totals retain them');
    equal(summary.daily.at(-1), { date: '2026-10-21', views: 14 }, 'Japan-local current date aggregates all publications');
    equal(home.daily.at(-1), { date: '2026-10-21', views: 4 }, 'Filtered current date aggregates only selected publication');
    equal(summary.daily.find(row => row.date === '2026-10-20').views, 1, 'Previous Japan date remains separate');
    check(summary.daily.filter(row => row.views === 0).length > 0, 'Unvisited dates stay present as zeros');
    equal(summary.collectionStartedAt, historyStart, 'True history start accompanies both ranges');
    equal(summary.collectionStartedDate, jstDay(historyStart), 'Start day uses Japan time');
    equal([...summary.partialDates].sort(), days === 'all' ? [jstDay(historyStart), '2026-10-21'] : ['2026-10-21'], 'Only in-range first collection day and current day are marked incomplete');
    equal(summary.pages.find(page => page.path === '/about-idfc/').total, days === 'all' ? 60 : 30, 'Page table uses the selected period');
  }
  const noViews = await directGet('all', '/about/');
  equal([noViews.total, noViews.allTimeTotal], [0, 0], 'Known page with no views is a valid empty series');
  check(noViews.daily.every(row => row.views === 0), 'Empty selected publication is zero-filled');
  const leapStart = Date.parse('2024-02-28T15:00:00.000Z'); // Japan: leap day.
  await db.batch([
    db.prepare("UPDATE analytics_metadata SET value=? WHERE key='collection_started_at'").bind(leapStart),
    db.prepare('INSERT INTO page_views_daily(day,path,views) VALUES(?,?,?)').bind('2024-02-29', '/', 9),
    db.prepare('INSERT INTO page_views_daily(day,path,views) VALUES(?,?,?)').bind('2024-03-01', '/', 10),
  ]);
  const years = await directGet('all');
  equal(years.period, { from: '2024-02-29', to: '2026-10-21' }, 'All-history chart spans the actual collection start across calendar years');
  equal(years.daily.length, Math.floor((Date.parse('2026-10-21') - Date.parse('2024-02-29')) / dayMS) + 1, 'All-history date count includes leap day and is not capped at 90 or 365 days');
  equal(years.daily.slice(0, 2), [{ date: '2024-02-29', views: 9 }, { date: '2024-03-01', views: 10 }], 'All-history retains oldest recorded days in order');
  equal([years.total, years.allTimeTotal], [111, 111], 'All-history series reconciles with every stored view');
  equal(years.daily.at(-1), { date: '2026-10-21', views: 14 }, 'All-history ends on current Japan date');
  const recentAfterHistory = await directGet(30);
  equal([recentAfterHistory.total, recentAfterHistory.allTimeTotal], [44, 111], 'Past 30 days stays independent of older all-history records');
  for (const [input, expected] of [['/', '/'], ['/en', '/'], ['/idfc-website/', '/'], ['/idfc-website/en/about-idfc/index.html', '/about-idfc/'], ['/en/idfc2027/%E8%B3%87%E6%96%99/', '/idfc2027/'], ['/not-real/', null], ['https://evil.test/', null], ['/about-idfc/#x', null], ['/about-idfc/?x=y', null], ['/about-idfc/\\x', null]]) {
    equal(canonicalAnalyticsPath(input, pages), expected, 'Canonical path contract: ' + input);
  }
  await testTracker();
  equal((await request('/api/editor/logout', { method: 'POST', auth: true })).status, 200, 'Test editor session logs out');
  equal((await request(privateURL, { auth: true })).status, 401, 'Revoked editor session cannot read analytics');
  const result = { result: 'pass', runtime: 'Cloudflare workerd / Miniflare + deterministic Node handlers + browser tracker VM', assertions: checks,
    productionWrites: false, privateAnalyticsAuthentication: true, aggregateOnly: true, atomicConcurrentViews: 32,
    bilingualAndAliasAggregation: true, japanMidnightBoundary: true, periods: [30, 'all'], zeroFilledDates: true, allHistoryCalendarYearsAndLeapDay: true,
    collectionStartAndPartialDates: true, publicOriginAndBodyValidation: true, botAndPreviewExclusions: true,
    publicTrackerPrivacyAndFailureSafety: true, persistenceAcrossRestart: true };
  await mkdir('reports', { recursive: true }); await writeFile('reports/qa-analytics.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  if (mf) await mf.dispose();
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('idfc-analytics-')) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
}
