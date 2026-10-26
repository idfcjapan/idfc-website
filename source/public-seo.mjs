// Keep the public publication and editor service aligned on one set of URLs.
export const PUBLIC_SITE_URL = 'https://idfcjapan.github.io/idfc-website/';

const yearAliases = new Set([
  '/idfc2027/活動/',
  '/idfc2027/実行委員/',
  '/idfc2027/資料/',
]);

export function canonicalPath(value) {
  const path = decodeURIComponent(value || '/');
  if (!path.startsWith('/') || /[?#]/.test(path)) throw new Error('Expected a page route.');
  const english = path.startsWith('/en/');
  const route = english ? path.slice(3) : path;
  return yearAliases.has(route) ? (english ? '/en' : '') + '/idfc2027/' : path;
}

export function publicPageURL(path, baseURL = PUBLIC_SITE_URL) {
  const base = new URL(baseURL);
  if (!base.pathname.endsWith('/') || base.search || base.hash) throw new Error('Public URL must end in a slash.');
  return base.href + canonicalPath(path).slice(1).split('/').map(encodeURIComponent).join('/');
}
