import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC_SITE_URL, normalizePublicPage, normalizePublicSitemap } from '../source/public-seo.mjs';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
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
    if (path.relative(root, file).split(path.sep)[0] === 'edit') continue;
    const route = '/' + path.relative(root, file).split(path.sep).join('/').replace(/index\.html$/, '');
    const original = await readFile(file, 'utf8');
    const normalized = normalizePublicPage(original, route);
    if (normalized !== original) await writeFile(file, normalized);
    pages++;
  }

  const sitemapFile = path.join(root, 'sitemap.xml');
  const sitemap = normalizePublicSitemap(await readFile(sitemapFile, 'utf8'));
  await writeFile(sitemapFile, sitemap.text);

  const robotsFile = path.join(root, 'robots.txt');
  const robots = await readFile(robotsFile, 'utf8');
  const sitemapDirective = 'Sitemap: ' + PUBLIC_SITE_URL + 'sitemap.xml';
  await writeFile(robotsFile, /^Sitemap:/mi.test(robots)
    ? robots.replace(/^Sitemap:[^\r\n]*/gmi, sitemapDirective)
    : robots.replace(/\s*$/, '\n') + sitemapDirective + '\n');
  return { pages, sitemapURLs: sitemap.count, verificationFiles };
}
