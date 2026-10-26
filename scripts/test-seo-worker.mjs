// Exercise only a local workerd instance and disposable D1 database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { canonicalPath, publicPageURL } from '../source/public-seo.mjs';

const { Miniflare } = createRequire(createRequire(import.meta.url).resolve('wrangler/package.json'))('miniflare');
const directory = await mkdtemp(join(tmpdir(), 'idfc-seo-'));
const service = 'https://editor.test';
const mf = new Miniflare({
  modules: true, scriptPath: resolve('dist/server/index.js'), compatibilityDate: '2026-05-15',
  d1Databases: ['DB'], d1Persist: join(directory, 'db'),
  assets: { directory: resolve('dist/client'), binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
});
let checks = 0;
const check = (value, note) => { assert.ok(value, note); checks++; };
const equal = (actual, expected, note) => { assert.deepEqual(actual, expected, note); checks++; };
const request = (route, options) => mf.dispatchFetch(service + encodeURI(route), options);
const head = html => html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
const main = html => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
const attribute = (tag, name) => tag.match(new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i'))?.[1];
function metadata(html) {
  const result = { canonical: [], ogURL: [], languages: {} };
  for (const tag of head(html).matchAll(/<(?:link|meta)\b[^>]*>/gi)) {
    if (attribute(tag[0], 'rel') === 'canonical') result.canonical.push(attribute(tag[0], 'href'));
    if (attribute(tag[0], 'property') === 'og:url') result.ogURL.push(attribute(tag[0], 'content'));
    if (attribute(tag[0], 'rel') === 'alternate' && attribute(tag[0], 'hreflang')) result.languages[attribute(tag[0], 'hreflang')] = attribute(tag[0], 'href');
  }
  return result;
}

try {
  equal(publicPageURL('/'), 'https://idfcjapan.github.io/idfc-website/', 'Public home URL is preserved');
  equal(publicPageURL('/en/idfc2027/%E6%B4%BB%E5%8B%95/'), 'https://idfcjapan.github.io/idfc-website/en/idfc2027/', 'Encoded English compatibility URL has the English hub canonical');
  equal(canonicalPath('/idfc2027/資料/団体概要/'), '/idfc2027/資料/団体概要/', 'Distinct documents are not folded into the hub');
  equal(publicPageURL('/about-idfc/', 'https://example.test/preview/'), 'https://example.test/preview/about-idfc/', 'Pages build can use an explicit publication base');

  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort()) {
    for (const sql of (await readFile('drizzle/' + file, 'utf8')).split('--> statement-breakpoint')) if (sql.trim()) await db.prepare(sql.trim()).run();
  }

  const examples = [
    ['/', '', ''], ['/en/', '', 'en/'],
    ['/about-idfc/', 'about-idfc/', 'about-idfc/'],
    ['/en/about-idfc/', 'about-idfc/', 'en/about-idfc/'],
    ['/idfc2027/', 'idfc2027/', 'idfc2027/'],
    ['/en/idfc2027/', 'idfc2027/', 'en/idfc2027/'],
    ...['活動', '実行委員', '資料'].flatMap(alias => [
      ['/idfc2027/' + alias + '/', 'idfc2027/', 'idfc2027/'],
      ['/en/idfc2027/' + alias + '/', 'idfc2027/', 'en/idfc2027/'],
    ]),
  ];
  for (const [route, japanesePath, preferredPath] of examples) {
    const response = await request(route);
    equal(response.status, 200, 'Viewer still serves ' + route);
    equal(response.headers.get('x-robots-tag'), null, 'Public viewer is not marked noindex: ' + route);
    const html = await response.text();
    const preferred = 'https://idfcjapan.github.io/idfc-website/' + preferredPath;
    equal(metadata(html), {
      canonical: [preferred], ogURL: [preferred],
      languages: {
        ja: 'https://idfcjapan.github.io/idfc-website/' + japanesePath,
        en: 'https://idfcjapan.github.io/idfc-website/en/' + japanesePath,
        'x-default': 'https://idfcjapan.github.io/idfc-website/' + japanesePath,
      },
    }, 'Only public publication URLs are signaled in head: ' + route);
    const source = await readFile(join('dist/client', route, 'index.html'), 'utf8');
    equal(main(html), main(source), 'Static main content and viewer links remain intact: ' + route);
  }

  const saved = {
    ja: '<section id="seo-saved-content"><h1>保存済みの紹介</h1><a href="/edit/">編集</a></section>',
    en: '<section id="seo-saved-content"><h1>Saved introduction</h1><a href="/edit/">Edit</a></section>',
  };
  await db.prepare('INSERT INTO page_edits (path, html, revision, updated_at) VALUES (?, ?, ?, ?)')
    .bind('@bilingual:main:/', JSON.stringify(saved), 1, Date.now()).run();
  for (const [route, language] of [['/', 'ja'], ['/en/', 'en']]) {
    const html = await (await request(route)).text();
    equal(main(html), saved[language], 'Saved CMS content and editor links remain unchanged: ' + language);
    check(metadata(html).canonical[0].startsWith('https://idfcjapan.github.io/idfc-website/'), 'Saved content does not overwrite canonical metadata');
  }

  for (const route of ['/edit/', '/edit', '/en/edit/', '/api/editor/session', '/api/editor/preview?path=%2F', '/api/public/content?path=%2F']) {
    const response = await request(route, { redirect: 'manual' });
    equal(response.headers.get('x-robots-tag'), 'noindex', 'Editor and API response stays out of search: ' + route);
    if (route.startsWith('/api/editor/')) equal(response.status, 401, 'Editor API still requires authentication');
    if (route === '/edit/') {
      equal(response.status, 200, 'Member editor still loads');
      check((await response.text()).includes('日英'), 'Member editor markup is preserved');
    }
  }
  const bundle = await (await request('/api/public/content?path=%2F')).json();
  equal(bundle.content.main.html, saved.ja, 'Public content API still returns the saved fragment');
  const sitemap = await request('/sitemap.xml', { redirect: 'manual' });
  equal(sitemap.status, 301, 'Editor-service sitemap permanently points to the public sitemap');
  equal(sitemap.headers.get('location'), 'https://idfcjapan.github.io/idfc-website/sitemap.xml', 'Sitemap redirect preserves the existing public URL');
  equal(await (await request('/robots.txt')).text(), 'User-agent: *\nAllow: /\nSitemap: https://idfcjapan.github.io/idfc-website/sitemap.xml\n', 'Robots discovery advertises only the public sitemap while allowing canonical signals to be crawled');
  const headResponse = await request('/en/', { method: 'HEAD' });
  equal(headResponse.status, 200, 'Viewer HEAD still succeeds');
  equal(await headResponse.text(), '', 'Viewer HEAD still has no body');
  equal(headResponse.headers.get('x-robots-tag'), null, 'Viewer HEAD remains indexable');
  console.log(JSON.stringify({ result: 'pass', runtime: 'Cloudflare workerd / Miniflare', assertions: checks, publicCanonicals: true, aliasesConsolidated: true, cmsPreserved: true, editorNoindex: true }));
} finally {
  await mf.dispose();
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('idfc-seo-')) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
}
