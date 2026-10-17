# IDFC website editing

- Japanese and English are one publication. For page content changes, edit both
  `site/<route>/index.html` and `site/en/<route>/index.html`, preserving the meaning
  and using natural language in each. Keep photos and shared information aligned.
- Do not add translation API calls or keys. The member chose manual/ChatGPT
  bilingual editing without an API.
- The member editor stores both languages atomically and exposes only saved public
  fragments to GitHub Pages. Never restore independent single-language saving or
  replace both language texts with the same language.
- Before editing content, read `/api/public/content?path=<route>` on the existing
  editing service for both languages. Saved CMS content takes precedence over the
  static snapshot. If the affected scope has a saved override, use the authenticated
  paired member editor/WebMCP tools to update that scope in both languages. Ask the
  user to log in when necessary; never silently publish a static-only change that
  would remain hidden by an older CMS override. Preserve the latest saved content.
- The GitHub public URL is https://idfcjapan.github.io/idfc-website/. Preserve it.
  The existing Sites service hosts the authenticated editor, saved fragments and
  uploaded images. Keep the existing project ID and storage bindings.
- Static HTML in `site/` includes current edits. Do not run the legacy Python
  `scripts/build.py` or recapture the old site over this snapshot; either would
  discard later GitHub changes. Build Pages with `node scripts/build-pages.mjs`;
  build the editor service with `npm run build`.
- Validate the language pair, links and the relevant browser behavior before
  publishing. Never test public saves by overwriting real production content.
