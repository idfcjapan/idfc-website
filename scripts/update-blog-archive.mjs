// Label historic blog links by their publication period in both languages.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const site = path.resolve(import.meta.dirname, '../site');
async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(path.join(dir, e.name)) : path.join(dir, e.name)))).flat();
}
const archives = [
  { name: 'Pando', year: 2023, href: 'https://pando.life/idfc-japan-myanmar',
    ja: '実行委員による活動報告や、本会議を通して感じたことを掲載しています。',
    en: 'Activity reports and reflections on the conferences, written by organizing committee members.' },
  { name: 'IDFC Japan Blog', year: 2019, href: 'https://idfc-jp-2016.hatenablog.com/',
    ja: 'はてなブログに掲載された、これまでの活動やメンバーの紹介をご覧いただけます。',
    en: 'Earlier activity reports and member introductions published on Hatena Blog.' }
];
for (const en of [false, true]) {
  for (const slug of ['blog', 'blog-1']) {
    const file = path.join(site, en ? 'en' : '', slug, 'index.html');
    let html = await readFile(file, 'utf8');
    const cards = archives.map(a => `<section class="blog-archive-card"><p class="blog-period">${en ? `Through ${a.year}` : `〜${a.year}年`}</p><h2>${a.name}</h2><p>${a[en ? 'en' : 'ja']}</p><a class="text-link" href="${a.href}" target="_blank" rel="noopener noreferrer">${en ? 'Read past articles ↗' : '過去の記事を読む ↗'}</a></section>`).join('');
    const body = `<div class="article-layout"><article class="blog-archive"><p class="blog-archive-intro">${en ? 'Explore past IDFC activities and members’ stories by publication period.' : 'これまでのIDFCの活動やメンバーの想いを、掲載時期ごとにご覧いただけます。'}</p><div class="blog-archive-grid">${cards}</div><p class="blog-current">${en ? 'For current activities, see ' : '現在の活動については、'}<a href="${en ? '/en' : ''}/idfc2027/">IDFC2027</a>${en ? '.' : 'をご覧ください。'}</p></article></div>`;
    html = html.replace(/<div class="article-layout\b[\s\S]*?<\/main>/, body + '</div></main>');
    await writeFile(file, html);
  }
}

let updated = 0;
for (const file of (await files(site)).filter(f => f.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  const en = /<html\b[^>]*lang="en"/.test(html);
  const next = html.replace(/(<a\b[^>]*href="([^"]+)"[^>]*>)([\s\S]*?)(<\/a>)/g, (whole, opening, href, inner, closing) => {
    const year = /idfc-jp-2016\.hatenablog\.com/.test(href) ? 2019
      : /pando\.life\/idfc-japan-myanmar\/?$/.test(href) || /^\/(?:en\/)?blog(?:-1)?\/$/.test(href) ? 2023 : null;
    if (!year || !/^(?:IDFC\s*)?(?:Blog|ブログ)$/i.test(inner.replace(/<[^>]*>/g, '').trim())) return whole;
    const period = en ? ` (through ${year})` : `（〜${year}年）`;
    opening = opening.replace(/\b(aria-label|title)="((?:IDFC\s*)?(?:Blog|ブログ))"/gi, (_, attr, label) => `${attr}="${label}${period}"`);
    if (inner.includes('social-name')) inner = inner.replace(/(<span\b[^>]*class="social-name"[^>]*>)([\s\S]*?)(<\/span>)/, (_, start, label, end) => start + label + `<span class="blog-period-label">${period}</span>` + end);
    else inner += `<span class="blog-period-label">${period}</span>`;
    return opening + inner + closing;
  });
  if (next !== html) { await writeFile(file, next); updated++; }
}
console.log(JSON.stringify({ blog_pages: 4, pages_with_period_labels: updated }));
