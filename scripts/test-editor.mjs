import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {Miniflare}=createRequire(createRequire(import.meta.url).resolve('wrangler/package.json'))('miniflare');
import {readFile, readdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';

const directory=await mkdtemp(join(tmpdir(),'idfc-editor-test-'));
const password=randomBytes(25).toString('base64url');
const base='https://editor.test';
const settings={
  modules:true, scriptPath:resolve('dist/server/index.js'), compatibilityDate:'2026-05-15',
  d1Databases:['DB'],d1Persist:join(directory,'db'),r2Buckets:['BUCKET'],r2Persist:join(directory,'r2'),
  bindings:{EDITOR_PASSWORD:password},
  assets:{directory:resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},
};
let mf=new Miniflare(settings),cookie='',csrf='',checks=0;
const check=(value,note)=>{assert.ok(value,note);checks++;};
const equal=(a,b,note)=>{assert.equal(a,b,note);checks++;};
async function request(path,{method='GET',body,auth=false,origin=base,headers={}}={}){
  const init={method,headers:{...(method==='GET'?{}:{origin}),...(auth?{cookie,'x-csrf-token':csrf}:{}),...headers}};
  if(body!==undefined){init.body=typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body);if(!(body instanceof Uint8Array))init.headers['content-type']='application/json';}
  return mf.dispatchFetch(base+path,init);
}
const api='/api/editor/';
try {
  const db=await mf.getD1Database('DB');
  for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){
    for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
  }
  equal((await request(api+'session')).status,401,'Session requires authentication');
  equal((await request(api+'page?path=%2F')).status,401,'Content API requires authentication');
  equal((await request(api+'preview?path=%2F')).status,401,'Preview requires authentication');
  equal((await request(api+'upload',{method:'POST',body:new Uint8Array(10)})).status,401,'Uploads require authentication');
  equal((await request(api+'draft?path=%2F',{method:'POST',body:{html:'<p>Draft</p>'}})).status,401,'AI draft requires authentication');
  equal((await request(api+'login',{method:'POST',body:{password},origin:'https://evil.test'})).status,403,'Cross-origin login rejected');
  equal((await request(api+'login',{method:'POST',body:{password:'wrong'}})).status,401,'Wrong password rejected');
  const login=await request(api+'login',{method:'POST',body:{password}});equal(login.status,200,'Password login succeeds');
  cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrf;
  for(const attr of ['Secure','HttpOnly','SameSite=Strict','Path=/'])check(login.headers.get('set-cookie').includes(attr),'Session cookie '+attr);
  const session=await request(api+'session',{auth:true});equal(session.status,200,'Session available');
  equal((await session.json()).pages.length,88,'All bilingual pages are editable');
  const page=await (await request(api+'page?path=%2F',{auth:true})).json();equal(page.revision,0,'Initial revision zero');check(page.html.includes('IDFC2027'),'Original page loads');
  equal((await request(api+'draft?path=%2F',{method:'POST',auth:true,body:{html:'<p>Draft</p>'},headers:{'x-csrf-token':'bad'}})).status,403,'AI draft rejects invalid CSRF');
  equal((await request(api+'draft?path=%2F',{method:'POST',auth:true,body:{html:'<p>Draft</p>'},origin:'https://evil.test'})).status,403,'AI draft rejects cross-origin requests');
  equal((await request(api+'draft?path=%2Funknown%2F',{method:'POST',auth:true,body:{html:'<p>Draft</p>'}})).status,404,'AI draft rejects unknown page');
  equal((await request(api+'draft?path=%2F&scope=invalid',{method:'POST',auth:true,body:{html:'<p>Draft</p>'}})).status,404,'AI draft rejects invalid scope');
  equal((await request(api+'draft?path=%2F',{method:'POST',auth:true,body:{html:'<script>alert(1)</script>'}})).status,400,'Empty sanitized AI draft rejected');
  const aiDraft=await request(api+'draft?path=%2F',{method:'POST',auth:true,body:{html:'<section><h2>AI編集案</h2><img src="/assets/idfc2027/sojitz.webp" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">リンク</a></section>'}});
  equal(aiDraft.status,200,'AI draft can be prepared');
  const draftHTML=(await aiDraft.json()).html;
  check(draftHTML.includes('AI編集案')&&!/onerror|<script|javascript:/.test(draftHTML),'AI draft sanitized before browser preview');
  const unchanged=await (await request(api+'page?path=%2F',{auth:true})).json();
  equal(unchanged.revision,0,'AI preview does not increment revision');
  equal(unchanged.html,page.html,'AI preview does not persist content');
  check(!(await (await request('/')).text()).includes('AI編集案'),'AI preview does not change public site');
  for(const rawTag of ['xmp','noembed','noframes','noscript','plaintext']){
    const rawDraft=await request(api+'draft?path=%2F',{method:'POST',auth:true,body:{html:'<p>Valid draft</p><'+rawTag+'><img src=x onerror=alert(1)></'+rawTag+'>'}});
    equal(rawDraft.status,200,'Raw-text draft is handled '+rawTag);
    check(!(await rawDraft.json()).html.includes('onerror'),'Raw-text contents cannot escape sanitization '+rawTag);
  }
  const change={revision:0,html:'<section><h1>共同編集の検証</h1><p><strong>保存された本文</strong></p><img src="/assets/idfc2027/sojitz.webp" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">危険リンク</a><p style="color:#234e70;background-image:url(https://evil.test)">色</p></section>'};
  equal((await request(api+'page?path=%2F',{method:'PUT',body:change,auth:true,headers:{'x-csrf-token':'wrong'}})).status,403,'Bad CSRF rejected');
  equal((await request(api+'page?path=%2F',{method:'PUT',body:change,auth:true,origin:'https://evil.test'})).status,403,'Cross-origin write rejected');
  const saved=await request(api+'page?path=%2F',{method:'PUT',body:change,auth:true});equal(saved.status,200,'Save succeeds');const record=await saved.json();equal(record.revision,1,'Revision advances');
  check(!/onerror|<script|javascript:|background-image/.test(record.html),'Unsafe saved markup stripped');check(record.html.includes('color:#234e70'),'Safe color retained');
  const embedded=await request(api+'page?path='+encodeURIComponent('/idfc2027/')+'&scope=footer',{method:'PUT',body:{revision:0,html:'<p>埋め込みを保存</p><iframe src="https://www.youtube-nocookie.com/embed/TmEo0mSHEik"></iframe><iframe src="https://drive.google.com/file/d/0BzLW2BHCU_TOLXZBZHNJemxqNFU/preview"></iframe><iframe src="https://evil.test/"></iframe>'},auth:true});
  equal(embedded.status,200,'Safe embedded source videos and documents save');
  const embedHTML=(await embedded.json()).html;
  check(embedHTML.includes('youtube-nocookie.com')&&embedHTML.includes('drive.google.com'),'Original embedded media preserved');check(!embedHTML.includes('evil.test')&&embedHTML.includes('sandbox'),'Untrusted embed removed and trusted embed sandboxed');
  const publicHTML=await (await request('/')).text();check(publicHTML.includes('保存された本文'),'Public visitors see saved content');check(publicHTML.includes('site-footer'),'Other page regions preserved');
  equal((await request(api+'page?path=%2F',{method:'PUT',body:change,auth:true})).status,409,'Concurrent initial write rejected');
  equal((await request(api+'page?path=%2F',{method:'PUT',body:{revision:1,html:''},auth:true})).status,400,'Blank page rejected');
  const footerPath=api+'page?path=%2F&scope=footer';
  equal((await request(footerPath,{method:'PUT',body:{revision:1,html:'<p>共通フッターの検証</p>'},auth:true})).status,200,'Shared footer saves');
  check((await (await request('/about-idfc/')).text()).includes('共通フッターの検証'),'Shared footer affects other Japanese pages');
  check(!(await (await request('/en/about-idfc/')).text()).includes('共通フッターの検証'),'English footer stays independent');
  const hub=api+'page?path='+encodeURIComponent('/idfc2027/')+'&scope=main';
  equal((await request(hub,{method:'PUT',body:{revision:0,html:'<section><h2>2027編集の検証</h2></section>'},auth:true})).status,200,'Hub saves');
  for(const path of ['/idfc2027/活動/','/idfc2027/実行委員/','/idfc2027/資料/'])check((await (await request(encodeURI(path))).text()).includes('2027編集の検証'),'Compatibility hub shares edits '+path);
  const preview=await request(api+'preview?path=%2F',{auth:true});equal(preview.status,200,'Authenticated preview loads');check((await preview.text()).includes('/assets/editor/preview.js'),'Preview interaction script injected');
  const png=new Uint8Array(await readFile('site/assets/idfc2027/sojitz.webp'));
  const upload=await request(api+'upload',{method:'POST',body:png,auth:true,headers:{'content-type':'image/webp'}});equal(upload.status,201,'Image upload succeeds');const imageURL=(await upload.json()).url;
  const image=await request(imageURL);equal(image.status,200,'Uploaded image public');equal(image.headers.get('content-type'),'image/webp','Image type preserved');equal((await image.arrayBuffer()).byteLength,png.byteLength,'Image bytes preserved');
  equal((await request(api+'upload',{method:'POST',body:new TextEncoder().encode('<svg onload="alert(1)"></svg>'),auth:true})).status,400,'Active SVG upload rejected');
  const excessive=new Uint8Array(8*1024*1024+1);equal((await request(api+'upload',{method:'POST',body:excessive,auth:true})).status,400,'Oversize upload rejected');
  await mf.dispose();mf=new Miniflare(settings);
  check((await (await request('/')).text()).includes('保存された本文'),'Saved content survives Worker restart');
  equal((await request(imageURL)).status,200,'Uploaded image survives Worker restart');
  equal((await request(api+'session',{auth:true})).status,200,'Session survives Worker restart');
  equal((await request(api+'logout',{method:'POST',auth:true})).status,200,'Logout succeeds');
  equal((await request(api+'session',{auth:true})).status,401,'Revoked session rejected');
  for(let i=0;i<10;i++)equal((await request(api+'login',{method:'POST',body:{password:'bad'},headers:{'cf-connecting-ip':'10.20.30.40'}})).status,401,'Wrong-password attempts rejected');
  equal((await request(api+'login',{method:'POST',body:{password},headers:{'cf-connecting-ip':'10.20.30.40'}})).status,429,'Repeated logins throttled');
  equal((await request('/edit/')).status,200,'Editor shell available publicly');
  equal((await request('/assets/editor/editor.js')).status,200,'Editor asset available');
  const result={result:'pass',runtime:'Cloudflare workerd / Miniflare',assertions:checks,persistenceAcrossRestart:true,authentication:true,csrf:true,concurrentWrites:true,uploads:true,htmlSanitization:true,renderingBrowserQA:false};
  await writeFile('reports/qa-editor.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
