// IDFC page-view counter on Cloudflare (Workers + D1, free plan).
// Stores only daily per-page totals: no cookies, IP addresses or visitor IDs.
// Uses the same counting rules and page list as the editing service.
import { recordPublicView } from '../worker/analytics.js';
import pages from '../worker/pages.json' with { type: 'json' };

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/public/views') return recordPublicView(request, env, pages);
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  },
};
