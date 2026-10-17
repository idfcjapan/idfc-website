// Apply the bilingual advisor messages to the static source without regenerating
// the imported site or losing earlier messages. Run before build-pages.mjs.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const site = path.join(root, 'site');
const people = JSON.parse(await readFile(path.join(root, 'source/advisor-messages.json'), 'utf8'));
const origin = 'https://idfc-japan-myanmar.hannaowo.chatgpt.site';
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const route = (p, en) => `${en ? '/en' : ''}/${encodeURIComponent('アドバイザー')}/${encodeURIComponent(p.slug)}/`;
const directory = en => `${en ? '/en' : ''}/${encodeURIComponent('アドバイザー')}/`;
async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(path.join(dir, e.name)) : path.join(dir, e.name)))).flat();
}

// Translate displayed names and metadata, retaining the original Japanese in
// data-i18n-source attributes for future editing.
for (const file of (await files(path.join(site, 'en'))).filter(p => p.endsWith('.html'))) {
  let html = await readFile(file, 'utf8');
  html = html.replace(/<[^>]+>|[^<]+/g, token => {
    const rename = s => s.replace(/Professor 松田\s*正彦/g, 'Masahiko Matsuda, Professor').replace(/Professor (?:根本[　 ]敬|Takashi Nemoto)/g, 'Takashi Nemoto, Professor Emeritus').replace(/根本[　 ]敬/g, 'Takashi Nemoto')
      .replace('The exchanges you have during university give you a direction in life', 'Student exchanges can help you find your path in life');
    return token.startsWith('<') ? token.replace(/\b(content|aria-label|alt)="([^"]*)"/g, (_, attr, val) => `${attr}="${rename(val)}"`) : rename(token);
  });
  await writeFile(file, html);
}

for (const en of [false, true]) {
  const lang = en ? 'en' : 'ja';
  const template = await readFile(path.join(site, en ? 'en' : '', 'アドバイザー/松田-正彦-教授/index.html'), 'utf8');
  for (const person of people) {
    const data = person[lang];
    const file = path.join(site, en ? 'en' : '', 'アドバイザー', person.slug, 'index.html');
    let html = person.id === 'khaing' ? template : await readFile(file, 'utf8');
    let old = '';
    if (person.id !== 'khaing') {
      old = html.match(/<div class="advisor-earlier-content">([\s\S]*?)<\/div><\/details>/)?.[1]
        ?? html.match(/<article class="legacy-content"[^>]*>([\s\S]*?)<nav class="page-neighbors"/)?.[1] ?? '';
      if (en && person.id === 'nemoto') {
        const earlier = [
          'Interest in Myanmar (Burma) has grown in Japan in recent years. Too often, however, that interest is limited to commercial opportunities or the immediate pleasures of tourism. As university students, you have a precious opportunity to think independently, ask questions, and build relationships without the obligations of working life. Through these encounters, you can discover how you want to live and the values you share with others. Make the most of this time.',
          'If Myanmar interests you, begin by reading about its culture, history, and the challenges it faces. Then get to know its people directly. IDFC offers a valuable space that students from Japan and Myanmar create together. Through its projects, build relationships as equals, free from competing professional interests—relationships that can be harder to find once you enter working life. These experiences can help you find your path and give you the strength to pursue it.'
        ];
        old = old.replace(/(<div class="cc-m-textwithimage-inline-rte"[^>]*>)[\s\S]*?(<\/div>)/, (_, start, end) => start + earlier.map(p => `<p>${esc(p)}</p>`).join('') + end);
      }
    }
    const image = person.id === 'khaing' ? '' : html.match(/<img\b[^>]*data-image-id[^>]*>/)?.[0] ?? '';
    const next = people[(people.indexOf(person) + 1) % people.length];
    const main = `<main id="main" class="advisor-detail"><div class="wrap"><nav class="breadcrumbs" aria-label="${en ? 'Breadcrumbs' : 'パンくず'}"><ol><li><a href="${en ? '/en/' : '/'}">${en ? 'Home' : 'ホーム'}</a></li><li><a href="${directory(en)}">${en ? 'Advisors' : 'アドバイザー'}</a></li><li aria-current="page">${esc(data.name)}</li></ol></nav><header class="page-masthead"><p class="eyebrow">${en ? 'Advisors' : 'アドバイザー'}</p><h1>${esc(data.name)}</h1></header><div class="article-layout"><article class="advisor-message"><div class="advisor-identity${image ? ' has-photo' : ''}">${image ? `<figure>${image}</figure>` : ''}<p class="advisor-affiliation">${esc(data.affiliation)}</p></div><section aria-labelledby="advisor-message-title"><h2 id="advisor-message-title">${en ? 'Message to IDFC' : 'IDFCへのメッセージ'}</h2>${data.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</section>${old ? `<details class="advisor-earlier"><summary>${en ? 'Earlier message' : 'これまでのメッセージ'}</summary><div class="advisor-earlier-content">${old}</div></details>` : ''}<nav class="page-neighbors" aria-label="${en ? 'More advisors' : '他のアドバイザー'}"><a href="${directory(en)}">${en ? '← All advisors' : '← アドバイザー一覧'}</a><a href="${route(next, en)}">${esc(next[lang].name)} →</a></nav></article></div></div></main>`;
    if (person.id === 'khaing') {
      const identity = part => part.replaceAll(encodeURIComponent('松田-正彦-教授'), encodeURIComponent(person.slug)).replaceAll('松田-正彦-教授', person.slug)
        .replaceAll('Masahiko Matsuda, Professor', data.name).replaceAll('松田 正彦 教授', person.ja.name).replaceAll('松田正彦教授', person.ja.name);
      html = html.replace(/<head>[\s\S]*?<\/head>/, identity)
        .replace(/<nav\b[^>]*class="language-switch"[^>]*>[\s\S]*?<\/nav>/, identity);
      html = html.replace(/(<ul id="nav-4"[^>]*>)([\s\S]*?)(<\/ul>)/, (_, start, items, end) =>
        start + items.replaceAll('class="is-current"', 'class=""').replaceAll(' aria-current="page"', '') + end);
      // Only clone the shell; its page-specific descriptions must match Khaing.
      html = html.replace(/<meta\b[^>]*(?:name="description"|name="twitter:description"|property="og:description")[^>]*>/g, '');
      html = html.replace('</title>', `</title><meta name="description" content="${esc(data.affiliation)} — ${en ? 'Message to IDFC' : 'IDFCへのメッセージ'}">`);
    }
    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/, `<title>${esc(data.name)} - IDFC</title>`);
    html = html.replace(/<main\b[\s\S]*?<\/main>/, main);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
  }
  const index = path.join(site, en ? 'en' : '', 'アドバイザー/index.html');
  let html = await readFile(index, 'utf8');
  const khaing = people[2];
  html = html.replace(/href="#advisor-khaing"/g, `href="${route(khaing, en)}"`);
  html = html.replace(/(<article class="advisor-card advisor-khaing"[^>]*>)[\s\S]*?<\/article>/, `$1<h2 class="advisor-name">${esc(khaing[lang].name)}</h2><p class="advisor-affiliation">${esc(khaing[lang].affiliation)}</p><a class="text-link" href="${route(khaing, en)}">${en ? 'Read the message →' : 'メッセージを読む →'}</a></article>`);
  await writeFile(index, html);
}

// Offer direct PDF viewing alongside the existing web reader and download.
let brochures = 0;
for (const file of (await files(site)).filter(p => p.endsWith('.html'))) {
  let html = await readFile(file, 'utf8');
  if (!html.includes('href="/assets/idfc2027/brochure.pdf"') || html.includes('data-brochure-open')) continue;
  const en = /<html\b[^>]*lang="en"/.test(html);
  html = html.replace(/<a\b[^>]*href="\/assets\/idfc2027\/brochure\.pdf"[^>]*download[^>]*>/g,
    link => `<a class="text-link brochure-open" data-brochure-open href="/assets/idfc2027/brochure.pdf" target="_blank" rel="noopener">${en ? 'Open PDF ↗' : 'PDFを開く ↗'}</a>${link}`);
  await writeFile(file, html);
  brochures++;
}

const sitemapFile = path.join(site, 'sitemap.xml');
let sitemap = await readFile(sitemapFile, 'utf8');
for (const en of [false, true]) {
  const url = origin + route(people[2], en);
  if (!sitemap.includes(url)) sitemap = sitemap.replace('</urlset>', `<url><loc>${url}</loc></url></urlset>`);
}
await writeFile(sitemapFile, sitemap);
const pagesFile = path.join(root, 'worker/pages.json');
const pages = JSON.parse(await readFile(pagesFile, 'utf8'));
for (const en of [false, true]) {
  const p = `${en ? '/en' : ''}/アドバイザー/${people[2].slug}/`;
  if (!pages.some(page => page.path === p)) pages.push({ path: p, title: `${people[2][en ? 'en' : 'ja'].name} - IDFC` });
}
await writeFile(pagesFile, JSON.stringify(pages, null, 2) + '\n');
console.log(JSON.stringify({ advisor_pages: people.length * 2, brochure_pages_updated: brochures }));
