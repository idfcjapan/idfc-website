// Aggregate page views only: no cookies, visitor identifiers or personal data.
const service = 'https://idfc-japan-myanmar.hannaowo.chatgpt.site';
const publicOrigin = 'https://idfcjapan.github.io';
const publicBase = '/idfc-website';

export function recordPageView() {
  if (window.top !== window.self || navigator.webdriver || window.__idfcViewRecorded) return;
  if (/bot|crawler|spider|headless|lighthouse|preview|facebookexternalhit|slurp/i.test(navigator.userAgent)) return;
  let path = location.pathname;
  if (location.origin === publicOrigin && path.startsWith(publicBase + '/')) path = path.slice(publicBase.length);
  else if (location.origin !== service) return;
  if (/^\/(?:en\/)?(?:edit|api|assets|uploads)(?:\/|$)/.test(path)) return;
  if (document.prerendering || document.visibilityState === 'hidden') {
    const visible = () => {
      if (document.prerendering || document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', visible);
      document.removeEventListener('prerenderingchange', visible);
      recordPageView();
    };
    document.addEventListener('visibilitychange', visible);
    document.addEventListener('prerenderingchange', visible);
    return;
  }
  window.__idfcViewRecorded = true;
  void fetch(service + '/api/public/views', {
    method:'POST', mode:'cors', credentials:'omit', cache:'no-store', keepalive:true,
    headers:{'content-type':'application/json'}, body:JSON.stringify({path}),
  }).catch(() => { /* A failed counter must never interrupt reading the site. */ });
}
