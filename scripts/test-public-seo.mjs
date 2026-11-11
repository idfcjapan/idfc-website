import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PUBLIC_SITE_URL, normalizePublicPage, normalizePublicSitemap, pageDescription, publicationRoute, publicPageURL } from '../source/public-seo.mjs';
import { normalizePublicSEO } from './normalize-public-seo.mjs';

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const equal = (value, expected, message) => { assert.deepEqual(value, expected, message); checks++; };
const attribute = (tag, name) => tag.match(new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i'))?.[1];
const head = html => html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
const body = html => html.slice(html.indexOf('</head>') + 7);
const description = html => attribute([...head(html).matchAll(/<meta\b[^>]*>/g)].find(match => attribute(match[0], 'name') === 'description')?.[0] || '', 'content');
async function files(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : join(directory, entry.name)))).flat();
}

equal(publicationRoute('https://idfcjapan.github.io/idfc-website/en/about-idfc/'), '/en/about-idfc/', 'GitHub publication prefix is stripped exactly once');
equal(publicationRoute(PUBLIC_SITE_URL + 'about-idfc/'), '/about-idfc/', 'Official GitHub URL is accepted');
equal(publicationRoute('https://idfc-japan-myanmar.hannaowo.chatgpt.site/about-idfc/'), '/about-idfc/', 'Legacy Sites URL is accepted for normalization');
equal(publicPageURL('/en/idfc2027/%E6%B4%BB%E5%8B%95/'), PUBLIC_SITE_URL + 'en/idfc2027/', 'Japanese encoded alias maps to English hub');
assert.throws(() => publicationRoute('https://example.com/about-idfc/')); checks++;
equal(publicationRoute('https://idfcjapan.github.io/en/about-idfc/'), '/en/about-idfc/', 'Root GitHub URL is accepted');
equal(pageDescription('/', { existing: 'Keep this existing description.' }), 'Keep this existing description.', 'Nonblank descriptions remain unchanged');
for (const route of ['/about-idfc/', '/新規スポンサー様募集/', '/お問合せ/']) {
  const ja = pageDescription(route, { og: 'Old fees 95,000 yen; February; 30 students' });
  const en = pageDescription('/en' + route, { og: 'Old fees 95,000 yen; February; 30 students' });
  check(/[ぁ-ん一-龯]/.test(ja) && /^[A-Z]/.test(en), 'Curated description preserves the language pair: ' + route);
  check(!/95,000|February|30 students/.test(ja + en), 'Curated metadata adds no stale fees, dates or participant promises');
}
const escaped = pageDescription('/archive/', { og: 'A &amp; B &quot;exchange&quot;\n' + 'word '.repeat(100) });
check(escaped.startsWith('A & B "exchange"'), 'Existing description entities are decoded before safe re-escaping');
check(Array.from(pageDescription('/en/archive/', { og: 'word '.repeat(100) })).length <= 220, 'English description has a bounded excerpt');
check(Array.from(pageDescription('/archive/', { og: '交流😀'.repeat(100) })).length <= 150, 'Japanese truncation preserves Unicode characters');

let pages = 0, filled = 0;
for (const file of (await files('site')).filter(file => file.endsWith('.html'))) {
  const route = '/' + file.replaceAll('\\', '/').replace(/^site\//, '').replace(/index\.html$/, '');
  // The editor and not-found pages are tools, not published pages (as in build-pages.mjs).
  if (/^\/google[a-f0-9]+\.html$/.test(route) || route.startsWith('/edit/') || route === '/404.html') continue;
  const original = await readFile(file, 'utf8');
  const normalized = normalizePublicPage(original, route);
  equal(body(normalized), body(original), 'Content, CMS hooks and navigation remain unchanged: ' + route);
  equal(normalizePublicPage(normalized, route), normalized, 'Metadata normalization is idempotent: ' + route);
  check(Boolean(description(normalized)), 'Every published page has a description: ' + route);
  check(head(normalized).includes('rel="canonical" href="' + publicPageURL(route) + '"'), 'Canonical points to GitHub Pages: ' + route);
  if (!description(original)) filled++;
  const organization = normalized.match(/<script\b[^>]*id="idfc-organization"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (organization) {
    const schema = JSON.parse(organization);
    equal([schema.url, schema['@id'], schema.logo], [PUBLIC_SITE_URL, PUBLIC_SITE_URL + '#organization', PUBLIC_SITE_URL + 'assets/images/idfc-logo.svg'], 'Organization identity is consistent with the preferred publication');
  }
  pages++;
}

const directory = await mkdtemp(join(tmpdir(), 'idfc-public-seo-'));
try {
  await mkdir(join(directory, 'en'), { recursive: true });
  await writeFile(join(directory, 'index.html'), await readFile('site/index.html'));
  await writeFile(join(directory, 'en/index.html'), await readFile('site/en/index.html'));
  const proof = Buffer.from('google-site-verification: googleabcdef.html');
  await writeFile(join(directory, 'googleabcdef.html'), proof);
  const mixed = '<?xml version="1.0"?><urlset>' + [
    'https://idfc-japan-myanmar.hannaowo.chatgpt.site/', PUBLIC_SITE_URL,
    'https://idfcjapan.github.io/idfc-website/idfc2027/',
    'https://idfcjapan.github.io/idfc-website/idfc2027/%E6%B4%BB%E5%8B%95/',
    'https://idfcjapan.github.io/idfc-website/en/',
  ].map(url => '<url><loc>' + url + '</loc></url>').join('') + '</urlset>';
  await writeFile(join(directory, 'sitemap.xml'), mixed);
  await writeFile(join(directory, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://idfcjapan.github.io/idfc-website/sitemap.xml\n');
  equal(await normalizePublicSEO(directory), { pages: 2, sitemapURLs: 3, verificationFiles: 1 }, 'Static build accepts both origins, removes duplicates and aliases, and preserves proof');
  equal(await readFile(join(directory, 'googleabcdef.html')), proof, 'Ownership proof bytes remain untouched');
  const sitemap = await readFile(join(directory, 'sitemap.xml'), 'utf8');
  equal(normalizePublicSitemap(sitemap), { text: sitemap, count: 3 }, 'Published sitemap normalization is idempotent');
  check(!sitemap.includes('chatgpt.site') && [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].every(match => match[1].startsWith(PUBLIC_SITE_URL)), 'Sitemap contains only official GitHub URLs');
  equal(await readFile(join(directory, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\nSitemap: ' + PUBLIC_SITE_URL + 'sitemap.xml\n', 'Robots advertises the official GitHub sitemap');
} finally {
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('idfc-public-seo-')) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ result: 'pass', assertions: checks, pages, blankDescriptionsFilled: filled, contentPreserved: true, canonical: PUBLIC_SITE_URL }));
