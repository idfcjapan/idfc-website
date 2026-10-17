import editor from './editor.html?raw';
import pages from './pages.json';

const enc = new TextEncoder();
const COOKIE = '__Host-idfc-editor';
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_HTML = 2 * 1024 * 1024;
const json = (value, status=200, headers={}) => new Response(JSON.stringify(value), {
  status, headers:{'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers},
});
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const same = (a,b) => {let n=a.length^b.length; for(let i=0;i<Math.max(a.length,b.length);i++)n|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return n===0;};

function keyFor(path, scope='main') {
  const locale=path.startsWith('/en/')?'en':'ja';
  if(scope==='footer'||scope==='header')return '@'+scope+'-'+locale;
  const base=locale==='en'?path.slice(3):path;
  if(['/idfc2027/','/idfc2027/活動/','/idfc2027/実行委員/','/idfc2027/資料/'].includes(base))return (locale==='en'?'/en':'')+'/idfc2027/';
  return path;
}
function pagePath(value) {
  try {value=decodeURIComponent(value||'/');}catch{return null;}
  return pages.some(p=>p.path===value)?value:null;
}
const scopes=new Set(['main','header','footer']);
function database(env) {
  if(!env.DB)throw new Error('保存サービスを利用できません。少し待ってから再度お試しください。');
  return env.DB;
}
function originOK(request) {return request.headers.get('origin')===new URL(request.url).origin;}
async function session(request,env) {
  if(!env.EDITOR_PASSWORD)return null;
  const cookie=request.headers.get('cookie')||'';
  const raw=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!raw||!/^\w{64}$/.test(raw))return null;
  const row=await database(env).prepare('SELECT token_hash, csrf, expires_at, password_tag FROM edit_sessions WHERE token_hash = ?').bind(await sha(raw)).first();
  if(!row||row.expires_at<=Date.now()||!same(row.password_tag,await sha(env.EDITOR_PASSWORD)))return null;
  return row;
}
async function authorize(request,env,write=false) {
  const s=await session(request,env);
  if(!s)return {error:json({error:'ログインしてください。'},401)};
  if(write&&(!originOK(request)||!same(request.headers.get('x-csrf-token')||'',s.csrf)))return {error:json({error:'操作を確認できませんでした。画面を更新してください。'},403)};
  return {session:s};
}
async function bodyJSON(request) {
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('JSONが必要です。');
  const raw=await boundedBody(request,MAX_HTML+20000);
  return JSON.parse(new TextDecoder().decode(raw));
}
async function boundedBody(request,max) {
  if(Number(request.headers.get('content-length'))>max)throw new Error('サイズが上限を超えています。');
  const reader=request.body?.getReader();
  if(!reader)return new Uint8Array();
  const chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('サイズが上限を超えています。');}chunks.push(value);}
  const result=new Uint8Array(size);let i=0;for(const part of chunks){result.set(part,i);i+=part.length;}return result;
}
async function fragment(source,selector) {
  let found=false;
  const marker='idfc-fragment-'+crypto.randomUUID();
  const rewritten=await new HTMLRewriter().on(selector,{element(el){found=true;el.before('<!--'+marker+'-->',{html:true});el.after('<!--/'+marker+'-->',{html:true});}}).transform(new Response(source)).text();
  if(!found)throw new Error('編集対象が見つかりません。');
  const content=rewritten.split('<!--'+marker+'-->')[1]?.split('<!--/'+marker+'-->')[0];
  return content.slice(content.indexOf('>')+1,content.lastIndexOf('</'));
}
const allowed=new Set('div section article aside nav header footer main h1 h2 h3 h4 h5 h6 p a span strong b em i u s small sub sup br hr figure figcaption img picture source ul ol li dl dt dd blockquote cite pre code table caption thead tbody tfoot tr th td details summary button input label textarea select option form fieldset legend output svg path circle rect g text line polyline polygon title iframe'.split(' '));
const dangerous=new Set(['script','style','iframe','object','embed','link','meta','base','template','xmp','noembed','noframes','noscript','plaintext']);
export async function sanitize(source) {
  if(typeof source!=='string'||enc.encode(source).byteLength>MAX_HTML)throw new Error('内容のサイズが上限を超えています。');
  return new HTMLRewriter().on('*',{element(el){
    const tag=el.tagName.toLowerCase();
    if(tag==='iframe'){
      let trusted=false;
      try{
        const source=new URL(el.getAttribute('src'));
        trusted=source.protocol==='https:'&&(
          ['www.youtube-nocookie.com','www.youtube.com'].includes(source.hostname)&&/^\/embed\/[A-Za-z0-9_-]{11}$/.test(source.pathname)||
          source.hostname==='drive.google.com'&&/^\/file\/d\/[A-Za-z0-9_-]+\/preview$/.test(source.pathname)
        );
      }catch{}
      if(!trusted){el.remove();return;}
      el.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');
      el.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
    }
    if(!allowed.has(tag)){if(dangerous.has(tag))el.remove();else el.removeAndKeepContent();return;}
    for(const [name,value] of [...el.attributes]){
      const k=name.toLowerCase();
      if(k.startsWith('on')||['contenteditable','srcdoc','formaction','action','autofocus','data-i18n-source','data-i18n-block','data-editor-selected','data-editor-id','data-locale-generated'].includes(k)){el.removeAttribute(name);continue;}
      if(['href','src','xlink:href','poster'].includes(k)) {
        const normalized=value.replace(/[\u0000-\u0020\u007f]/g,'');
        if(!/^(https?:|mailto:|tel:|\/[^/]|\/\s*$|#)/i.test(normalized))el.removeAttribute(name);
      }
      if(k==='srcset')el.removeAttribute(name);
      if(k==='style'){
        const safe=value.split(';').filter(rule=>/^(color|background-color|text-align|font-weight|font-style|text-decoration|font-size)\s*:/i.test(rule.trim())&&!/url\s*\(|expression|@|[<>]/i.test(rule)).join(';');
        if(safe)el.setAttribute('style',safe);else el.removeAttribute('style');
      }
      if(k==='target'&&value==='_blank')el.setAttribute('rel','noopener noreferrer');
    }
    // Original legacy forms are not connected to a mail delivery service.
    if(['input','textarea','select'].includes(tag)&&el.getAttribute('type')!=='hidden')el.setAttribute('disabled','');
  }}).transform(new Response(source)).text();
}
async function currentPage(request,env,path,scope) {
  const asset=await env.ASSETS.fetch(new Request(new URL(encodeURI(path),request.url),{method:'GET'}));
  if(asset.status!==200||!asset.headers.get('content-type')?.includes('text/html'))throw new Error('ページを読み込めませんでした。');
  const source=await asset.text();
  const key=keyFor(path,scope);
  const row=await database(env).prepare('SELECT html, revision, updated_at FROM page_edits WHERE path = ?').bind(key).first();
  return {html:row?.html??await fragment(source,scope==='main'?'main#main':scope==='header'?'header.site-header':'footer.site-footer'),revision:row?.revision??0,updatedAt:row?.updated_at??null,key};
}
async function login(request,env) {
  if(!originOK(request))return json({error:'同じサイトからログインしてください。'},403);
  if(!env.EDITOR_PASSWORD||!env.DB)return json({error:'編集モードの設定を確認してください。'},503);
  const now=Date.now(), ip='ip:'+await sha(request.headers.get('cf-connecting-ip')||'local');
  const statements=[ip,'global'].map(key=>database(env).prepare('INSERT INTO login_limits (key, attempts, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN reset_at <= ? THEN 1 ELSE attempts + 1 END, reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END RETURNING attempts, reset_at').bind(key,now+15*60*1000,now,now));
  const results=await database(env).batch(statements);
  if(results[0].results[0].attempts>10||results[1].results[0].attempts>60)return json({error:'ログインを試しすぎています。15分ほど待ってからお試しください。'},429,{'retry-after':'900'});
  let body;try{body=await bodyJSON(request);}catch{return json({error:'パスワードを入力してください。'},400);}
  if(typeof body.password!=='string'||body.password.length>200||!same(await sha(body.password),await sha(env.EDITOR_PASSWORD)))return json({error:'パスワードが違います。'},401);
  const raw=token(),csrf=token(),hash=await sha(raw);
  await database(env).batch([
    database(env).prepare('DELETE FROM edit_sessions WHERE expires_at <= ?').bind(now),
    database(env).prepare('DELETE FROM login_limits WHERE key = ?').bind(ip),
    database(env).prepare('INSERT INTO edit_sessions (token_hash, csrf, expires_at, password_tag) VALUES (?, ?, ?, ?)').bind(hash,csrf,now+SESSION_SECONDS*1000,await sha(env.EDITOR_PASSWORD)),
  ]);
  return json({csrf},200,{'set-cookie':`${COOKIE}=${raw}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`});
}
async function api(request,env,url) {
  if(url.pathname==='/api/editor/login'&&request.method==='POST')return login(request,env);
  const write=!['GET','HEAD'].includes(request.method);
  const auth=await authorize(request,env,write);if(auth.error)return auth.error;
  if(url.pathname==='/api/editor/session'&&request.method==='GET')return json({csrf:auth.session.csrf,pages});
  if(url.pathname==='/api/editor/logout'&&request.method==='POST'){
    await database(env).prepare('DELETE FROM edit_sessions WHERE token_hash = ?').bind(auth.session.token_hash).run();
    return json({ok:true},200,{'set-cookie':`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`});
  }
  const path=pagePath(url.searchParams.get('path')),scope=url.searchParams.get('scope')||'main';
  if(url.pathname==='/api/editor/draft'&&request.method==='POST'){
    if(!path||!scopes.has(scope))return json({error:'ページが見つかりません。'},404);
    const body=await bodyJSON(request);
    const clean=await sanitize(body.html);
    if(!clean.trim())return json({error:'編集案が空です。ChatGPTが作成したHTMLファイルを選んでください。'},400);
    // An AI draft only updates the editor preview. The existing revision-checked
    // save endpoint remains the single publication path for all editors.
    return json({html:clean});
  }
  if(url.pathname==='/api/editor/page'&&request.method==='GET'){
    if(!path||!scopes.has(scope))return json({error:'ページが見つかりません。'},404);
    return json(await currentPage(request,env,path,scope));
  }
  if(url.pathname==='/api/editor/page'&&request.method==='PUT'){
    if(!path||!scopes.has(scope))return json({error:'ページが見つかりません。'},404);
    const body=await bodyJSON(request);
    if(!Number.isSafeInteger(body.revision)||body.revision<0)return json({error:'保存前にページを読み直してください。'},400);
    const clean=await sanitize(body.html),key=keyFor(path,scope),now=Date.now();
    if(!clean.trim())return json({error:'空の内容は保存できません。'},400);
    const result=body.revision===0
      ?await database(env).prepare('INSERT INTO page_edits (path, html, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(path) DO NOTHING RETURNING revision').bind(key,clean,now).first()
      :await database(env).prepare('UPDATE page_edits SET html = ?, revision = revision + 1, updated_at = ? WHERE path = ? AND revision = ? RETURNING revision').bind(clean,now,key,body.revision).first();
    if(!result)return json({error:'ほかの人が先に保存しました。変更内容をコピーしてから最新のページを読み直してください。'},409);
    return json({ok:true,revision:result.revision,updatedAt:now,html:clean});
  }
  if(url.pathname==='/api/editor/upload'&&request.method==='POST'){
    const bytes=await boundedBody(request,8*1024*1024);
    const kind=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff?'jpg':
      bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'png':
      new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'?'webp':
      /^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0,6)))?'gif':null;
    if(!kind)return json({error:'JPEG・PNG・WebP・GIFの画像を選んでください（8 MBまで）。'},400);
    const key=crypto.randomUUID()+'.'+kind;
    await env.BUCKET.put('images/'+key,bytes,{httpMetadata:{contentType:kind==='jpg'?'image/jpeg':'image/'+kind}});
    return json({url:'/uploads/images/'+key},201);
  }
  if(url.pathname==='/api/editor/preview'&&request.method==='GET'){
    if(!path||!scopes.has(scope))return json({error:'ページが見つかりません。'},404);
    const response=await publicPage(request,env,path);
    return new HTMLRewriter().on('head',{element(el){el.append('<link rel="stylesheet" href="/assets/editor/preview.css">',{html:true});}}).on('body',{element(el){el.setAttribute('data-editor-scope',scope);el.append('<script src="/assets/editor/preview.js?v=20261013-ai1" defer></script>',{html:true});}}).transform(response);
  }
  return json({error:'操作が見つかりません。'},404);
}
async function publicPage(request,env,path) {
  const target=new URL(encodeURI(path),request.url);
  const response=await env.ASSETS.fetch(new Request(target,{method:'GET'}));
  if(!response.headers.get('content-type')?.includes('text/html')||response.status!==200)return response;
  const keys=['main','header','footer'].map(scope=>keyFor(path,scope));
  const rows=await database(env).prepare('SELECT path, html FROM page_edits WHERE path IN (?, ?, ?)').bind(...keys).all();
  let rewriter=new HTMLRewriter();
  for(const [i,selector] of ['main#main','header.site-header','footer.site-footer'].entries()){
    const row=rows.results.find(row=>row.path===keys[i]);
    if(row)rewriter=rewriter.on(selector,{element(el){el.setInnerContent(row.html,{html:true});}});
  }
  const rewritten=rewriter.transform(response),headers=new Headers(rewritten.headers);
  headers.set('cache-control','no-store');
  headers.set('x-content-type-options','nosniff');
  headers.set('referrer-policy','strict-origin-when-cross-origin');
  headers.set('x-frame-options','SAMEORIGIN');
  return new Response(rewritten.body,{status:response.status,headers});
}
export default {async fetch(request,env) {
  const url=new URL(request.url);
  try {
    if(url.pathname.startsWith('/api/editor/'))return await api(request,env,url);
    if(url.pathname==='/edit'||url.pathname==='/en/edit/')return Response.redirect(url.origin+'/edit/',302);
    if(url.pathname==='/edit/')return new Response(editor,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'SAMEORIGIN','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"}});
    if(url.pathname.startsWith('/uploads/images/')){
      if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
      const key=url.pathname.slice('/uploads/images/'.length);
      if(!/^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/.test(key))return new Response(null,{status:404});
      const object=await env.BUCKET.get('images/'+key);
      if(!object)return new Response(null,{status:404});
      const headers=new Headers({'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff'});
      object.writeHttpMetadata(headers);headers.set('etag',object.httpEtag);
      return new Response(request.method==='HEAD'?null:object.body,{headers});
    }
    let path;try{path=decodeURIComponent(url.pathname);}catch{return new Response(null,{status:400});}
    if(pages.some(p=>p.path===path)){
      const response=await publicPage(request,env,path);
      return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
    }
    return await env.ASSETS.fetch(request);
  }catch(error){
    if(url.pathname.startsWith('/api/editor/')){
      const inputError=error instanceof SyntaxError||/[ぁ-ん]/.test(error.message);
      if(!inputError)console.error('Editor request failed:',error.message);
      return json({error:error instanceof SyntaxError?'入力内容を確認してください。':inputError?error.message:'保存サービスに接続できませんでした。編集中の内容は残っています。少し待って再度お試しください。'},inputError?400:503);
    }
    console.error('Site request failed:',error.message);
    return new Response('ページを表示できませんでした。少し待ってから再度お試しください。',{status:503,headers:{'content-type':'text/plain; charset=utf-8'}});
  }
}};
