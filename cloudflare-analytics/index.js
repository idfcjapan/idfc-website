// IDFC page-view counter on Cloudflare (Workers + D1, free plan).
// Stores only daily per-page totals: no cookies, IP addresses or visitor IDs.
// Uses the same counting rules and page list as the editing service.
// Members read the totals at / after signing in with the shared dashboard password.
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

// Compares the supplied password with the stored secret without leaking timing.
async function samePassword(given, expected) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function signedIn(request, env) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), c => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const password = decoded.slice(decoded.indexOf(':') + 1);
  return samePassword(password, env.DASHBOARD_PASSWORD);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/public/views') return recordPublicView(request, env, pages);
    if (!env.DASHBOARD_PASSWORD) return json({ error: '閲覧数ページのパスワードがまだ設定されていません。' }, 503);
    if (!await signedIn(request, env)) {
      return withHeaders(new Response('IDFCメンバー用のパスワードが必要です。', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'www-authenticate': 'Basic realm="IDFC page views", charset="UTF-8"' },
      }));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'この操作はできません。' }, 405);
    if (url.pathname === '/api/pages') return json({ pages });
    if (url.pathname === '/api/analytics') {
      return withHeaders(await editorAnalytics(request, env, pages, Date.now(), { table: 'combined_page_views_daily' }));
    }
    return withHeaders(await env.ASSETS.fetch(request));
  },
};
