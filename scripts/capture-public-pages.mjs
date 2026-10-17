import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run manually when importing the current public content from the editing service.
// Publishing to GitHub Pages itself uses only the files committed in this repository.
const root = path.resolve(import.meta.dirname, '..');
const sourceOrigin = 'https://idfc-japan-myanmar.hannaowo.chatgpt.site';
const pages = JSON.parse(await readFile(path.join(root, 'worker/pages.json'), 'utf8'));
const uploadedImages = new Set();
let cursor = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (cursor < pages.length) {
    const page = pages[cursor++];
    const response = await fetch(new URL(encodeURI(page.path), sourceOrigin), { signal: AbortSignal.timeout(45000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error(`Could not capture ${page.path}: ${response.status}`);
    // The former host injects its own challenge script; it is not site content.
    const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,
      script => script.includes('/cdn-cgi/challenge-platform/') ? '' : script);
    if (!html.includes('id="main"')) throw new Error(`Unexpected public page: ${page.path}`);
    for (const match of html.matchAll(/\/uploads\/images\/[a-f0-9-]+\.(?:jpg|png|webp|gif)/g)) uploadedImages.add(match[0]);
    const destination = path.join(root, 'site', page.path, 'index.html');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, html);
  }
}));
for (const image of uploadedImages) {
  const response = await fetch(sourceOrigin + image, { signal: AbortSignal.timeout(45000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Could not capture ${image}`);
  const destination = path.join(root, 'site', image);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
}
console.log(JSON.stringify({ captured_pages: pages.length, captured_uploaded_images: uploadedImages.size }));
