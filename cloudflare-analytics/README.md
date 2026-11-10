# IDFC page-view counter (Cloudflare)

Public pages on https://idfcjapan.github.io/idfc-website/ send `{path}` to this
Worker (`site/assets/js/analytics.js`). It adds 1 to that page's total for the day
in the D1 database `idfc-analytics`. Nothing else is stored: no cookies, IP
addresses or visitor identifiers (see `/j/privacy/`). It runs on Cloudflare's free
plan in the IDFC account.

- Counting rules and the page list are shared with the editing service
  (`worker/analytics.js`, `worker/pages.json`). Redeploy after adding pages.
- `migrations/0002_legacy_views.sql` keeps counts from the old ChatGPT-hosted
  service in `legacy_page_views_daily`; `combined_page_views_daily` adds both.
  `past-views.sql` is that carried-over data; re-running it is safe.

Deploy (from the repository root, after `npx wrangler login`):

    npx wrangler d1 migrations apply idfc-analytics --remote -c cloudflare-analytics/wrangler.jsonc
    npx wrangler d1 execute idfc-analytics --remote -c cloudflare-analytics/wrangler.jsonc --file cloudflare-analytics/past-views.sql
    npx wrangler deploy -c cloudflare-analytics/wrangler.jsonc

## Member page-view dashboard

https://idfc-analytics.idfc-japan.workers.dev/ shows the editor's「閲覧数の動向」view
(`public/`), reading old and new counts together (`combined_page_views_daily`).
The browser asks for a password; the user name can be anything. The Worker checks
it against the secret `DASHBOARD_PASSWORD`. The secret is set by a member, never
committed:

    npx wrangler secret put DASHBOARD_PASSWORD -c cloudflare-analytics/wrangler.jsonc

`public/analytics.js` is a copy of `site/assets/editor/analytics.js`, and
`public/dashboard.css` holds the analytics rules from `site/assets/editor/editor.css`.
Copy them again if the editor's view changes.
