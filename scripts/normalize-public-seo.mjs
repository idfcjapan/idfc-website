import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC_SITE_URL, canonicalPath, publicPageURL } from '../source/public-seo.mjs';

const publication = new URL(PUBLIC_SITE_URL);
const editorOrigin = 'https://idfc-japan-myanmar.hannaowo.chatgpt.site';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
}

function attribute(tag, name) {
  return tag.match(new RegExp('\\b' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i'))?.[2];
}

function replaceAttribute(tag, name, value) {
  if (attribute(tag, name) === undefined) throw new Error('Missing ' + name + ' in SEO metadata.');
  return tag.replace(new RegExp('(\\b' + name + '\\s*=\\s*)(["\'])([\\s\\S]*?)\\2', 'i'),
    (_, prefix, quote) => prefix + quote + value + quote);
}

function sitemapRoute(value) {
  const url = new URL(value);
  if (![editorOrigin, publication.origin].includes(url.origin)) throw new Error('Unexpected sitemap origin: ' + url.origin);
  const route = url.origin === publication.origin && url.pathname.startsWith(publication.pathname)
    ? '/' + url.pathname.slice(publication.pathname.length) : url.pathname;
  return decodeURIComponent(route);
}

// Some hosting runtimes serve static assets before invoking the Worker. Keep
// their search metadata aligned without altering the saved content or editor.
export async function normalizePublicSEO(directory) {
  const root = path.resolve(directory);
  const all = await files(root);
  let pages = 0, verificationFiles = 0;
  for (const file of all.filter(file => file.endsWith('.html'))) {
    const name = path.basename(file);
    if (path.dirname(file) === root && /^google[a-f0-9]+\.html$/.test(name)) {
      if (!(await readFile(file)).equals(Buffer.from('google-site-verification: ' + name, 'utf8')))
        throw new Error('Invalid Google ownership verification file: ' + name);
      verificationFiles++;
      continue;
    }
    const route = '/' + path.relative(root, file).split(path.sep).join('/').replace(/index\.html$/, '');
    const basePath = route.startsWith('/en/') ? route.slice(3) : route;
    let canonicals = 0, ogURLs = 0;
    const languages = new Set();
    const original = await readFile(file, 'utf8');
    const normalized = original.replace(/(<head\b[^>]*>)([\s\S]*?)(<\/head>)/i, (_, opening, head, closing) => {
      const rewritten = head.replace(/<(?:link|meta)\b[^>]*>/gi, tag => {
        if (/^<link\b/i.test(tag) && attribute(tag, 'rel') === 'canonical') {
          canonicals++;
          return replaceAttribute(tag, 'href', publicPageURL(route));
        }
        if (/^<meta\b/i.test(tag) && attribute(tag, 'property') === 'og:url') {
          ogURLs++;
          return replaceAttribute(tag, 'content', publicPageURL(route));
        }
        if (/^<link\b/i.test(tag) && attribute(tag, 'rel') === 'alternate' && attribute(tag, 'hreflang')) {
          const language = attribute(tag, 'hreflang');
          if (!['ja', 'en', 'x-default'].includes(language)) throw new Error('Unexpected hreflang: ' + language);
          languages.add(language);
          return replaceAttribute(tag, 'href', publicPageURL((language === 'en' ? '/en' : '') + basePath));
        }
        return tag;
      });
      return opening + rewritten + closing;
    });
    if (canonicals !== 1 || ogURLs !== 1 || languages.size !== 3) throw new Error('Incomplete public SEO metadata: ' + file);
    if (normalized !== original) await writeFile(file, normalized);
    pages++;
  }

  const sitemapFile = path.join(root, 'sitemap.xml');
  const locations = new Set();
  const sitemap = (await readFile(sitemapFile, 'utf8')).replace(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g, (entry, value) => {
    const route = sitemapRoute(value);
    if (canonicalPath(route) !== route) return '';
    const canonical = publicPageURL(route);
    if (locations.has(canonical)) return '';
    locations.add(canonical);
    return entry.replace('<loc>' + value + '</loc>', '<loc>' + canonical + '</loc>');
  });
  await writeFile(sitemapFile, sitemap);

  const robotsFile = path.join(root, 'robots.txt');
  const robots = await readFile(robotsFile, 'utf8');
  const sitemapDirective = 'Sitemap: ' + PUBLIC_SITE_URL + 'sitemap.xml';
  await writeFile(robotsFile, /^Sitemap:/mi.test(robots)
    ? robots.replace(/^Sitemap:[^\r\n]*/gmi, sitemapDirective)
    : robots.replace(/\s*$/, '\n') + sitemapDirective + '\n');
  return { pages, sitemapURLs: locations.size, verificationFiles };
}
