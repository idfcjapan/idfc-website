import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'site');
const output = path.join(root, '_site');
const publicURL = new URL(process.env.PAGES_URL || 'https://idfcjapan.github.io/idfc-website/');
if (!publicURL.pathname.endsWith('/')) throw new Error('PAGES_URL must end in a slash.');
const previousOrigin = 'https://idfc-japan-myanmar.hannaowo.chatgpt.site';
const editorURL = `${previousOrigin}/edit/`;
const base = publicURL.pathname;
const designVersion = createHash('sha256').update(await readFile(path.join(source, 'assets/css/design.css'))).digest('hex').slice(0, 12);
const scriptVersion = createHash('sha256').update(await readFile(path.join(source, 'assets/js/site.js'))).update(await readFile(path.join(source, 'assets/js/content-sync.js'))).update(await readFile(path.join(source, 'assets/js/analytics.js'))).digest('hex').slice(0, 12);

export function rewriteURL(value) {
  if (value === '/edit/' || value === '/edit' || value === '/en/edit/' || value === editorURL) return editorURL;
  if (value.startsWith(previousOrigin + '/')) return publicURL.href + value.slice(previousOrigin.length + 1);
  if (value.startsWith('/') && !value.startsWith('//')) return base + value.slice(1);
  return value;
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(path.join(directory, entry.name)) : path.join(directory, entry.name)));
  return nested.flat();
}

if (path.dirname(output) !== root || path.basename(output) !== '_site') throw new Error('Unexpected build directory.');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
const all = await files(output);
let pages = 0;
for (const file of all) {
  if (!/\.(html|css|xml|txt|svg)$/i.test(file)) continue;
  let text = await readFile(file, 'utf8');
  if (file.endsWith('.html')) {
    pages++;
    // Select the scripted layout before the first stylesheet can paint. The
    // deferred bundle may wait for saved bilingual content before wiring menus.
    text = text.replace(/<head>/i, '<head><script>document.documentElement.classList.add("js")</script>');
    // Include the third advisor's individual message page in the shared menu.
    const advisorMenu = /(<ul\b[^>]*id="nav-4"[^>]*>)([\s\S]*?)(<\/ul>)/;
    if (!advisorMenu.test(text)) throw new Error(`Missing advisor menu: ${file}`);
    const english = /<html\b[^>]*lang="en"/.test(text);
    const advisorHref = (english ? '/en' : '') + '/' + encodeURIComponent('アドバイザー') + '/' + encodeURIComponent('ナンミャケーカイン-特別研究員') + '/';
    const advisorLabel = english ? 'Nan Mya Khaing, Research Fellow' : 'ナンミャケーカイン 特別研究員';
    const currentAdvisor = file.includes('ナンミャケーカイン-特別研究員');
    text = text.replace(advisorMenu, (whole, opening, items, closing) =>
      items.includes(encodeURIComponent('ナンミャケーカイン-特別研究員')) ? whole
        : opening + items + `<li class="${currentAdvisor ? 'is-current' : ''}"><a href="${advisorHref}"${currentAdvisor ? ' aria-current="page"' : ''}>${advisorLabel}</a></li>` + closing);
    text = text.replace(/\b(href|src|poster|action|data-src|data-original|data-url|content)=(['"])(.*?)\2/gs,
      (_, attribute, quote, value) => `${attribute}=${quote}${rewriteURL(value)}${quote}`);
    text = text.replace(/\bsrcset=(['"])(.*?)\1/gs, (_, quote, value) => {
      if (value.includes('data:')) return `srcset=${quote}${value}${quote}`;
      return `srcset=${quote}${value.split(',').map(item => item.replace(/^(\s*)(\S+)/, (_, space, url) => space + rewriteURL(url))).join(',')}${quote}`;
    });
    text = text.replace(/href=(['"])([^'"]*\/assets\/css\/design\.css)(?:\?[^'"]*)?\1/g,
      (_, quote, url) => `href=${quote}${url}?v=${designVersion}${quote}`);
    text = text.replace(/src=(['"])([^'"]*\/assets\/js\/site\.js)(?:\?[^'"]*)?\1/g,
      (_, quote, url) => `src=${quote}${url}?v=${scriptVersion}${quote}`);
  }
  // Translation metadata also contains the old canonical URLs.
  text = text.replaceAll(editorURL, '__IDFC_EDITOR_URL__')
    .replaceAll(previousOrigin + '/', publicURL.href)
    .replaceAll('__IDFC_EDITOR_URL__', editorURL);
  text = text.replace(/url\((['"]?)(\/(?!\/)[^)'"\s]+)\1\)/g,
    (_, quote, url) => `url(${quote}${rewriteURL(url)}${quote})`);
  if (!file.endsWith('.html')) text = text.replaceAll(previousOrigin + '/', publicURL.href);
  await writeFile(file, text);
}
await writeFile(path.join(output, '.nojekyll'), '');

// Check every local page, stylesheet, image and document reference after rebasing.
const missing = new Set();
let references = 0;
for (const file of all.filter(file => file.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  const pageURL = new URL(path.relative(output, file).split(path.sep).join('/'), publicURL);
  for (const match of html.matchAll(/\b(?:href|src|poster)=(['"])(.*?)\1/gs)) {
    let url;
    try { url = new URL(match[2].replaceAll('&amp;', '&'), pageURL); } catch { continue; }
    if (url.origin !== publicURL.origin) continue;
    if (!url.pathname.startsWith(base)) throw new Error(`Reference escapes the Pages base path: ${url.href}`);
    references++;
    let local = path.join(output, decodeURIComponent(url.pathname.slice(base.length)));
    try { if ((await stat(local)).isDirectory()) local = path.join(local, 'index.html'); await stat(local); }
    catch { missing.add(url.pathname); }
  }
  if (!html.includes('rel="canonical"')) throw new Error(`Missing canonical URL: ${file}`);
  if (/hannaowo\.chatgpt\.site/.test(html.replaceAll(editorURL, ''))) throw new Error(`Old public hostname remains: ${file}`);
}
if (missing.size) throw new Error(`Missing local targets (${missing.size}):\n${[...missing].join('\n')}`);
console.log(JSON.stringify({ public_url: publicURL.href, pages, checked_references: references }));
