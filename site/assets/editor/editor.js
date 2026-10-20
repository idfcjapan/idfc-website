(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const LIMIT = 2 * 1024 * 1024;
  const state = {csrf:'', pages:[], path:'/', scope:'main', revision:0, drafts:{ja:'',en:''},
    dirty:false, busy:false, ready:false, authenticated:false, initialized:false,
    contentVersion:0, loading:false, restore:null, seen:new Set(), selected:null,
    aiExport:null, lastExport:null, aiPreview:false, toolsLifecycle:null, savedLabel:''};
  const pending = new Map(); let sequence = 0;
  const analytics = window.IDFCAnalytics?.create({request:api,isAuthenticated:()=>state.authenticated});
  const language = () => state.path.startsWith('/en/') ? 'en' : 'ja';
  const basePath = p => p.startsWith('/en/') ? p.slice(3) : p;
  const status = value => { $('save-status').textContent = value; };
  const message = value => { $('editor-message').textContent = value; $('editor-message').hidden = !value; };
  const aiStatus = value => { $('ai-status').textContent = value; };
  const post = value => $('preview').contentWindow.postMessage({channel:'idfc-editor',...value}, location.origin);
  const metadata = () => ({version:2,path:basePath(state.path),scope:state.scope,revision:state.revision,language:'both'});
  const query = () => '?path='+encodeURIComponent(state.path)+'&scope='+state.scope;
  const reviewed = () => state.seen.has('ja') && state.seen.has('en') && $('pair-reviewed').checked;
  function update() {
    const unavailable = state.busy || !state.ready;
    $('save').textContent = '日英をまとめて保存・公開';
    $('save').disabled = unavailable || !state.dirty || !reviewed();
    $('pair-reviewed').disabled = unavailable || state.seen.size !== 2;
    $('pair-status').textContent = state.seen.size === 2 ? '日英の内容を確認し、チェックを入れると一度に公開できます。' : '言語を切り替えて、日本語とEnglishの両方を確認してください。';
    $('ai-export').disabled = unavailable || !$('ai-request').value.trim();
    $('ai-copy').disabled = unavailable || !state.aiExport;
    $('ai-import').disabled = unavailable;
    $('download-draft').disabled = unavailable;
  }
  function busy(value) {
    state.busy=value; $('preview').inert=value;
    for(const id of ['logout','reload','page-select','scope','language','ai-request','image-file','image-url','image-alt','link-url','apply-link','apply-alt','apply-image-url','text-color']) $(id).disabled=value;
    for(const button of document.querySelectorAll('[data-command],[data-ai-example]')) button.disabled=value;
    update();
  }
  function invalidate() {
    state.aiExport=null; $('ai-copy').disabled=true; $('ai-prompt').value='';
    $('ai-prompt-details').hidden=true; $('ai-prompt-details').open=false;
  }
  function dirty() {
    state.dirty=true; state.contentVersion++; invalidate();
    state.seen=new Set([language()]); $('pair-reviewed').checked=false;
    status('日英セットに未保存の変更があります'); update();
  }
  function requireReady() {
    if(!state.authenticated || !state.ready) throw new Error('ログインしてページの読み込みを待ってください。');
    if(state.busy) throw new Error('処理の完了を待ってからお試しください。');
  }
  function stopTools() { state.toolsLifecycle?.abort(); state.toolsLifecycle=null; $('browser-ai-hint').hidden=true; }
  function loginView(note='') {
    analytics?.close({clear:true});
    state.authenticated=false; stopTools(); $('editor-view').hidden=true; $('login-view').hidden=false;
    $('login-error').textContent=note; $('password').focus();
  }
  async function api(route,options={}) {
    const response=await fetch('/api/editor/'+route,{credentials:'same-origin',...options,headers:{
      ...(typeof options.body==='string'?{'content-type':'application/json'}:{}),
      ...(options.method && options.method!=='GET'?{'x-csrf-token':state.csrf}:{}),...options.headers}});
    const data=await response.json();
    if(!response.ok) {
      if(response.status===401 && route!=='login') loginView('ログインの有効期限が切れました。再ログインしてください。');
      throw new Error(data.error || '処理に失敗しました。');
    }
    return data;
  }
  function frameRequest(type,values={}) {
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('プレビューの応答を確認できませんでした。内容は保存されていません。'));},10000);
      pending.set(id,{resolve,reject,timer,type}); post({type,...values,requestId:id});
    });
  }
  const serialize=()=>frameRequest('serialize');
  const replace=html=>frameRequest('replace',{html});
  async function pair() { state.drafts[language()]=await serialize(); return {...state.drafts}; }
  function consent() { return !state.dirty || confirm('未保存の日英の変更を破棄して、ページを切り替えますか？'); }
  function options() {
    const selected=state.path, en=language()==='en'; $('page-select').replaceChildren();
    for(const page of state.pages) {
      if(page.path.startsWith('/en/')!==en || /^\/(en\/)?idfc2027\/(活動|実行委員|資料)\/$/.test(page.path)) continue;
      const option=document.createElement('option'); option.value=page.path;
      option.textContent=page.title.replace(/\s*[-|]\s*IDFC.*$/,'') || page.path; $('page-select').append(option);
    }
    if([...$('page-select').options].some(o=>o.value===selected)) $('page-select').value=selected;
  }
  function frame() {
    state.ready=false; state.loading=true; state.restore=state.drafts[language()];
    state.selected=null; $('image-tools').hidden=true; $('link-tools').hidden=true;
    $('frame-loading').hidden=false; $('public-link').href='https://idfcjapan.github.io/idfc-website'+state.path;
    $('preview').src='/api/editor/preview'+query();
  }
  async function load() {
    busy(true); state.ready=false; message(''); status('日英の内容を読み込み中…');
    try {
      const data=await api('page'+query());
      if(typeof data.html?.ja!=='string' || typeof data.html?.en!=='string') throw new Error('日英セットの編集画面を再読み込みしてください。');
      state.drafts=data.html; state.revision=data.revision; state.dirty=false; state.contentVersion=0;
      state.seen=new Set(); $('pair-reviewed').checked=false; invalidate(); state.lastExport=null;
      $('scope-hint').textContent=state.scope==='main'?'このページの日本語と英語をまとめて保存します。':'日本語・英語の全ページ共通部分をまとめて保存します。';
      state.savedLabel=data.updatedAt?'最終保存：'+new Date(data.updatedAt).toLocaleString('ja-JP'):'公開中の日英の内容';
      frame();
    } catch(error) { message(error.message); busy(false); $('frame-loading').hidden=true; }
  }
  async function start(data) {
    state.csrf=data.csrf; state.pages=data.pages; state.authenticated=true;
    $('login-view').hidden=true; $('editor-view').hidden=false; $('startup-error').hidden=true;
    registerTools();
    if(!state.initialized) {
      state.initialized=true; options(); state.path=$('page-select').value || '/';
      analytics?.open({pages:state.pages,path:state.path});
      await load();
    } else { busy(false); analytics?.open({pages:state.pages,path:state.path}); }
  }
  function expected(input) {
    if(input.path!==basePath(state.path) || input.scope!==state.scope || input.revision!==state.revision || input.contentVersion!==state.contentVersion) throw new Error('ページまたは編集内容が変わりました。日英の最新内容を取得し直してください。');
  }
  async function preview(html,target) {
    requireReady(); expected(target); busy(true); message('');
    try {
      const data=await api('draft'+query(),{method:'POST',body:JSON.stringify({html})});
      state.drafts=data.html; dirty(); state.aiPreview=true; $('ai-preview-label').hidden=false;
      await replace(state.drafts[language()]);
      aiStatus('日英の編集案を読み込みました。両言語のプレビューを確認してから、まとめて保存・公開してください。');
      return {...metadata(),contentVersion:state.contentVersion,previewed:true,published:false,languages:['ja','en']};
    } finally { busy(false); }
  }
  async function save() {
    requireReady(); if(!state.dirty)return;
    if(!reviewed())throw new Error('日本語と英語の両方を確認してください。');
    busy(true); message(''); status('日本語と英語をまとめて保存中…');
    let published=false;
    try {
      const html=await pair();
      const data=await api('page'+query(),{method:'PUT',body:JSON.stringify({html,revision:state.revision,reviewed:{ja:true,en:true}})});
      published=true; state.drafts=data.html; state.revision=data.revision; state.dirty=false; state.contentVersion++;
      state.aiPreview=false; $('ai-preview-label').hidden=true; invalidate();
      state.savedLabel='日本語と英語を保存しました・公開サイトは再読み込みで反映'; status(state.savedLabel);
      await replace(state.drafts[language()]);
    } catch(error) {
      message(published?'日英は保存済みです。プレビューを読み直してください。':error.message);
      status(published?state.savedLabel:'保存できませんでした・日英の編集内容は残っています');
    } finally { busy(false); }
  }
  const marker=meta=>'<!-- IDFC-AI '+JSON.stringify(meta)+' -->';
  const fileHTML=(html,meta)=>marker(meta)+'\n<template data-idfc-language="ja">'+html.ja+'</template>\n<template data-idfc-language="en">'+html.en+'</template>\n';
  function prompt(meta) {
    return ['添付HTMLはIDFCサイトの日英セットの編集用ファイルです。','対象ページ：'+meta.path+'／場所：'+meta.scope,'依頼：'+$('ai-request').value.trim(),
      '日本語と英語の両方を修正し、同じ情報・写真・構成になるようにしてください。文章はそれぞれ自然な日本語・英語にしてください。',
      '完成した.htmlファイルを返してください。説明や差分だけで終わらないでください。','先頭のコメントを変更しないでください：'+marker(meta),
      'data-idfc-language="ja" と "en" の2つのtemplate要素を残し、各templateの中に対象部分のHTML全体を入れてください。片方だけのファイルは保存できません。',
      '既存のクラス・ID・写真・リンク・必要な情報を保持し、依頼された箇所だけを直してください。事実は創作しないでください。',
      '新しいscript・style・イベント属性・外部コードは追加しないでください。APIキーやパスワードは不要です。'].join('\n\n');
  }
  function download(text,name) {
    const url=URL.createObjectURL(new Blob([text],{type:'text/html;charset=utf-8'})),a=document.createElement('a');
    a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function parseFile(text) {
    const matches=[...text.matchAll(/<!--\s*IDFC-AI\s+([\s\S]*?)\s*-->/g)];
    if(matches.length!==1)throw new Error('日英セットのIDFC-AIコメントを含むファイルを選んでください。');
    let meta; try{meta=JSON.parse(matches[0][1]);}catch{throw new Error('編集用コメントを読み取れません。');}
    if(meta.version!==2 || meta.language!=='both' || meta.path!==basePath(state.path) || meta.scope!==state.scope || meta.revision!==state.revision) throw new Error('別のページ・場所・版のファイルです。日英セットのファイルを用意し直してください。');
    if(state.lastExport && (meta.exportId!==state.lastExport.id || state.lastExport.contentVersion!==state.contentVersion)) throw new Error('書き出し後に編集内容が変わりました。最新のファイルを用意し直してください。');
    const doc=new DOMParser().parseFromString(text,'text/html'),templates=doc.querySelectorAll('template[data-idfc-language]');
    if(templates.length!==2)throw new Error('日本語と英語の2つのtemplateが必要です。');
    const html={}; for(const t of templates) {const lang=t.dataset.idfcLanguage;if(!['ja','en'].includes(lang)||html[lang])throw new Error('日英の指定が正しくありません。');html[lang]=t.innerHTML;}
    if(!html.ja?.trim()||!html.en?.trim())throw new Error('日本語と英語の両方に内容が必要です。');
    return html;
  }
  function registerTools() {
    const registry=document.modelContext; if(typeof registry?.registerTool!=='function'||state.toolsLifecycle)return;
    const lifecycle=new AbortController();state.toolsLifecycle=lifecycle;
    const targetProperties={expectedPath:{type:'string'},expectedScope:{type:'string',enum:['main','header','footer']},expectedRevision:{type:'integer',minimum:0},expectedContentVersion:{type:'integer',minimum:0}};
    const tools=[{
      name:'idfc_read_editing_page',description:'Read BOTH Japanese and English HTML fragments for the selected IDFC page/scope, including unsaved changes. Always edit both languages as a pair. No credentials are returned.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},
      async execute(input) {if(Object.keys(input||{}).length)throw new Error('引数は不要です。');requireReady();busy(true);try{return {...metadata(),contentVersion:state.contentVersion,html:await pair(),unsavedChanges:state.dirty};}finally{busy(false);}}
    },{
      name:'idfc_preview_ai_edit',description:'Sanitize and preview BOTH Japanese and English replacement fragments together. Supply htmlJa and htmlEn with equivalent content, preserving each language. This stages both drafts without publishing; the member reviews both and saves them together.',
      inputSchema:{type:'object',properties:{htmlJa:{type:'string'},htmlEn:{type:'string'},...targetProperties},required:['htmlJa','htmlEn',...Object.keys(targetProperties)],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input){
        if(!input||Object.keys(input).some(k=>!['htmlJa','htmlEn',...Object.keys(targetProperties)].includes(k))||typeof input.htmlJa!=='string'||typeof input.htmlEn!=='string')throw new Error('日英両方のHTMLを指定してください。');
        return preview({ja:input.htmlJa,en:input.htmlEn},{path:input.expectedPath,scope:input.expectedScope,revision:input.expectedRevision,contentVersion:input.expectedContentVersion});
      }
    }];
    Promise.all(tools.map(tool=>Promise.resolve(registry.registerTool(tool,{signal:lifecycle.signal})))).then(()=>{if(!lifecycle.signal.aborted&&state.authenticated)$('browser-ai-hint').hidden=false;}).catch(()=>{lifecycle.abort();state.toolsLifecycle=null;});
  }
  $('show-password').addEventListener('click',()=>{const show=$('password').type==='password';$('password').type=show?'text':'password';$('show-password').textContent=show?'非表示':'表示';});
  $('analytics-open').addEventListener('click',()=>{if(state.authenticated)analytics?.open({pages:state.pages,path:state.path});});
  $('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-button').disabled=true;try{await api('login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';await start(await api('session'));}catch(error){$('login-error').textContent=error.message;}finally{$('login-button').disabled=false;}});
  $('page-select').addEventListener('change',()=>{if(!consent()){$('page-select').value=state.path;return;}state.path=$('page-select').value;load();});
  $('scope').addEventListener('change',()=>{if(!consent()){$('scope').value=state.scope;return;}state.scope=$('scope').value;load();});
  $('language').addEventListener('change',async()=>{
    const old=language(),next=$('language').value;
    try{requireReady();busy(true);state.drafts[old]=await serialize();state.path=(next==='en'?'/en':'')+basePath(state.path);options();frame();}
    catch(error){$('language').value=old;message(error.message);busy(false);}
  });
  $('pair-reviewed').addEventListener('change',update);
  $('reload').addEventListener('click',()=>{if(consent())load();});
  $('save').addEventListener('click',()=>save().catch(error=>message(error.message)));
  $('logout').addEventListener('click',async()=>{if(!consent())return;busy(true);try{await api('logout',{method:'POST'});state.dirty=false;state.ready=false;state.initialized=false;$('preview').src='about:blank';loginView();}catch(error){message(error.message);}finally{busy(false);}});
  $('ai-request').addEventListener('input',()=>{if(state.aiExport){state.aiExport.prompt=prompt(state.aiExport.meta);$('ai-prompt').value=state.aiExport.prompt;}update();});
  for(const button of document.querySelectorAll('[data-ai-example]'))button.addEventListener('click',()=>{$('ai-request').value=button.dataset.aiExample;$('ai-request').dispatchEvent(new Event('input'));});
  $('ai-export').addEventListener('click',async()=>{try{
    requireReady();if(!$('ai-request').value.trim())throw new Error('変えたいことを入力してください。');busy(true);
    const html=await pair(),meta={...metadata(),exportId:crypto.randomUUID()};
    download(fileHTML(html,meta),'idfc-bilingual-'+state.scope+'.html');state.aiExport={meta,prompt:prompt(meta)};state.lastExport={id:meta.exportId,contentVersion:state.contentVersion};
    $('ai-prompt').value=state.aiExport.prompt;$('ai-prompt-details').hidden=false;aiStatus('日英セットのファイルを保存しました。両方を編集する依頼文と一緒にChatGPTへ送ってください。');
  }catch(error){message(error.message);}finally{busy(false);}});
  $('ai-copy').addEventListener('click',async()=>{if(!state.aiExport)return;try{await navigator.clipboard.writeText(state.aiExport.prompt);aiStatus('日英セットの依頼文をコピーしました。');}catch{$('ai-prompt-details').hidden=false;$('ai-prompt-details').open=true;$('ai-prompt').focus();$('ai-prompt').select();}});
  $('ai-import').addEventListener('change',async()=>{const file=$('ai-import').files[0];if(!file)return;try{
    requireReady();if(!/\.html?$/i.test(file.name)||file.size>LIMIT*2+20000)throw new Error('日英セットのHTMLファイルを選んでください（約4 MBまで）。');
    const target={...metadata(),contentVersion:state.contentVersion};const html=parseFile(await file.text());await preview(html,target);
  }catch(error){message(error.message);}finally{$('ai-import').value='';}});
  for(const button of document.querySelectorAll('[data-command]')){button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',()=>{if(!state.busy&&state.ready)post({type:'command',command:button.dataset.command,value:button.dataset.value});});}
  $('text-color').addEventListener('input',()=>{if(!state.busy&&state.ready)post({type:'command',command:'foreColor',value:$('text-color').value});});
  const safeURL=value=>{value=value.trim();if(!/^(https?:\/\/|\/[^/]|#|mailto:|tel:)/i.test(value))throw new Error('https:// または / から始まるリンクを指定してください。');return value;};
  $('apply-link').addEventListener('click',()=>{try{requireReady();post({type:'link',url:safeURL($('link-url').value)});}catch(error){message(error.message);}});
  $('apply-alt').addEventListener('click',()=>{if(!state.busy&&state.ready)post({type:'alt',value:$('image-alt').value});});
  function changePhoto(url) {
    if(!/^https?:\/\//i.test(url)&&!/^\/[^/]/.test(url))throw new Error('画像のURLを指定してください。');
    if(!state.selected?.src)throw new Error('差し替える写真を選んでください。');
    const other=language()==='ja'?'en':'ja',doc=new DOMParser().parseFromString(state.drafts[other],'text/html');
    const matches=[...doc.querySelectorAll('img')].filter(img=>img.getAttribute('src')===state.selected.src);
    if(!matches.length)throw new Error('もう一方の言語に対応する写真が見つかりません。ChatGPTに日英セットでの差し替えを依頼してください。');
    for(const img of matches){img.setAttribute('src',url);for(const attr of ['srcset','sizes','data-src','width','height'])img.removeAttribute(attr);const a=img.closest('a[data-lightbox]');if(a)a.setAttribute('href',url);}
    state.drafts[other]=doc.body.innerHTML;post({type:'image',url});$('image-url').value=url;
  }
  $('apply-image-url').addEventListener('click',()=>{try{requireReady();changePhoto(safeURL($('image-url').value));}catch(error){message(error.message);}});
  $('image-file').addEventListener('change',async()=>{const file=$('image-file').files[0];if(!file)return;try{
    requireReady();if(file.size>8*1024*1024)throw new Error('画像は8 MBまでです。');busy(true);
    const data=await api('upload',{method:'POST',body:file,headers:{'content-type':file.type}});changePhoto(data.url);status('日英両方の写真を差し替えました・未公開');
  }catch(error){message(error.message);}finally{$('image-file').value='';busy(false);}});
  $('mobile-preview').addEventListener('click',()=>{const on=document.querySelector('.frame-area').classList.toggle('mobile');$('mobile-preview').textContent=on?'PC表示':'スマホ表示';$('mobile-preview').setAttribute('aria-pressed',String(on));});
  $('download-draft').addEventListener('click',async()=>{try{requireReady();busy(true);download(fileHTML(await pair(),{...metadata(),exportId:crypto.randomUUID()}),'idfc-bilingual-draft.html');}catch(error){message(error.message);}finally{busy(false);}});
  window.addEventListener('message',async event=>{
    if(event.origin!==location.origin||event.source!==$('preview').contentWindow||event.data?.channel!=='idfc-editor')return;
    const data=event.data;
    if(data.type==='ready'){
      state.ready=true;
      if(state.restore!==null){const html=state.restore;state.restore=null;try{await replace(html);}catch(error){message(error.message);}}
      state.loading=false;state.seen.add(language());$('frame-loading').hidden=true;busy(false);if(!state.dirty)status(state.savedLabel);update();
    }
    if(data.type==='dirty')dirty();
    if(data.type==='serialized'||data.type==='replaced'){
      const wait=pending.get(data.requestId);
      if(wait&&((data.type==='serialized'&&wait.type==='serialize')||(data.type==='replaced'&&wait.type==='replace'))){clearTimeout(wait.timer);pending.delete(data.requestId);wait.resolve(data.type==='serialized'?data.html:undefined);}
    }
    if(data.type==='selected'){
      state.selected=data;$('selection-label').textContent=data.text||'選択中';$('image-tools').hidden=data.kind!=='image';$('link-tools').hidden=!data.hasLink;
      $('image-alt').value=data.alt||'';$('image-url').value=data.src||'';$('link-url').value=data.href||'';
    }
  });
  $('preview').addEventListener('load',()=>{if(!state.loading)return;const src=$('preview').src;setTimeout(()=>{if(state.loading&&$('preview').src===src){message('プレビューを読み込めませんでした。「最新の保存内容を読み直す」をお試しください。');$('frame-loading').hidden=true;busy(false);}},10000);});
  window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
  window.addEventListener('pagehide',stopTools);window.addEventListener('pageshow',()=>{if(state.authenticated)registerTools();});
  api('session').then(start).catch(error=>loginView(error.message==='ログインしてください。'?'':error.message));
})();
