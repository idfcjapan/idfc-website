// IDFC page-view counter on Cloudflare (Workers + D1, free plan).
// Stores only daily per-page totals: no cookies, IP addresses or visitor IDs.
// Uses the same counting rules and page list as the editing service.
// Anyone with the link can read the totals at / (no password).
import { recordPublicView, editorAnalytics } from '../worker/analytics.js';
import pages from '../worker/pages.json' with { type: 'json' };

const privateHeaders = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function withHeaders(response, extra = {}) {
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries({ ...privateHeaders, ...extra })) result.headers.set(key, value);
  return result;
}

const json = (value, status = 200) => withHeaders(new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
}));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/public/views') return recordPublicView(request, env, pages);
    // The dashboard is open without a password at the member's request: it shows
    // only daily per-page totals, never anything about individual visitors.
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'この操作はできません。' }, 405);
    if (url.pathname === '/api/pages') return json({ pages });
    if (url.pathname === '/api/analytics') {
      return withHeaders(await editorAnalytics(request, env, pages, Date.now(), { table: 'combined_page_views_daily' }));
    }
    return withHeaders(await env.ASSETS.fetch(request));
  },
};
