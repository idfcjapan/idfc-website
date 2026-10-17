import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
const { Miniflare }=createRequire(createRequire(import.meta.url).resolve('wrangler/package.json'))('miniflare');
const directory=await mkdtemp(join(tmpdir(),'idfc-bilingual-'));
const password=randomBytes(25).toString('base64url'),base='https://editor.test';
const settings={modules:true,scriptPath:resolve('dist/server/index.js'),compatibilityDate:'2026-05-15',
  d1Databases:['DB'],d1Persist:join(directory,'db'),r2Buckets:['BUCKET'],r2Persist:join(directory,'r2'),bindings:{EDITOR_PASSWORD:password},
  assets:{directory:resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}}};
let mf=new Miniflare(settings),cookie='',csrf='',checks=0;
const check=(value,note)=>{assert.ok(value,note);checks++;};
const equal=(a,b,note)=>{assert.deepEqual(a,b,note);checks++;};
async function request(path,{method='GET',body,auth=false,origin=base,headers={}}={}){
  return mf.dispatchFetch(base+path,{method,headers:{...(method==='GET'?{}:{origin}),...(auth?{cookie,'x-csrf-token':csrf}:{}),...(body!==undefined&&!(body instanceof Uint8Array)?{'content-type':'application/json'}:{}),...headers},
    ...(body!==undefined?{body:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body)}:{})});
}
const get=async path=>(await request(path,{auth:true})).json();
const api='/api/editor/';
const save=(path,body,extra={})=>request(api+'page?path='+encodeURIComponent(path),{method:'PUT',auth:true,body,...extra});
try{
  const db=await mf.getD1Database('DB');
  for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
  for(const route of ['session','page?path=%2F','preview?path=%2F'])equal((await request(api+route)).status,401,'Editor reads require authentication');
  equal((await request(api+'login',{method:'POST',body:{password},origin:'https://evil.test'})).status,403,'Cross-origin login rejected');
  equal((await request(api+'login',{method:'POST',body:{password:'wrong'}})).status,401,'Wrong password rejected');
  const login=await request(api+'login',{method:'POST',body:{password}});equal(login.status,200,'Login works');cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrf;
  for(const attr of ['Secure','HttpOnly','SameSite=Strict','Path=/'])check(login.headers.get('set-cookie').includes(attr),'Secure session cookie '+attr);
  equal((await get(api+'session')).pages.length,90,'All language-paired pages are available');
  const original=await get(api+'page?path=%2F');equal(original.revision,0,'Initial paired revision');
  check(original.html.ja.includes('日本')&&original.html.en.includes('Myanmar'),'Both language fragments loaded');
  equal((await get(api+'page?path=%2Fen%2F')).html,original.html,'Selecting English reads the same pair');
  const publication='/api/public/content?path=%2F';
  equal((await (await request(publication)).json()).content,{},'No legacy independent edits leak into new publication');
  const html={ja:'<section><h1>日英セット検証</h1><p>日本語の新しい内容</p><img src="/assets/idfc2027/sojitz.webp" onerror="alert(1)"><script>alert(2)</script></section>',en:'<section><h1>Bilingual publication test</h1><p>Updated English content</p><a href="javascript:alert(1)">unsafe</a></section>'};
  const change={revision:0,html,reviewed:{ja:true,en:true}};
  equal((await save('/',{...change,html:{ja:html.ja}})).status,400,'Single-language publication rejected');
  equal((await save('/',{...change,html:html.ja})).status,400,'Old single-fragment client rejected');
  equal((await save('/',{...change,html:{ja:html.ja,en:''}})).status,400,'Empty counterpart rejected');
  equal((await save('/',{revision:0,html,reviewed:{ja:true,en:false}})).status,400,'Both languages must be reviewed');
  equal((await save('/',change,{headers:{'x-csrf-token':'bad'}})).status,403,'Bad CSRF rejected');
  equal((await save('/',change,{origin:'https://evil.test'})).status,403,'Cross-origin save rejected');
  const draft=await request(api+'draft?path=%2F',{method:'POST',auth:true,body:{html}});equal(draft.status,200,'Both drafts can be staged');
  check(!/onerror|<script|javascript:/.test(JSON.stringify((await draft.json()).html)),'Both drafts sanitized');
  equal((await (await request(publication)).json()).content,{},'Drafts remain private and unpublished');
  equal((await get(api+'page?path=%2F')).revision,0,'Draft does not advance publication');
  const saved=await save('/',change);equal(saved.status,200,'Both languages saved in one operation');const record=await saved.json();equal(record.revision,1,'Paired revision advances once');
  check(!/onerror|<script|javascript:/.test(JSON.stringify(record.html)),'Both saved fragments sanitized');
  check((await (await request('/')).text()).includes('日本語の新しい内容'),'Japanese public page uses Japanese content');
  const english=await (await request('/en/')).text();check(english.includes('Updated English content')&&!english.includes('日本語の新しい内容'),'English public page uses English content');
  const publicJA=await request(publication,{headers:{origin:'https://idfcjapan.github.io'}});
  equal(publicJA.headers.get('access-control-allow-origin'),'https://idfcjapan.github.io','GitHub Pages CORS is enabled');
  check(!publicJA.headers.has('set-cookie'),'Anonymous public content does not create editor cookies');
  const bundle=await publicJA.json();equal(bundle.content.main.html,record.html.ja,'Anonymous endpoint returns saved Japanese only');
  check(!JSON.stringify(bundle).includes(csrf)&&!JSON.stringify(bundle).includes(password),'No editor secrets in public content');
  equal((await (await request('/api/public/content?path=%2Fen%2F')).json()).content.main.html,record.html.en,'Anonymous English endpoint returns English counterpart');
  equal((await request('/api/public/content?path=%2Funknown%2F')).status,404,'Unknown publication path rejected');
  equal((await request(publication,{method:'POST',body:{}})).status,405,'Public endpoint cannot publish');
  equal((await save('/en/',change)).status,409,'Concurrent save from other language is rejected');
  equal((await get(api+'page?path=%2F')).html,record.html,'Conflict changes neither language');
  const footer={revision:0,html:{ja:'<p>共通フッター日本語</p>',en:'<p>Shared English footer</p>'},reviewed:{ja:true,en:true}};
  equal((await request(api+'page?path=%2F&scope=footer',{method:'PUT',auth:true,body:footer})).status,200,'Shared footer saved as pair');
  check((await (await request('/about-idfc/')).text()).includes('共通フッター日本語'),'Japanese footer shared across Japanese pages');
  check((await (await request('/en/about-idfc/')).text()).includes('Shared English footer'),'English footer shared across English pages');
  const hub={revision:0,html:{ja:'<h2>2027日本語</h2>',en:'<h2>2027 English</h2>'},reviewed:{ja:true,en:true}};
  equal((await save('/idfc2027/',hub)).status,200,'Year hub pair saved');
  for(const alias of ['活動','実行委員','資料']){
    check((await (await request(encodeURI('/idfc2027/'+alias+'/'))).text()).includes('2027日本語'),'Japanese compatibility alias uses paired content');
    check((await (await request(encodeURI('/en/idfc2027/'+alias+'/'))).text()).includes('2027 English'),'English compatibility alias uses paired content');
  }
  const bytes=new Uint8Array(await readFile('site/assets/idfc2027/sojitz.webp'));
  const upload=await request(api+'upload',{method:'POST',auth:true,body:bytes,headers:{'content-type':'image/webp'}});equal(upload.status,201,'Photo upload works');const imageURL=(await upload.json()).url;
  equal((await request(imageURL)).status,200,'Uploaded photo publicly accessible');
  equal((await request(api+'upload',{method:'POST',auth:true,body:new TextEncoder().encode('<svg onload="alert(1)"></svg>')})).status,400,'Active upload rejected');
  const preview=await request(api+'preview?path=%2Fen%2F',{auth:true});equal(preview.status,200,'Authenticated English preview works');check((await preview.text()).includes('preview.js?v=20261017-pair1'),'New preview version loaded');
  const shell=await (await request('/edit/')).text();check(shell.includes('pair-reviewed')&&!shell.includes('日本語と英語は別々'),'Editor explains paired workflow');
  await mf.dispose();mf=new Miniflare(settings);
  equal((await get(api+'page?path=%2Fen%2F')).html,record.html,'Pair survives service restart');equal((await request(imageURL)).status,200,'Photos survive restart');
  equal((await request(api+'logout',{method:'POST',auth:true})).status,200,'Logout works');equal((await request(api+'session',{auth:true})).status,401,'Revoked session rejected');
  const result={result:'pass',runtime:'Cloudflare workerd / Miniflare',assertions:checks,bilingualAtomicPublication:true,singleLanguageRejected:true,draftsPrivate:true,concurrentWrites:true,publicGitHubCORS:true,uploads:true,persistenceAcrossRestart:true};
  await writeFile('reports/qa-bilingual-editor.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
  await mf.dispose();
  if(dirname(directory)!==resolve(tmpdir())||!basename(directory).startsWith('idfc-bilingual-'))throw new Error('Unexpected test directory');
  await rm(directory,{recursive:true,force:true});
}
