// Saved bilingual edits are public website content; no editor credentials or
// third-party translation API is used by visitors.
const service = 'https://idfc-japan-myanmar.hannaowo.chatgpt.site';
const pagesOrigin = 'https://idfcjapan.github.io';
const pagesBase = '/idfc-website';

export function publicURL(value, origin = pagesOrigin, base = pagesBase, sourceOrigin = service) {
  if (!value || value.startsWith('#') || /^(?:mailto:|tel:|data:)/i.test(value)) return value;
  let url;
  try { url = new URL(value, sourceOrigin); } catch { return value; }
  if (url.origin !== sourceOrigin && url.origin !== pagesOrigin) return value;
  let route = url.pathname;
  if (url.origin === pagesOrigin && route.startsWith(pagesBase + '/')) route = route.slice(pagesBase.length);
  if (route.startsWith('/uploads/') || route === '/edit/' || route.startsWith('/api/')) return sourceOrigin + route + url.search + url.hash;
  return origin + base + route + url.search + url.hash;
}

export function rebaseFragment(html, doc = document, options = {}) {
  const template = doc.createElement('template');
  template.innerHTML = html;
  // The service sanitizes published HTML. Remove executable markup here as a
  // second boundary before inserting cross-origin public content.
  template.content.querySelectorAll('script,style,object,embed,base,link,meta').forEach(el => el.remove());
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') element.removeAttribute(attribute.name);
    }
    for (const attribute of ['href', 'src', 'poster', 'action', 'data-src']) {
      const value = element.getAttribute(attribute);
      if (value !== null) element.setAttribute(attribute, publicURL(value, options.pageOrigin, options.base, options.serviceOrigin));
    }
    element.removeAttribute('srcset');
    if (element.tagName === 'A' && element.target === '_blank') element.rel = 'noopener noreferrer';
  }
  return template.content;
}

export async function syncPublishedContent(options = {}) {
  const {pageOrigin = pagesOrigin, base = pagesBase, serviceOrigin = service} = options;
  if (location.origin !== pageOrigin || !location.pathname.startsWith(base + '/')) return;
  const path = decodeURIComponent(location.pathname.slice(base.length));
  const url = new URL('/api/public/content', serviceOrigin);
  url.searchParams.set('path', path);
  try {
    const response = await fetch(url, {credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(3500)});
    if (!response.ok) return;
    const data = await response.json();
    if (data.path !== path || !data.content || data.language !== (path.startsWith('/en/') ? 'en' : 'ja')) return;
    const selectors = {main: 'main#main', header: 'header.site-header', footer: 'footer.site-footer'};
    for (const [scope, selector] of Object.entries(selectors)) {
      const record = data.content[scope];
      const target = document.querySelector(selector);
      if (target && typeof record?.html === 'string') target.replaceChildren(rebaseFragment(record.html, document, {pageOrigin, base, serviceOrigin}));
    }
  } catch {
    // The complete static GitHub publication remains available if the editing
    // service is temporarily unreachable.
  }
}
