# IDFC website editing

- Japanese and English are one publication. For page content changes, edit both
  `site/<route>/index.html` and `site/en/<route>/index.html`, preserving the meaning
  and using natural language in each. Keep photos and shared information aligned.
- Do not add translation API calls or keys. The member chose manual/AI bilingual
  editing without an API.
- The static HTML in `site/` on `main` is the only source of page content. There is
  no runtime override layer any more: the former ChatGPT Sites editing service and
  its `/api/public/content` are retired, and pages do not load content from it.
  (Its saved edits were checked on 2026-11-11: every one was an older copy of what
  was already in GitHub's history, so nothing was carried over.)
- Members edit at https://idfcjapan.github.io/idfc-website/edit/ (`site/edit/`,
  `site/assets/editor/github.js` + `editor.js`). It signs in with each member's own
  GitHub fine-grained token (this repo only, Contents read/write), kept only in that
  browser, and saves both languages (plus new photos in `site/uploads/images/`) as
  one commit on `main`, refusing a save if the edited part changed since loading.
  Never restore single-language saving or replace both language texts with the same
  language. Never put a token in the repo.
- AI help in the editor: WebMCP tools `idfc_read_editing_page` / `idfc_preview_ai_edit`,
  the same steps as `window.IDFCEditor.read()` / `.preview()`, and the AI file
  export/import. All of them only preview; the member presses 保存して公開.
- Page views are counted by the Cloudflare Worker in `cloudflare-analytics/`
  (dashboard https://idfc-analytics.idfc-japan.workers.dev/). Leave it as it is.
- The GitHub public URL is https://idfcjapan.github.io/idfc-website/. Preserve it.
  Keep viewer, sharing and search URLs aligned with this GitHub publication,
  including canonical metadata, language alternatives, schema and sitemaps.
- Do not run the legacy Python `scripts/build.py` or recapture the old site over
  this snapshot; either would discard later GitHub changes. Build and check Pages
  with `node scripts/build-pages.mjs`. `worker/`, `db/`, `drizzle/` and
  `.openai/hosting.json` belong to the retired service and are kept only for
  reference.
- Validate the language pair, links and the relevant browser behavior before
  publishing. Test editor saves on a throwaway branch (`/edit/?branch=editor-test`)
  or with the local mock (`scripts/editor-mock-github.mjs`), never by overwriting
  real production content.
