// GitHub-only storage for the member editor. Pages are read from the repository
// at one commit and both languages are saved together as one commit on `main`.
// GitHub Actions then publishes the site. The member's token stays in this browser.
(() => {
  'use strict';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  let testConfig = null;
  if (local) { try { testConfig = JSON.parse(localStorage.getItem('idfc-editor-test-config') || 'null'); } catch {} }
  const CONFIG = {owner:'idfcjapan', repo:'idfc-website', api:'https://api.github.com', raw:'https://raw.githubusercontent.com', ...(testConfig || {})};
  const requested = new URLSearchParams(location.search).get('branch');
  const BRANCH = requested && /^[A-Za-z0-9._-][A-Za-z0-9._\/-]{0,99}$/.test(requested) && !requested.includes('..') ? requested : 'main';
  const BASE = location.pathname.replace(/\/edit\/(?:index\.html)?$/, '');
  const OLD_SERVICE = 'https://idfc-japan-myanmar.hannaowo.chatgpt.site';
  const PUBLIC_SITE = 'https://idfcjapan.github.io/idfc-website';
  const TOKEN_KEY = 'idfc-editor-github-token';
  const MAX_HTML = 2 * 1024 * 1024;
  const SELECTOR = {main:'main#main', header:'header.site-header', footer:'footer.site-footer'};
  const SCOPE_LABEL = {main:'本文', header:'ヘッダー', footer:'フッター'};
  const pending = new Map(); // source path -> {blob, file, kind}
  const byBlob = new Map(); // blob URL -> source path
  let token = '';
  let user = null;

  const storage = {
    read() { try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
    write(value, remember) {
      try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, value); } catch {}
    },
    clear() { try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch {} },
  };

  class EditorError extends Error { constructor(message, status=0) { super(message); this.status = status; } }

  async function gh(route, options = {}) {
    if (!token) throw new EditorError('ログインしてください。', 401);
    let response;
    try {
      response = await fetch(CONFIG.api + route, {method:options.method || 'GET', cache:'no-store', headers:{
        accept:'application/vnd.github+json', authorization:'Bearer ' + token, 'x-github-api-version':'2022-11-28',
        ...(options.body ? {'content-type':'application/json'} : {})}, body:options.body ? JSON.stringify(options.body) : undefined});
    } catch { throw new EditorError('GitHubに接続できませんでした。インターネット接続を確認して、もう一度お試しください。編集中の内容は残っています。'); }
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (response.ok) return data;
    if (response.status === 401) throw new EditorError('ログインの有効期限が切れたか、合言葉（トークン）が正しくありません。もう一度ログインしてください。', 401);
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw new EditorError('GitHubの利用回数の上限に達しました。1時間ほど待ってからお試しください。', 429);
    if (response.status === 403 || response.status === 404) throw new EditorError('このトークンでは保存できません。作成時に「idfc-website」と「Contents：Read and write」を選んだか確認してください。団体の管理者の承認待ちの場合もあります。', 403);
    throw new EditorError(data.message ? 'GitHubでエラーが発生しました：' + data.message : 'GitHubでエラーが発生しました。少し待ってから再度お試しください。', response.status);
  }
  const repo = route => '/repos/' + CONFIG.owner + '/' + CONFIG.repo + route;
  const encodePath = file => file.split('/').map(encodeURIComponent).join('/');
  async function raw(sha, file) {
    let response;
    try { response = await fetch(CONFIG.raw + '/' + CONFIG.owner + '/' + CONFIG.repo + '/' + sha + '/' + encodePath(file)); }
    catch { throw new EditorError('ページを読み込めませんでした。インターネット接続を確認してください。'); }
    if (response.status === 404) return null;
    if (!response.ok) throw new EditorError('ページを読み込めませんでした。少し待ってから再度お試しください。');
    return response.text();
  }
  const fileFor = route => 'site/' + route.replace(/^\//, '') + 'index.html';
  const basePath = route => route.startsWith('/en/') ? route.slice(3) : route;
  const pairRoutes = route => ({ja:basePath(route), en:'/en' + basePath(route)});

  // Find the inner content of the editable element in a saved page, keeping
  // every other byte of the file unchanged.
  function locate(text, scope) {
    const tag = scope === 'main' ? 'main' : scope;
    const open = scope === 'main' ? /<main\b[^>]*\bid=["']main["'][^>]*>/gi
      : new RegExp('<' + tag + '\\b[^>]*\\bclass=["\'](?:[^"\']*\\s)?site-' + tag + '(?:\\s[^"\']*)?["\'][^>]*>', 'gi');
    const found = [...text.matchAll(open)];
    if (found.length !== 1) throw new EditorError('編集対象が見つかりません。');
    const start = found[0].index + found[0][0].length;
    const tags = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi');
    tags.lastIndex = start;
    let depth = 1, match;
    while ((match = tags.exec(text))) {
      depth += match[1] ? -1 : 1;
      if (depth === 0) return {start, end:match.index};
    }
    throw new EditorError('編集対象の終わりが見つかりません。');
  }
  const fragment = (text, scope) => { const at = locate(text, scope); return text.slice(at.start, at.end); };
  const withFragment = (text, scope, html) => { const at = locate(text, scope); return text.slice(0, at.start) + html + text.slice(at.end); };

  // Same rules as the former editing service (worker/index.js sanitize()).
  const allowed = new Set('div section article aside nav header footer main h1 h2 h3 h4 h5 h6 p a span strong b em i u s small sub sup br hr figure figcaption img picture source ul ol li dl dt dd blockquote cite pre code table caption thead tbody tfoot tr th td details summary button input label textarea select option form fieldset legend output svg path circle rect g text line polyline polygon title iframe'.split(' '));
  const dangerous = new Set(['script','style','iframe','object','embed','link','meta','base','template','xmp','noembed','noframes','noscript','plaintext']);
  const removedAttributes = new Set(['contenteditable','srcdoc','formaction','action','autofocus','data-i18n-source','data-i18n-block','data-editor-selected','data-editor-id','data-locale-generated']);
  function cleanElement(el) {
    const tag = el.localName.toLowerCase();
    if (tag === 'iframe') {
      let trusted = false;
      try {
        const source = new URL(el.getAttribute('src'));
        trusted = source.protocol === 'https:' && (
          ['www.youtube-nocookie.com','www.youtube.com'].includes(source.hostname) && /^\/embed\/[A-Za-z0-9_-]{11}$/.test(source.pathname) ||
          source.hostname === 'drive.google.com' && /^\/file\/d\/[A-Za-z0-9_-]+\/preview$/.test(source.pathname));
      } catch {}
      if (!trusted) { el.remove(); return; }
      el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
      el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    }
    if (!allowed.has(tag)) {
      if (dangerous.has(tag)) { el.remove(); return; }
      const children = [...el.childNodes];
      el.replaceWith(...children);
      for (const child of children) if (child.nodeType === 1) cleanElement(child);
      return;
    }
    for (const {name, value} of [...el.attributes]) {
      const key = name.toLowerCase();
      if (key.startsWith('on') || removedAttributes.has(key)) { el.removeAttribute(name); continue; }
      if (['href','src','xlink:href','poster'].includes(key)) {
        const normalized = value.replace(/[\u0000- \u007f]/g, '');
        if (!/^(https?:|mailto:|tel:|\/[^/]|\/\s*$|#)/i.test(normalized)) el.removeAttribute(name);
      }
      if (key === 'srcset') el.removeAttribute(name);
      if (key === 'style') {
        const safe = value.split(';').filter(rule => /^(color|background-color|text-align|font-weight|font-style|text-decoration|font-size)\s*:/i.test(rule.trim()) && !/url\s*\(|expression|@|[<>]/i.test(rule)).join(';');
        if (safe) el.setAttribute('style', safe); else el.removeAttribute('style');
      }
      if (key === 'target' && value === '_blank') el.setAttribute('rel', 'noopener noreferrer');
    }
    // Original legacy forms are not connected to a mail delivery service.
    if (['input','textarea','select'].includes(tag) && el.getAttribute('type') !== 'hidden') el.setAttribute('disabled', '');
    for (const child of [...el.children]) cleanElement(child);
  }
  function sanitize(source) {
    if (typeof source !== 'string' || new Blob([source]).size > MAX_HTML) throw new EditorError('内容のサイズが上限を超えています。');
    const template = document.createElement('template');
    template.innerHTML = source;
    for (const child of [...template.content.children]) cleanElement(child);
    return template.innerHTML;
  }
  function sanitizePair(html) {
    if (!html || typeof html !== 'object' || typeof html.ja !== 'string' || typeof html.en !== 'string') throw new EditorError('日本語と英語の両方をセットで指定してください。');
    const clean = {ja:sanitize(html.ja), en:sanitize(html.en)};
    if (!clean.ja.trim() || !clean.en.trim()) throw new EditorError('日本語と英語の両方に内容が必要です。');
    return clean;
  }

  // Saved pages use site-root links such as /about-idfc/. The published copy
  // lives under /idfc-website/, so links are shifted for the preview only.
  const URL_ATTRIBUTES = ['href','src','poster','data-src','data-original','data-url'];
  function mapURLs(html, convert) {
    const template = document.createElement('template');
    template.innerHTML = html;
    for (const el of template.content.querySelectorAll('*')) {
      for (const name of URL_ATTRIBUTES) {
        const value = el.getAttribute(name);
        if (value !== null) { const next = convert(value); if (next !== value) el.setAttribute(name, next); }
      }
      const srcset = el.getAttribute('srcset');
      if (srcset) el.setAttribute('srcset', srcset.split(',').map(item => item.replace(/^(\s*)(\S+)/, (_, space, url) => space + convert(url))).join(','));
    }
    return template.innerHTML;
  }
  function displayURL(value) {
    if (pending.has(value)) return pending.get(value).blob;
    if (value.startsWith(OLD_SERVICE + '/')) value = value.slice(OLD_SERVICE.length);
    if (value.startsWith('/') && !value.startsWith('//')) return BASE + value;
    return value;
  }
  function sourceURL(value) {
    if (byBlob.has(value)) return byBlob.get(value);
    if (BASE && value.startsWith(BASE + '/')) return value.slice(BASE.length);
    if (value.startsWith(location.origin + BASE + '/')) return value.slice((location.origin + BASE).length);
    return value;
  }
  const toDisplay = html => mapURLs(html, displayURL);
  const toSource = html => mapURLs(html, sourceURL);

  // Shared header/footer: keep each page's own current-page markers, language
  // links and same-page anchors while applying the edited content.
  function parse(html) { const t = document.createElement('template'); t.innerHTML = html; return t.content; }
  const serialize = content => { const t = document.createElement('template'); t.content.append(content); return t.innerHTML; };
  function localizeShared(edited, previous) {
    const fresh = parse(edited), old = parse(previous);
    const oldLinks = [...old.querySelectorAll('a[href]')];
    const currentLinks = new Set(oldLinks.filter(a => a.getAttribute('aria-current') === 'page' && !a.closest('.language-switch')).map(a => a.getAttribute('href')));
    const currentItems = new Set([...old.querySelectorAll('li.is-current')].map(li => li.querySelector(':scope > a')?.getAttribute('href')).filter(Boolean));
    const oldHrefs = new Set(oldLinks.map(a => a.getAttribute('href')));
    for (const a of fresh.querySelectorAll('a[href]')) {
      if (a.closest('.language-switch')) continue;
      const href = a.getAttribute('href'), hash = href.indexOf('#');
      if (!oldHrefs.has(href) && hash >= 0) {
        const alternatives = [...oldHrefs].filter(value => value.indexOf('#') >= 0 && value.slice(value.indexOf('#')) === href.slice(hash));
        if (alternatives.length === 1) a.setAttribute('href', alternatives[0]);
      }
    }
    for (const a of fresh.querySelectorAll('a[aria-current="page"]')) if (!a.closest('.language-switch')) a.removeAttribute('aria-current');
    for (const li of fresh.querySelectorAll('li.is-current')) li.classList.remove('is-current');
    for (const a of fresh.querySelectorAll('a[href]')) {
      if (a.closest('.language-switch')) continue;
      const href = a.getAttribute('href');
      if (currentLinks.has(href)) a.setAttribute('aria-current', 'page');
      const li = a.parentElement;
      if (li?.localName === 'li' && currentItems.has(href)) li.classList.add('is-current');
    }
    const oldSwitch = old.querySelector('nav.language-switch'), freshSwitch = fresh.querySelector('nav.language-switch');
    if (oldSwitch && freshSwitch) freshSwitch.replaceWith(oldSwitch.cloneNode(true));
    return serialize(fresh);
  }

  const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const revisionOf = html => digest(JSON.stringify([html.ja, html.en]));
  async function head() { return (await gh(repo('/git/ref/heads/' + encodePath(BRANCH)))).object.sha; }

  async function session() {
    token = token || storage.read();
    if (!token) throw new EditorError('ログインしてください。', 401);
    const [account, repository] = await Promise.all([gh('/user'), gh(repo(''))]);
    if (!repository.permissions?.push) throw new EditorError('このGitHubアカウントには、IDFCサイトを保存する権限がありません。IDFCの担当者に「idfc-website」への招待（Write権限）を頼んでください。', 403);
    user = account.login;
    const sha = await head();
    const pages = JSON.parse(await raw(sha, 'worker/pages.json') || '[]');
    return {user, branch:BRANCH, pages};
  }
  async function login(value, remember) {
    value = String(value || '').trim();
    if (!/^(github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]{20,}$/.test(value) && !(local && testConfig)) throw new EditorError('GitHubの合言葉（トークン）を貼り付けてください。「github_pat_」から始まる長い文字列です。');
    token = value;
    try { const data = await session(); storage.write(value, remember); return data; }
    catch (error) { token = ''; throw error; }
  }
  function logout() { token = ''; user = null; storage.clear(); }

  // Load both languages of the selected page and scope from one commit.
  async function load(route, scope) {
    const sha = await head(), routes = pairRoutes(route), html = {}, files = {};
    for (const language of ['ja','en']) {
      const file = fileFor(routes[language]), text = await raw(sha, file);
      if (text === null) throw new EditorError('日英のページを読み込めませんでした。');
      files[language] = file; html[language] = fragment(text, scope);
    }
    return {sha, scope, routes, files, html, original:{...html}, revision:await revisionOf(html)};
  }

  async function sharedFiles(sha) {
    const commit = await gh(repo('/git/commits/' + sha));
    const tree = await gh(repo('/git/trees/' + commit.tree.sha + '?recursive=1'));
    if (tree.truncated) throw new EditorError('ページの一覧を読み込めませんでした。');
    return tree.tree.filter(item => item.type === 'blob' && /^site\/(?:.*\/)?index\.html$/.test(item.path) && !item.path.startsWith('site/edit/')).map(item => item.path);
  }
  async function eachLimited(items, limit, work) {
    const results = new Array(items.length); let next = 0;
    await Promise.all(Array.from({length:Math.min(limit, items.length)}, async () => { while (next < items.length) { const i = next++; results[i] = await work(items[i]); } }));
    return results;
  }
  const detectImage = bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpg'
    : [...bytes.slice(0, 8)].join(',') === '137,80,78,71,13,10,26,10' ? 'png'
    : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP' ? 'webp'
    : /^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0, 6))) ? 'gif' : null;
  async function upload(file) {
    if (!file || file.size > 8 * 1024 * 1024) throw new EditorError('JPEG・PNG・WebP・GIFの画像を選んでください（8 MBまで）。');
    const bytes = new Uint8Array(await file.arrayBuffer()), kind = detectImage(bytes);
    if (!kind) throw new EditorError('JPEG・PNG・WebP・GIFの画像を選んでください（8 MBまで）。');
    const path = '/uploads/images/' + crypto.randomUUID() + '.' + kind, blob = URL.createObjectURL(file);
    pending.set(path, {blob, bytes}); byBlob.set(blob, path);
    return {url:path};
  }
  function base64(bytes) { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); }

  // Save both languages (and any new photos) as one commit. The commit is only
  // accepted when the edited part is unchanged since it was loaded and `main`
  // has not moved in the meantime; otherwise the member is asked to reload.
  async function save(loaded, html, options = {}) {
    const clean = sanitizePair(html);
    for (let attempt = 0; attempt < 3; attempt++) {
      const sha = await head(), changes = new Map();
      const current = {};
      for (const language of ['ja','en']) {
        const text = await raw(sha, loaded.files[language]);
        if (text === null || fragment(text, loaded.scope) !== loaded.original[language]) throw new EditorError('ほかの人が先に保存しました。変更内容を「編集内容を控えに保存」で保存してから、最新のページを読み直してください。', 409);
        current[language] = text;
      }
      if (loaded.scope === 'main') {
        for (const language of ['ja','en']) changes.set(loaded.files[language], withFragment(current[language], 'main', clean[language]));
      } else {
        const files = await sharedFiles(sha), skipped = [];
        await eachLimited(files, 8, async file => {
          const text = file === loaded.files.ja ? current.ja : file === loaded.files.en ? current.en : await raw(sha, file);
          if (text === null) return;
          let previous; try { previous = fragment(text, loaded.scope); } catch { skipped.push(file); return; }
          const language = file.startsWith('site/en/') ? 'en' : 'ja';
          const next = withFragment(text, loaded.scope, localizeShared(clean[language], previous));
          if (next !== text) changes.set(file, next);
        });
        if (skipped.length) console.warn('Shared part not found in', skipped);
      }
      const used = [...pending.keys()].filter(path => !pending.get(path).saved && [...changes.values()].some(text => text.includes(path)));
      const commit = await gh(repo('/git/commits/' + sha));
      const tree = [...changes].map(([path, content]) => ({path, mode:'100644', type:'blob', content}));
      for (const path of used) {
        const blob = await gh(repo('/git/blobs'), {method:'POST', body:{content:base64(pending.get(path).bytes), encoding:'base64'}});
        tree.push({path:'site' + path, mode:'100644', type:'blob', sha:blob.sha});
      }
      if (!tree.length) return {sha, html:clean, unchanged:true};
      const newTree = await gh(repo('/git/trees'), {method:'POST', body:{base_tree:commit.tree.sha, tree}});
      const message = (options.title || loaded.routes.ja) + '（' + SCOPE_LABEL[loaded.scope] + '）を日英で更新\n\n編集画面から ' + user + ' が保存しました。';
      const created = await gh(repo('/git/commits'), {method:'POST', body:{message, tree:newTree.sha, parents:[sha]}});
      try {
        await gh(repo('/git/refs/heads/' + encodePath(BRANCH)), {method:'PATCH', body:{sha:created.sha, force:false}});
      } catch (error) {
        if (error.status === 422 || error.status === 409) continue;
        throw error;
      }
      // Saved photos keep their local preview until the published site has them.
      for (const path of used) pending.get(path).saved = true;
      const saved = {ja:fragment(changes.get(loaded.files.ja) ?? current.ja, loaded.scope), en:fragment(changes.get(loaded.files.en) ?? current.en, loaded.scope)};
      return {sha:created.sha, html:saved, original:{...saved}, revision:await revisionOf(saved), files:changes.size, images:used.length};
    }
    throw new EditorError('ほかの人の保存と重なりました。少し待ってから、もう一度「保存して公開」を押してください。', 409);
  }

  window.IDFCGitHub = {BRANCH, BASE, PUBLIC_SITE, CONFIG, EditorError, session, login, logout, load, save, upload,
    sanitizePair, toDisplay, toSource, revisionOf, hasToken:() => !!storage.read(), locate, localizeShared};
})();
