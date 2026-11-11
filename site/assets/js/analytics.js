// Aggregate page views only: no cookies, visitor identifiers or personal data.
const viewEndpoint = 'https://idfc-analytics.idfc-japan.workers.dev/api/public/views';
const publicOrigin = 'https://idfcjapan.github.io';
const publicBase = '';

export function recordPageView() {
  if (window.top !== window.self || navigator.webdriver || window.__idfcViewRecorded) return;
  if (/bot|crawler|spider|headless|lighthouse|preview|facebookexternalhit|slurp/i.test(navigator.userAgent)) return;
  if (location.origin !== publicOrigin || !location.pathname.startsWith(publicBase + '/')) return;
  const path = location.pathname.slice(publicBase.length);
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
  void fetch(viewEndpoint, {
    method:'POST', mode:'cors', credentials:'omit', cache:'no-store', keepalive:true,
    headers:{'content-type':'application/json'}, body:JSON.stringify({path}),
  }).catch(() => { /* A failed counter must never interrupt reading the site. */ });
}
