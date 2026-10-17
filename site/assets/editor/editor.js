(() => {
  const $ = id => document.getElementById(id);
  const MAX_HTML_BYTES = 2 * 1024 * 1024;
  const state = {csrf: '', pages: [], path: '/', scope: 'main', revision: 0, dirty: false,
    busy: false, ready: false, loading: false, initialized: false, authenticated: false,
    contentVersion: 0, aiExport: null, lastExport: null, aiPreview: false, savedLabel: '',
    loadID: 0, toolsLifecycle: null};
  const pending = new Map();
  let requestID = 0;
  const post = value => $('preview').contentWindow.postMessage({channel: 'idfc-editor', ...value}, location.origin);
  const status = text => { $('save-status').textContent = text; };
  const message = text => { $('editor-message').textContent = text; $('editor-message').hidden = !text; };
  const aiStatus = text => { $('ai-status').textContent = text; };
  const scopeName = scope => ({main: '本文', header: 'ヘッダー', footer: 'フッター'})[scope];

  function updateSave() {
    $('save').disabled = state.busy || !state.ready || !state.dirty;
    const unavailable = state.busy || !state.ready;
    $('ai-export').disabled = unavailable || !$('ai-request').value.trim();
    $('ai-copy').disabled = unavailable || !state.aiExport;
    $('ai-import').disabled = unavailable;
    $('download-draft').disabled = unavailable;
  }
  function busy(value) {
    state.busy = value;
    updateSave();
    $('preview').inert = value;
    for (const id of ['logout', 'reload', 'page-select', 'scope', 'language', 'ai-request', 'image-file',
      'image-url', 'image-alt', 'link-url', 'apply-link', 'apply-alt', 'apply-image-url', 'text-color']) $(id).disabled = value;
    for (const button of document.querySelectorAll('[data-command],[data-ai-example]')) button.disabled = value;
  }
  function invalidateExport(note = false) {
    const existed = !!state.aiExport;
    state.aiExport = null;
    $('ai-prompt').value = '';
    $('ai-prompt-details').hidden = true;
    $('ai-prompt-details').open = false;
    if (note && existed) aiStatus('編集中の内容が変わりました。ChatGPTに渡すファイルをもう一度保存してください。');
    updateSave();
  }
  function resetAI() {
    invalidateExport();
    state.lastExport = null;
    state.aiPreview = false;
    $('ai-preview-label').hidden = true;
    $('ai-import').value = '';
    aiStatus('');
  }
  function dirty() {
    state.dirty = true;
    state.contentVersion++;
    invalidateExport(true);
    status(state.aiPreview ? 'AIの提案を確認してください・未公開' : '未保存の変更があります');
    updateSave();
  }
  function restoreStatus() { status(state.dirty ? (state.aiPreview ? 'AIの提案を確認してください・未公開' : '未保存の変更があります') : state.savedLabel); }
  function stopBrowserTools() {
    state.toolsLifecycle?.abort();
    state.toolsLifecycle = null;
    $('browser-ai-hint').hidden = true;
  }
  function loginView(note = '') {
    state.authenticated = false;
    stopBrowserTools();
    $('editor-view').hidden = true;
    $('login-view').hidden = false;
    $('login-error').textContent = note;
    $('password').focus();
  }
  async function api(path, options = {}) {
    const response = await fetch('/api/editor/' + path, {credentials: 'same-origin', ...options, headers: {
      ...(options.body && typeof options.body === 'string' ? {'content-type': 'application/json'} : {}),
      ...(options.method && options.method !== 'GET' ? {'x-csrf-token': state.csrf} : {}), ...options.headers}});
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== 'login') loginView('ログインの有効期限が切れました。再ログインすると編集中の内容に戻れます。');
      throw new Error(data.error || '処理に失敗しました。');
    }
    return data;
  }
  function query() { return '?path=' + encodeURIComponent(state.path) + '&scope=' + state.scope; }
  function frameRequest(type, values = {}) {
    return new Promise((resolve, reject) => {
      const id = ++requestID;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(type === 'serialize' ? '編集内容を取得できませんでした。もう一度お試しください。' : 'プレビューの更新を確認できませんでした。編集内容を確認してから保存してください。'));
      }, 10000);
      pending.set(id, {resolve, reject, timeout, type});
      post({type, ...values, requestId: id});
    });
  }
  const serialize = () => frameRequest('serialize');
  const replaceHTML = html => frameRequest('replace', {html});
  function clearPending() {
    for (const item of pending.values()) {
      clearTimeout(item.timeout);
      item.reject(new Error('編集するページが変わりました。もう一度お試しください。'));
    }
    pending.clear();
  }
  function consent() { return !state.dirty || confirm('未保存の変更があります。変更を破棄してページを切り替えますか？'); }
  function requireReady() {
    if (!state.authenticated || !state.initialized || !state.ready) throw new Error('編集画面にログインして、ページの読み込みを待ってください。');
    if (state.busy) throw new Error('ほかの処理が進行中です。完了してからもう一度お試しください。');
  }
  function pageOptions() {
    const english = $('language').value === 'en', selected = state.path;
    $('page-select').replaceChildren();
    for (const page of state.pages) {
      if (page.path.startsWith('/en/') !== english) continue;
      if (/^\/(en\/)?idfc2027\/(活動|実行委員|資料)\/$/.test(page.path)) continue;
      const option = document.createElement('option');
      option.value = page.path;
      option.textContent = page.title.replace(/\s*[-|]\s*IDFC.*$/, '') || page.path;
      $('page-select').append(option);
    }
    if ([...$('page-select').options].some(o => o.value === selected)) $('page-select').value = selected;
  }
  function resetSelection() {
    $('selection-label').textContent = '文章や写真を選んでください';
    $('image-tools').hidden = true;
    $('link-tools').hidden = true;
  }
  async function loadPage() {
    clearPending();
    state.loadID++;
    state.ready = false;
    state.loading = true;
    state.contentVersion = 0;
    resetAI();
    $('ai-request').value = '';
    busy(true);
    message('');
    status('読み込み中…');
    $('frame-loading').hidden = false;
    try {
      const data = await api('page' + query());
      state.revision = data.revision;
      state.dirty = false;
      resetSelection();
      $('public-link').href = state.path;
      $('scope-hint').textContent = state.scope === 'main' && state.path.endsWith('/idfc2027/')
        ? 'IDFC2027内のすべての項目は、このページで編集します。'
        : state.scope === 'main' ? 'このページの本文に反映されます。' : '同じ言語の全ページに反映されます。';
      state.savedLabel = data.updatedAt ? '最終保存：' + new Date(data.updatedAt).toLocaleString('ja-JP') : '公開中の内容';
      $('preview').src = '/api/editor/preview' + query();
      status(state.savedLabel);
    } catch (error) {
      state.loading = false;
      message(error.message);
      $('frame-loading').hidden = true;
      busy(false);
    }
  }
  async function start(data) {
    state.csrf = data.csrf;
    state.pages = data.pages;
    state.authenticated = true;
    $('login-view').hidden = true;
    $('editor-view').hidden = false;
    $('startup-error').hidden = true;
    registerBrowserTools();
    if (!state.initialized) {
      state.initialized = true;
      pageOptions();
      state.path = $('page-select').value || '/';
      await loadPage();
    } else { busy(false); updateSave(); }
  }
  function metadata() {
    return {version: 1, path: state.path, scope: state.scope, revision: state.revision, language: state.path.startsWith('/en/') ? 'en' : 'ja'};
  }
  function metadataComment(meta) { return '<!-- IDFC-AI ' + JSON.stringify(meta) + ' -->'; }
  function exportID() {
    return typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function prompt(meta) {
    const language = meta.language === 'en' ? '英語' : '日本語';
    return [
      '添付したHTMLファイルはIDFCウェブサイトの「' + scopeName(meta.scope) + '」の編集用です。',
      'ページ：' + meta.path + '／対象言語：' + language, '', '依頼：', $('ai-request').value.trim(), '',
      'この依頼に沿って添付HTMLを実際に修正し、完成したHTMLファイルをダウンロードできる形で返してください。',
      '編集方法の説明だけで終わらず、依頼を反映したファイルを作成してください。情報が足りない場合は、推測せず確認してください。', '',
      'ファイルのルール：',
      '・対象部分のHTML全体を返してください。変更箇所だけの抜粋や差分にはしないでください。',
      '・先頭の次のコメントを、一字も変えずに残してください：', metadataComment(meta),
      '・html、head、bodyや対象部分の外側のmain/header/footerタグを新たに付けず、元ファイルと同じHTML断片の形式にしてください。',
      '・既存のクラス、ID、レイアウト、画像のURL・説明、リンク先、必要な情報を保持し、依頼に必要な箇所だけを変更してください。',
      '・文章は' + language + 'を維持してください。日本語ページと英語ページは別々に編集します。',
      '・日時、会場、氏名、連絡先、費用などの事実を創作しないでください。依頼で指定された情報と元の内容を使ってください。',
      '・script、iframe、イベント属性、外部JavaScriptや新しいCSSを追加しないでください。',
      '・パスワードや認証情報は不要です。ファイルを公開せず、修正済みの.htmlファイルを返してください。'
    ].join('\n');
  }
  function downloadHTML(html, name) {
    const blob = new Blob([html], {type: 'text/html;charset=utf-8'}), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function filename(prefix = 'idfc-ai') {
    const slug = state.path.replace(/^\/|\/$/g, '').replace(/[^a-z0-9-]+/gi, '-') || 'home';
    return prefix + '-' + slug + '-' + state.scope + '.html';
  }
  function validateTarget(meta) {
    if (!meta || meta.version !== 1 || !Number.isSafeInteger(meta.revision) || meta.revision < 0 || typeof meta.exportId !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(meta.exportId)) throw new Error('編集用の情報が正しくありません。元のファイルを添付して、ChatGPTにもう一度依頼してください。');
    if (meta.path !== state.path || meta.scope !== state.scope || meta.language !== (state.path.startsWith('/en/') ? 'en' : 'ja')) throw new Error('このファイルは別のページ・場所・言語用です。ファイルを保存したときと同じページ、場所、言語を選んでください。');
    if (meta.revision !== state.revision) throw new Error('保存内容の版が変わっています。最新の内容を読み直し、編集用ファイルを保存してChatGPTに再度依頼してください。');
  }
  function parseAIFile(text) {
    const matches = [...text.matchAll(/<!--\s*IDFC-AI\s+([\s\S]*?)\s*-->/g)];
    if (matches.length !== 1) throw new Error('編集用のIDFC-AIコメントが見つからないか、重複しています。表示した依頼文をChatGPTに送り、元のコメントをそのまま含むファイルを作ってもらってください。');
    let meta;
    try { meta = JSON.parse(matches[0][1]); }
    catch { throw new Error('編集用のIDFC-AIコメントを読み取れません。元のコメントを変えずに残すようChatGPTに依頼してください。'); }
    validateTarget(meta);
    if (state.lastExport && meta.exportId !== state.lastExport.exportId) throw new Error('以前に用意したファイルから作られた編集案です。最後に保存した編集用ファイルをChatGPTに添付して、もう一度依頼してください。');
    if (state.lastExport && state.lastExport.contentVersion !== state.contentVersion) throw new Error('ファイルを渡したあとに編集内容が変わっています。今の内容からファイルを保存し直して、ChatGPTに再度依頼してください。');
    const fragment = text.replace(matches[0][0], '').trim();
    if (!fragment || fragment.startsWith(String.fromCharCode(96).repeat(3))) throw new Error('ファイルの内容を確認してください。コードの囲みや説明文を含めず、完成した.htmlファイルを受け取ってください。');
    const doc = new DOMParser().parseFromString(fragment, 'text/html');
    const selector = state.scope === 'main' ? 'main#main' : state.scope === 'header' ? 'header.site-header' : 'footer.site-footer';
    const roots = doc.querySelectorAll(selector);
    if (roots.length > 1) throw new Error('編集する部分が複数あります。対象のHTML断片をひとつだけ含むファイルを受け取ってください。');
    if (roots.length === 1) return roots[0].innerHTML;
    if (/<!doctype\b|<html\b|<head\b|<body\b/i.test(fragment) || doc.querySelector('main#main,header.site-header,footer.site-footer')) throw new Error('このページの編集する部分を見つけられません。元のHTML断片と同じ形式でファイルを作るようChatGPTに依頼してください。');
    if (!doc.body.querySelector('*')) throw new Error('HTML要素が見つかりません。文章だけでなく、元のHTML全体を含むファイルを受け取ってください。');
    return doc.body.innerHTML;
  }
  async function previewDraft(html, expected) {
    requireReady();
    if (typeof html !== 'string' || !html.trim() || new TextEncoder().encode(html).length > MAX_HTML_BYTES) throw new Error('HTMLは空でない2 MB以内の内容にしてください。');
    if (expected.path !== state.path || expected.scope !== state.scope || expected.revision !== state.revision || expected.contentVersion !== state.contentVersion) throw new Error('編集中のページか内容が変わっています。現在の内容を取得してから、もう一度編集案を用意してください。');
    busy(true);
    message('');
    status('AIの提案を確認中…');
    try {
      const data = await api('draft' + query(), {method: 'POST', body: JSON.stringify({html})});
      if (typeof data.html !== 'string') throw new Error('編集案を読み込めませんでした。もう一度お試しください。');
      state.aiPreview = true;
      $('ai-preview-label').hidden = false;
      resetSelection();
      const replacing = replaceHTML(data.html);
      dirty();
      await replacing;
      aiStatus('AIの提案をプレビューに読み込みました。内容を確認して「保存して公開」を押してください。まだ公開されていません。');
      return {path: state.path, scope: state.scope, revision: state.revision, contentVersion: state.contentVersion, previewed: true, published: false};
    } catch (error) { restoreStatus(); throw error; }
    finally { busy(false); }
  }
  async function savePage() {
    requireReady();
    if (!state.dirty) return;
    busy(true);
    message('');
    status('保存中…');
    let published = false;
    try {
      const html = await serialize();
      const data = await api('page' + query(), {method: 'PUT', body: JSON.stringify({html, revision: state.revision})});
      published = true;
      state.revision = data.revision;
      state.dirty = false;
      state.contentVersion++;
      resetAI();
      state.savedLabel = '保存しました・公開ページに反映済み';
      status(state.savedLabel);
      await replaceHTML(data.html);
    } catch (error) {
      message(published ? '公開ページには保存されました。プレビューの再読み込みをお試しください。' : error.message);
      status(published ? state.savedLabel : '保存できませんでした・編集内容は残っています');
    } finally { busy(false); }
  }
  function validateToolInput(input, keys) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new Error('入力の形式が正しくありません。');
  }
  function registerBrowserTools() {
    const registry = document.modelContext;
    if (typeof registry?.registerTool !== 'function' || state.toolsLifecycle) return;
    const lifecycle = new AbortController();
    state.toolsLifecycle = lifecycle;
    const tools = [{
      name: 'idfc_read_editing_page',
      description: 'Read the currently selected IDFC HTML fragment, including unsaved edits, from the logged-in member editor. Returns page/scope/revision/contentVersion for a subsequent preview. No credentials are returned.',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false},
      annotations: {readOnlyHint: true, untrustedContentHint: true},
      async execute(input) {
        validateToolInput(input, []);
        requireReady();
        busy(true);
        try { return {...metadata(), contentVersion: state.contentVersion, unsavedChanges: state.dirty, html: await serialize()}; }
        finally { busy(false); }
      }
    }, {
      name: 'idfc_preview_ai_edit',
      description: 'Sanitize and preview a complete replacement HTML fragment for the currently selected IDFC page/scope. Use target values from idfc_read_editing_page. This stages unsaved changes only; the member must inspect them and click Save and publish.',
      inputSchema: {type: 'object', properties: {html: {type: 'string'}, expectedPath: {type: 'string'}, expectedScope: {type: 'string', enum: ['main', 'header', 'footer']}, expectedRevision: {type: 'integer', minimum: 0}, expectedContentVersion: {type: 'integer', minimum: 0}},
        required: ['html', 'expectedPath', 'expectedScope', 'expectedRevision', 'expectedContentVersion'], additionalProperties: false},
      annotations: {readOnlyHint: false, untrustedContentHint: true},
      async execute(input) {
        validateToolInput(input, ['html', 'expectedPath', 'expectedScope', 'expectedRevision', 'expectedContentVersion']);
        if (typeof input.html !== 'string' || typeof input.expectedPath !== 'string' || !['main', 'header', 'footer'].includes(input.expectedScope) || !Number.isSafeInteger(input.expectedRevision) || !Number.isSafeInteger(input.expectedContentVersion) || input.expectedRevision < 0 || input.expectedContentVersion < 0) throw new Error('ページ・場所・版とHTMLを正しく指定してください。');
        return previewDraft(input.html, {path: input.expectedPath, scope: input.expectedScope, revision: input.expectedRevision, contentVersion: input.expectedContentVersion});
      }
    }];
    Promise.all(tools.map(tool => {
      try { return Promise.resolve(registry.registerTool(tool, {signal: lifecycle.signal})); }
      catch (error) { return Promise.reject(error); }
    })).then(() => {
      if (!lifecycle.signal.aborted && state.authenticated) $('browser-ai-hint').hidden = false;
    }).catch(() => {
      lifecycle.abort();
      if (state.toolsLifecycle === lifecycle) state.toolsLifecycle = null;
      $('browser-ai-hint').hidden = true;
    });
  }

  $('show-password').addEventListener('click', () => {
    const show = $('password').type === 'password';
    $('password').type = show ? 'text' : 'password';
    $('show-password').textContent = show ? '非表示' : '表示';
    $('show-password').setAttribute('aria-label', show ? 'パスワードを非表示' : 'パスワードを表示');
  });
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    $('login-error').textContent = '';
    $('login-button').disabled = true;
    try {
      await api('login', {method: 'POST', body: JSON.stringify({password: $('password').value})});
      $('password').value = '';
      await start(await api('session'));
    } catch (error) { $('login-error').textContent = error.message; }
    finally { $('login-button').disabled = false; }
  });
  $('page-select').addEventListener('change', () => {
    if (!consent()) { $('page-select').value = state.path; return; }
    state.path = $('page-select').value;
    loadPage();
  });
  $('scope').addEventListener('change', () => {
    if (!consent()) { $('scope').value = state.scope; return; }
    state.scope = $('scope').value;
    loadPage();
  });
  $('language').addEventListener('change', () => {
    if (!consent()) { $('language').value = state.path.startsWith('/en/') ? 'en' : 'ja'; return; }
    state.path = $('language').value === 'en' ? '/en' + state.path : state.path.slice(3);
    pageOptions();
    state.path = $('page-select').value || ($('language').value === 'en' ? '/en/' : '/');
    loadPage();
  });
  $('reload').addEventListener('click', () => { if (consent()) loadPage(); });
  $('save').addEventListener('click', () => savePage().catch(error => message(error.message)));
  $('logout').addEventListener('click', async () => {
    if (!consent()) return;
    busy(true);
    try {
      await api('logout', {method: 'POST'});
      clearPending();
      state.dirty = false;
      state.ready = false;
      state.loading = false;
      state.initialized = false;
      state.csrf = '';
      resetAI();
      $('preview').src = 'about:blank';
      loginView();
    } catch (error) { message(error.message); }
    finally { busy(false); }
  });
  $('ai-request').addEventListener('input', () => {
    if (state.aiExport) {
      state.aiExport.prompt = prompt(state.aiExport.meta);
      $('ai-prompt').value = state.aiExport.prompt;
    }
    updateSave();
  });
  for (const button of document.querySelectorAll('[data-ai-example]')) button.addEventListener('click', () => {
    $('ai-request').value = button.dataset.aiExample;
    $('ai-request').dispatchEvent(new Event('input'));
    $('ai-request').focus();
  });
  $('ai-export').addEventListener('click', async () => {
    try {
      requireReady();
      if (!$('ai-request').value.trim()) throw new Error('変えたいことを入力してください。');
      busy(true);
      message('');
      aiStatus('現在の編集内容を用意しています…');
      const html = await serialize(), meta = {...metadata(), exportId: exportID()}, marker = metadataComment(meta);
      downloadHTML(marker + '\n' + html, filename());
      state.aiExport = {meta, prompt: prompt(meta), contentVersion: state.contentVersion};
      state.lastExport = {exportId: meta.exportId, contentVersion: state.contentVersion};
      $('ai-prompt').value = state.aiExport.prompt;
      $('ai-prompt-details').hidden = false;
      aiStatus('編集用ファイルを保存しました。「依頼文をコピー」を押し、ChatGPTにファイルと依頼文を送ってください。');
    } catch (error) { message(error.message); aiStatus('編集用ファイルを用意できませんでした。'); }
    finally { busy(false); }
  });
  $('ai-copy').addEventListener('click', async () => {
    if (state.busy || !state.aiExport) return;
    try {
      await navigator.clipboard.writeText(state.aiExport.prompt);
      aiStatus('依頼文をコピーしました。ChatGPTに編集用ファイルを添付し、この文章を貼り付けて送ってください。');
    } catch {
      $('ai-prompt-details').hidden = false;
      $('ai-prompt-details').open = true;
      $('ai-prompt').focus();
      $('ai-prompt').select();
      aiStatus('自動コピーができませんでした。表示した依頼文を手動でコピーしてください。');
    }
  });
  $('ai-import').addEventListener('change', async () => {
    const file = $('ai-import').files[0];
    if (!file) return;
    try {
      requireReady();
      if (!/\.html?$/i.test(file.name)) throw new Error('.html または .htm のファイルを選んでください。');
      if (file.size > MAX_HTML_BYTES) throw new Error('編集用ファイルは2 MBまでです。');
      const version = state.contentVersion, target = {path: state.path, scope: state.scope, revision: state.revision, contentVersion: version};
      busy(true);
      const text = await file.text();
      if (target.path !== state.path || target.scope !== state.scope || target.revision !== state.revision || version !== state.contentVersion) throw new Error('読み込み中に編集内容が変わりました。もう一度ファイルを選んでください。');
      const html = parseAIFile(text);
      busy(false);
      if (state.dirty && !state.lastExport && !confirm('AIの提案で現在の未保存の内容を置き換えます。続けますか？')) return;
      await previewDraft(html, target);
    } catch (error) {
      message(error.message);
      aiStatus('ファイルを読み込めませんでした。今の編集内容は残っています。');
    } finally { $('ai-import').value = ''; busy(false); }
  });
  for (const button of document.querySelectorAll('[data-command]')) {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => { if (!state.busy && state.ready) post({type: 'command', command: button.dataset.command, value: button.dataset.value}); });
  }
  $('text-color').addEventListener('input', () => { if (!state.busy && state.ready) post({type: 'command', command: 'foreColor', value: $('text-color').value}); });
  const safeURL = (value, image = false) => {
    value = value.trim();
    if (!/^(https?:\/\/|\/[^/]|#|mailto:|tel:)/i.test(value)) throw new Error('https:// から始まるURL、または / から始まるサイト内リンクを入力してください。');
    if (image && !/^(https?:\/\/|\/[^/])/i.test(value)) throw new Error('画像のURLを入力してください。');
    return value;
  };
  $('apply-link').addEventListener('click', () => {
    if (state.busy || !state.ready) return;
    try { post({type: 'link', url: safeURL($('link-url').value)}); message(''); } catch (error) { message(error.message); }
  });
  $('apply-alt').addEventListener('click', () => { if (!state.busy && state.ready) post({type: 'alt', value: $('image-alt').value}); });
  $('apply-image-url').addEventListener('click', () => {
    if (state.busy || !state.ready) return;
    try { post({type: 'image', url: safeURL($('image-url').value, true)}); message(''); } catch (error) { message(error.message); }
  });
  $('image-file').addEventListener('change', async () => {
    const file = $('image-file').files[0];
    if (!file || state.busy || !state.ready) return;
    if (file.size > 8 * 1024 * 1024) { message('画像は8 MBまでです。小さいファイルを選んでください。'); return; }
    busy(true);
    message('');
    status('写真をアップロード中…');
    try {
      const data = await api('upload', {method: 'POST', body: file, headers: {'content-type': file.type}});
      post({type: 'image', url: data.url});
      $('image-url').value = data.url;
      status('写真を差し替えました・保存すると公開されます');
      $('image-file').value = '';
    } catch (error) { message(error.message); status('写真をアップロードできませんでした'); }
    finally { busy(false); }
  });
  $('mobile-preview').addEventListener('click', () => {
    const mobile = document.querySelector('.frame-area').classList.toggle('mobile');
    $('mobile-preview').textContent = mobile ? 'PC表示' : 'スマホ表示';
    $('mobile-preview').setAttribute('aria-pressed', String(mobile));
  });
  $('download-draft').addEventListener('click', async () => {
    try { requireReady(); busy(true); downloadHTML(await serialize(), filename('idfc-edit-draft')); }
    catch (error) { message(error.message); }
    finally { busy(false); }
  });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== $('preview').contentWindow || !event.data || event.data.channel !== 'idfc-editor') return;
    const data = event.data;
    if (data.type === 'ready') {
      state.ready = true;
      $('frame-loading').hidden = true;
      if (state.loading) { state.loading = false; busy(false); }
      updateSave();
    }
    if (data.type === 'dirty') dirty();
    if (data.type === 'serialized' || data.type === 'replaced') {
      const wait = pending.get(data.requestId);
      if (wait && ((data.type === 'serialized' && wait.type === 'serialize') || (data.type === 'replaced' && wait.type === 'replace'))) {
        clearTimeout(wait.timeout);
        pending.delete(data.requestId);
        wait.resolve(data.type === 'serialized' ? data.html : undefined);
      }
    }
    if (data.type === 'selected') {
      $('selection-label').textContent = data.text || '選択中';
      $('image-tools').hidden = data.kind !== 'image';
      $('link-tools').hidden = !data.hasLink;
      $('image-alt').value = data.alt || '';
      $('image-url').value = data.src || '';
      $('link-url').value = data.href || '';
    }
  });
  $('preview').addEventListener('load', () => {
    if (state.ready || !state.initialized) return;
    const loadID = state.loadID;
    setTimeout(() => {
      if (!state.ready && state.loadID === loadID) {
        state.loading = false;
        $('frame-loading').hidden = true;
        busy(false);
        message('プレビューを読み込めませんでした。「最新の保存内容を読み直す」をお試しください。');
      }
    }, 5000);
  });
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', stopBrowserTools);
  window.addEventListener('pageshow', () => { if (state.authenticated) registerBrowserTools(); });
  api('session').then(start).catch(error => loginView(error.message === 'ログインしてください。' ? '' : error.message));
})();
