import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const payload=JSON.parse(readFileSync(0,'utf8'));
let checks=0;
const check=(condition,label)=>{assert.ok(condition,label);checks++;};

// This adapter deliberately does not implement or claim browser rendering.
function simple(node,selector,scope){
  if(selector===':scope')return node===scope;
  let valid=true;
  const stripped=selector.replace(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/g,(_,key,value)=>{
    if(!node.hasAttribute(key)||(value!==undefined&&node.getAttribute(key)!==value))valid=false;
    return '';
  });
  const tag=/^[\w-]+/.exec(stripped)?.[0];
  if(tag&&node.tagName!==tag.toLowerCase())return false;
  for(const m of stripped.matchAll(/\.([\w-]+)/g))if(!node.classList.contains(m[1]))return false;
  const id=/#([\w-]+)/.exec(stripped)?.[1];
  return valid&&(!id||node.getAttribute('id')===id);
}
function match(node,selector,scope){
  const parts=selector.trim().split(/\s+/);
  function at(el,i){
    if(!el||!simple(el,parts[i],scope))return false;
    if(i===0)return true;
    if(parts[i-1]==='>')return at(el.parentElement,i-2);
    for(let p=el.parentElement;p;p=p.parentElement)if(at(p,i-1))return true;
    return false;
  }
  return at(node,parts.length-1);
}
class Surface{
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  emit(type,props={},bubble=false){
    const e={type,target:this,defaultPrevented:false,button:0,preventDefault(){this.defaultPrevented=true;},...props};
    for(let n=this;n;n=bubble?n._parent:null)for(const fn of n.listeners.get(type)||[])fn.call(n,e);
    return e;
  }
}
class Element extends Surface{
  constructor(data,doc,parent=null){
    super();this.tagName=data.tag;this.attrs={...data.attrs};this._text=data.text||'';this.ownerDocument=doc;this._parent=parent;
    this.children=(data.children||[]).map(n=>new Element(n,doc,this));
    this.scrollLeft=0;this.offsetLeft=0;this.offsetWidth=0;this.clientWidth=0;this.complete=false;
    this.style={values:{},setProperty:(k,v)=>{this.style.values[k]=v;}};
    this.classList={contains:c=>this.className.split(/\s+/).includes(c),add:(...c)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...c])].join(' ');},remove:(...c)=>{this.className=this.className.split(/\s+/).filter(x=>!c.includes(x)).join(' ');}};
    this.dataset=new Proxy({}, {get:(_,k)=>this.getAttribute('data-'+String(k).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()))??undefined,set:(_,k,v)=>{this.setAttribute('data-'+String(k).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),v);return true;}});
  }
  get parentElement(){return this._parent instanceof Element?this._parent:null;}
  get className(){return this.attrs.class||'';} set className(v){this.attrs.class=v;}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');} set textContent(v){this._text=String(v);this.children=[];}
  getAttribute(k){return this.attrs[k]??null;} setAttribute(k,v){this.attrs[k]=String(v);} removeAttribute(k){delete this.attrs[k];} hasAttribute(k){return Object.hasOwn(this.attrs,k);}
  get hidden(){return this.hasAttribute('hidden');}set hidden(v){v?this.setAttribute('hidden',''):this.removeAttribute('hidden');}
  get disabled(){return this.hasAttribute('disabled');}set disabled(v){v?this.setAttribute('disabled',''):this.removeAttribute('disabled');}
  get open(){return this.hasAttribute('open');}
  get inert(){return this.hasAttribute('inert');}set inert(v){v?this.setAttribute('inert',''):this.removeAttribute('inert');}
  get src(){return new URL(this.getAttribute('src')||'',this.ownerDocument.window.location).href;}set src(v){this.setAttribute('src',v);}
  get href(){return new URL(this.getAttribute('href')||'',this.ownerDocument.window.location).href;}set href(v){this.setAttribute('href',v);}
  get alt(){return this.getAttribute('alt')||'';}set alt(v){this.setAttribute('alt',v);}
  querySelectorAll(selector){
    const result=[];const choices=selector.split(',');
    const walk=el=>{for(const n of el.children){if(choices.some(s=>match(n,s,this)))result.push(n);walk(n);}};
    walk(this);return result;
  }
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  closest(selector){for(let n=this;n;n=n.parentElement)if(selector.split(',').some(s=>match(n,s,this)))return n;return null;}
  contains(el){for(let n=el;n;n=n._parent)if(n===this)return true;return false;}
  focus(){const old=this.ownerDocument.activeElement;this.ownerDocument.activeElement=this;if(old&&old!==this)old.emit('focusout',{relatedTarget:this},true);}
  click(props={}){if(this.disabled)return {defaultPrevented:false};return this.emit('click',props,true);}
  getBoundingClientRect(){const width=this.ownerDocument.window.width;const height=width>=1200?210:width<=600?74:80;if(this.classList.contains('photo-dialog'))return {left:20,top:20,right:width-20,bottom:600,width:width-40,height:580};return {bottom:height,height};}
  scrollTo(options){this.scrollLeft=options.left;this.lastScrollBehavior=options.behavior;this.emit('scroll');}
  scrollIntoView(){this.scrolledIntoView=true;}
  append(...values){for(const value of values){if(typeof value==='string')this._text+=value;else{value._parent=this;this.children.push(value);}}}
  insertAdjacentElement(where,node){assert.equal(where,'afterend');const p=this.parentElement;node._parent=p;p.children.splice(p.children.indexOf(this)+1,0,node);}
  showModal(){this.setAttribute('open','');}
  close(){this.removeAttribute('open');this.emit('close');}
}
class Document extends Surface{
  constructor(data,window){super();this.window=window;this.documentElement=new Element(data,this,this);this.body=this.documentElement.querySelector('body');this.activeElement=this.body;}
  querySelectorAll(s){return this.documentElement.querySelectorAll(s);}querySelector(s){return this.querySelectorAll(s)[0]||null;}
  getElementById(id){return this.querySelector('#'+id);}createElement(tag){return new Element({tag,attrs:{},children:[]},this);}
}
function environment(fixture,width,hash='',motion=false,observers=true){
  const win=new Surface();win.width=width;win.innerHeight=844;win.visualViewport=new Surface();win.visualViewport.height=844;win.location=new URL('https://example.test'+fixture.path+hash);win.media=[];
  win.history={state:{},replaceState:(state,title,url)=>{win.history.state=state;win.location=new URL(url,win.location);}};
  win.scrollX=0;win.scrollY=0;
  win.scrollTo=options=>{win.scrollX=options.left;win.scrollY=options.top;win.lastScrollBehavior=options.behavior;win.emit('scroll');};
  win.matchMedia=q=>{const m=new Surface();m.q=q;m.maxWidth=Number(/max-width:\s*(\d+)px/.exec(q)?.[1]);m.matches=q.includes('max-width')?win.width<=m.maxWidth:motion;win.media.push(m);return m;};
  win.intersections=[];
  if(observers)win.IntersectionObserver=class{
    constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();win.intersections.push(this);}
    observe(target){this.targets.add(target);}unobserve(target){this.targets.delete(target);}
    fire(target,isIntersecting){this.callback([{target,isIntersecting}]);}
  };
  const doc=new Document(fixture.tree,win);let timerId=0;const timers=new Map();
  const layout=()=>{
    const track=doc.querySelector('.document-track');
    if(track){track.clientWidth=Math.min(980,win.width-40);track.querySelectorAll('.document-page').forEach((p,i)=>{p.offsetLeft=i*(track.clientWidth+20);p.offsetWidth=track.clientWidth;});}
    const index=doc.querySelector('.document-index');
    if(index){index.clientWidth=Math.min(980,win.width-40);index.querySelectorAll('a').forEach((a,i)=>{a.offsetLeft=i*49;a.offsetWidth=42;});}
  };
  layout();
  win.resize=w=>{win.width=w;layout();for(const m of win.media){if(!m.q.includes('max-width'))continue;const next=w<=m.maxWidth;if(m.matches!==next){m.matches=next;m.emit('change',{matches:next});}}win.emit('resize');};
  const context={document:doc,window:win,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>fn()};
  vm.runInNewContext(payload.script,context,{timeout:5000});
  return {doc,win,flush:()=>{for(const [id,fn]of [...timers]){timers.delete(id);fn();}}};
}
const widths=[375,390,768,1024,1199,1200,1280,1440];
for(const fixture of payload.fixtures)for(const width of widths){
  const {doc,win,flush}=environment(fixture,width);
  const backTop=doc.querySelector('.back-top');
  check(backTop?.getAttribute('href')==='#top'&&doc.getElementById('top')===doc.body,'native back-to-top target is the document body, outside the sticky header');
  win.location.search='?source=footer';win.location.hash='#member-koji';win.scrollY=12000;win.scrollX=50;
  const historyState={source:'footer'};win.history.state=historyState;
  check(backTop.click().defaultPrevented&&win.scrollY===0&&win.scrollX===0&&win.lastScrollBehavior==='smooth','back-to-top returns the page to zero from a deep section');
  check(win.location.hash==='#top'&&win.location.search==='?source=footer'&&decodeURIComponent(win.location.pathname)===fixture.path&&win.history.state===historyState,'back-to-top preserves the page, query and history state');
  win.scrollY=9000;
  check(backTop.click({detail:0}).defaultPrevented&&win.scrollY===0,'keyboard activation returns to zero even when the URL already ends in top');
  for(const props of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]){
    win.scrollY=9000;
    check(!backTop.click(props).defaultPrevented&&win.scrollY===9000,'modified back-to-top activation retains native browser behavior');
  }
  win.location.search='';win.location.hash='';win.scrollY=0;
  const english=doc.documentElement.getAttribute('lang')==='en';
  const language=doc.querySelector('[data-language-link="'+(english?'ja':'en')+'"]');
  const currentLocale=doc.querySelector('[data-language-link="'+(english?'en':'ja')+'"]');
  check(language&&currentLocale.getAttribute('aria-current')==='page','language links identify current locale');
  win.location.search='?source=menu';win.location.hash='#main';
  check(!language.click({ctrlKey:true}).defaultPrevented&&new URL(language.href).hash==='#main'&&new URL(language.href).search==='?source=menu','language switch preserves query and hash with native modified click');
  check(decodeURIComponent(new URL(language.href).pathname)===(english?fixture.path.slice(3):'/en'+fixture.path),'language switch targets equivalent page');
  win.location.search='';win.location.hash='';
  const nav=doc.querySelector('.primary-nav'),button=doc.querySelector('.mobile-toggle');
  const toggle=nav.querySelector('.dropdown-toggle');
  const closed=()=>button.getAttribute('aria-expanded')==='false'&&!nav.classList.contains('is-open')&&!doc.body.classList.contains('menu-open')&&!nav.querySelector('li.is-open');
  check(closed(),'menu initially closed');
  button.click();
  check(button.getAttribute('aria-label')===(width<1200?(english?'Close menu':'メニューを閉じる'):(english?'Open menu':'メニューを開く')),'menu label follows locale and state');
  check(width<1200?button.getAttribute('aria-expanded')==='true'&&nav.classList.contains('is-open')&&doc.body.classList.contains('menu-open'):closed(),'mobile toggle follows breakpoint');
  const menuSpace=()=>`${win.visualViewport.height-headerBottom()-12}px`;
  const headerBottom=()=>doc.querySelector('.site-header').getBoundingClientRect().bottom;
  check(nav.style.values['--menu-height']===menuSpace(),'menu height fits available viewport');
  win.visualViewport.height=560;win.visualViewport.emit('resize');
  check(nav.style.values['--menu-height']===menuSpace(),'menu height follows mobile browser viewport changes');
  check(width<1200?nav.classList.contains('is-open'):closed(),'viewport changes do not close the menu');
  win.visualViewport.height=844;win.visualViewport.emit('resize');
  toggle.click();check(toggle.getAttribute('aria-expanded')==='true','submenu opens');
  toggle.click();check(toggle.getAttribute('aria-expanded')==='false','submenu closes on second click');
  const nested=nav.querySelectorAll('.dropdown-toggle').find(t=>!t.parentElement.parentElement.classList.contains('nav-level-0'));
  if(nested){
    let root=nested.parentElement;while(!root.parentElement.classList.contains('nav-level-0'))root=root.parentElement.closest('li');
    const rootToggle=root.querySelector(':scope > .dropdown-toggle');rootToggle.click();nested.click();
    check(nested.getAttribute('aria-expanded')==='true','nested submenu opens');rootToggle.click();
    check(nested.getAttribute('aria-expanded')==='false'&&!root.querySelector('li.is-open'),'closing parent resets descendants');
    rootToggle.click();nested.click();const other=nav.querySelectorAll('.nav-level-0 > li').find(li=>li!==root&&li.querySelector(':scope > .dropdown-toggle'));
    other.querySelector(':scope > .dropdown-toggle').click();check(nested.getAttribute('aria-expanded')==='false'&&!root.classList.contains('is-open'),'sibling resets old branch');
  }
  doc.body.click();check(closed(),'outside click resets menu');
  button.click();toggle.click();doc.body.emit('keydown',{key:'Escape'},true);
  check(closed(),'Escape resets open menu and submenus');check(doc.activeElement===(width<1200?button:toggle),'Escape restores focus');
  button.click();toggle.click();nav.querySelector('a').click();check(closed(),'navigation link closes menu');
  for(const link of doc.querySelectorAll('.header-links > a, [data-language-link], .brand')){
    button.click();toggle.click();
    check(!link.click().defaultPrevented&&closed(),'every header link closes menu without blocking navigation');
  }
  button.click();toggle.click();win.emit('pageshow',{persisted:true});
  check(closed(),'browser back restores a closed menu');
  for(const submenu of nav.querySelectorAll('.dropdown-toggle')){
    const parents=[];for(let li=submenu.parentElement;li;li=li.parentElement?.closest('li'))parents.unshift(li);
    for(const li of parents){const control=li.querySelector(':scope > .dropdown-toggle');if(control&&control.getAttribute('aria-expanded')!=='true')control.click();}
    const panel=doc.getElementById(submenu.getAttribute('aria-controls'));
    check(panel&&submenu.getAttribute('aria-expanded')==='true'&&submenu.parentElement.classList.contains('is-open'),'every submenu opens its named panel');
    submenu.click();check(submenu.getAttribute('aria-expanded')==='false'&&!submenu.parentElement.querySelector('li.is-open'),'every submenu resets after a second click');
    doc.body.click();check(closed(),'every submenu can be dismissed outside');
  }
  button.click();toggle.click();button.focus();doc.body.focus();check(closed(),'leaving header closes menu');
  win.resize(390);button.focus();button.click();win.resize(1440);
  check(closed()&&doc.activeElement===nav.querySelector('a'),'desktop resize resets menu and moves focus off hidden button');
  toggle.click();toggle.parentElement.querySelector('a').focus();win.resize(390);
  check(closed()&&doc.activeElement===button,'compact resize restores focus from hidden nav');
  const viewer=doc.querySelector('[data-document-viewer]');
  if(viewer){
    const track=viewer.querySelector('.document-track'),pages=viewer.querySelectorAll('.document-page'),links=viewer.querySelector('.document-index').querySelectorAll('a');
    const prev=viewer.querySelector('[data-document-prev]'),next=viewer.querySelector('[data-document-next]'),status=viewer.querySelector('[data-document-status]');
    const active=n=>status.textContent===`${n} / ${pages.length}`&&pages.filter(p=>!p.inert).length===1&&!pages[n-1].inert&&links[n-1].getAttribute('aria-current')==='page';
    check(active(1)&&prev.disabled&&!next.disabled&&!viewer.querySelector('.document-controls').hidden,'reader initializes first page');
    next.click();next.click();next.click();check(active(4)&&win.location.hash==='#page-4','rapid next clicks update page and hash');
    language.click();check(new URL(language.href).hash==='#page-4','language switch retains latest reader page after replaceState');
    check(track.scrollLeft===pages[3].offsetLeft-pages[0].offsetLeft,'scroll position matches selected page');
    track.emit('keydown',{key:'End'},true);check(active(pages.length)&&next.disabled,'End selects last page');
    track.emit('keydown',{key:'ArrowRight'},true);check(active(pages.length),'last page is clamped');
    prev.click();check(active(pages.length-1),'previous button moves back');
    track.emit('keydown',{key:'Home'},true);check(active(1)&&prev.disabled,'Home selects first page');
    check(links[4].click().defaultPrevented&&active(5),'numbered page link switches without default jump');
    check(!links[2].click({ctrlKey:true}).defaultPrevented&&active(5),'modified page click keeps browser behavior');
    win.location.hash='#page-2';win.emit('hashchange');check(active(2)&&track.lastScrollBehavior==='auto','hash navigation opens source page');
    win.location.hash='#page-999';win.emit('hashchange');check(active(2),'invalid hash is ignored');
    pages[1].querySelector('details').setAttribute('open','');pages[1].querySelector('.document-page-image').focus();
    track.emit('keydown',{key:'ArrowRight'},true);check(active(3)&&doc.activeElement===track&&!pages[1].querySelector('details').hasAttribute('open'),'page change preserves visible focus and collapses old text');
    track.scrollLeft=pages[6].offsetLeft-pages[0].offsetLeft+3;track.emit('scrollend');check(active(7)&&win.location.hash==='#page-7','native horizontal scroll synchronizes controls');
    track.scrollLeft=pages[2].offsetLeft-pages[0].offsetLeft;track.emit('scroll');flush();check(active(3),'scroll debounce supports browsers without scrollend');
    win.resize(768);check(active(3)&&track.scrollLeft===pages[2].offsetLeft-pages[0].offsetLeft,'reader keeps page through resize');
    const hashEnv=environment(fixture,width,`#page-${pages.length}`);check(hashEnv.doc.querySelector('[data-document-status]').textContent===`${pages.length} / ${pages.length}`,'direct source link initializes last page');
    const badEnv=environment(fixture,width,'#page-999');check(badEnv.doc.querySelector('[data-document-status]').textContent===`1 / ${pages.length}`,'invalid initial hash defaults safely');
    const motionEnv=environment(fixture,width,'',true);motionEnv.doc.querySelector('[data-document-next]').click();check(motionEnv.doc.querySelector('.document-track').lastScrollBehavior==='auto','reduced motion skips animation');
    const summary=pages[2].querySelector('summary');summary.emit('keydown',{key:'ArrowRight'},true);check(active(3),'text disclosure retains its keyboard controls');
    const imageLink=pages[2].querySelector('.document-page-image');
    check(imageLink&&!imageLink.hidden&&imageLink.querySelector('img')&&!pages[2].querySelector('.document-page-translation'),'original page image is the default reader view');
    check(!pages[2].querySelector('details').hidden&&!pages[2].querySelector('details').hasAttribute('open'),'optional text remains collapsed');
    imageLink.click();const dialog=doc.querySelector('.photo-dialog');
    check(dialog.hasAttribute('open')&&dialog.querySelector('img').src===imageLink.href,'page image opens enlargement');
    dialog.querySelector('img').emit('error');check(dialog.querySelector('.photo-caption').querySelector('a').href===imageLink.href,'failed enlargement offers original image');
    check(dialog.querySelector('.photo-caption').textContent.includes(english?'The image could not be loaded.':'画像を読み込めませんでした。'),'image fallback follows locale');
    dialog.querySelector('.photo-close').click();check(!dialog.hasAttribute('open')&&!dialog.querySelector('img').hasAttribute('src'),'enlargement closes and clears image');
  }
  const form=doc.querySelector('form[data-pending-backend]');
  if(form)check(form.emit('submit',{},true).defaultPrevented&&doc.getElementById('contact-note').scrolledIntoView,'unconfigured contact form stays blocked');
  const dialog=doc.querySelector('.photo-dialog'),photo=dialog.querySelector('img'),caption=dialog.querySelector('.photo-caption');
  for(const link of doc.querySelectorAll('a[data-lightbox]')){
    check(!link.click({ctrlKey:true}).defaultPrevented&&!dialog.open,'every modified photo click keeps native navigation');
    check(link.click().defaultPrevented&&dialog.open&&photo.src===link.href,'every photo button opens the intended image');
    dialog.click({clientX:30,clientY:30});check(dialog.open,'clicking dialog padding does not dismiss the photo');
    dialog.querySelector('.photo-close').click();
    check(!dialog.open&&!photo.hasAttribute('src')&&!caption.textContent,'every close button clears old image and caption state');
    photo.emit('error');check(!caption.textContent,'late image errors do not persist after closing');
    link.click();dialog.click({clientX:0,clientY:0});check(!dialog.open,'every enlargement can be dismissed on its backdrop');
    link.click();win.emit('pageshow',{persisted:true});check(!dialog.open,'browser back does not preserve an enlargement');
  }
  const image=doc.querySelector('img[src]');image.emit('error');const failures=doc.querySelectorAll('.image-error').length;image.emit('error');
  check(failures===1&&doc.querySelectorAll('.image-error').length===1,'image failure fallback appears once');
}
const home=payload.fixtures[0];
const animated=environment(home,1280);
const observer=animated.win.intersections[0],hero=animated.doc.querySelector('.hero-copy');
check(observer.targets.has(hero)&&!hero.classList.contains('is-revealed'),'animation waits for visible content');
observer.fire(hero,false);check(observer.targets.has(hero)&&!hero.classList.contains('is-revealed'),'offscreen content does not start animation');
observer.fire(hero,true);check(hero.classList.contains('is-revealed')&&!observer.targets.has(hero),'visible content animates once');
const focused=animated.doc.querySelector('.feature-link');focused.querySelector('img').focus();
observer.fire(focused,true);check(!focused.classList.contains('is-revealed')&&!observer.targets.has(focused),'focused content stays still');
const memberFixture=payload.fixtures.find(f=>f.path==='/idfc2027/実行委員/');
const memberMotion=environment(memberFixture,1280);
const memberObserver=memberMotion.win.intersections[0];
for(const selector of ['.member-card','.pie-chart','.executive-grid > article']){
  const target=memberMotion.doc.querySelector(selector);
  check(memberObserver.targets.has(target)&&!target.classList.contains('is-revealed'),'new content waits for viewport visibility');
  memberObserver.fire(target,false);check(memberObserver.targets.has(target),'offscreen content does not animate');
  memberObserver.fire(target,true);check(target.classList.contains('is-revealed')&&!memberObserver.targets.has(target),'new content animates once');
}
const reduced=environment(home,1280,'',true);check(reduced.win.intersections.length===0&&!reduced.doc.querySelector('.is-revealed'),'reduced motion skips entrance animations');
for(const fixture of payload.fixtures.filter(f=>['/','/en/'].includes(f.path)))for(const width of [390,1280]){
  const {doc,win}=environment(fixture,width,'#main',true);win.scrollY=9000;
  check(doc.querySelector('.back-top').click().defaultPrevented&&win.scrollY===0&&win.lastScrollBehavior==='instant','reduced motion returns to the document top without animation in both languages');
}
const fallback=environment(home,1280,'',false,false);check(!fallback.doc.querySelector('.is-revealed'),'missing observer preserves visible content and functionality');
animated.win.resize(390);check(animated.doc.documentElement.style.values['--header-height']==='74px','anchor offset updates with header size');

// Simulate reading long sections, individual members, and legacy deep links.
for(const fixture of payload.fixtures.filter(f=>['/idfc2027/','/idfc2027/活動/','/idfc2027/実行委員/','/idfc2027/資料/','/en/idfc2027/','/en/idfc2027/活動/','/en/idfc2027/実行委員/','/en/idfc2027/資料/'].includes(f.path)))for(const width of [390,1280]){
  const {doc,win}=environment(fixture,width);
  const hub=doc.querySelector('[data-year-hub]'),menu=doc.querySelector('.year-section-nav'),contents=doc.querySelector('.article-aside'),details=contents.querySelector('details');
  const links=contents.querySelectorAll('a');
  const entries=links.map(link=>({link,target:doc.getElementById(link.getAttribute('href').slice(1))}));
  win.scrollY=0;
  entries.forEach(({target},i)=>{target.getBoundingClientRect=()=>({top:600+i*900-win.scrollY,bottom:1500+i*900-win.scrollY,height:900});});
  menu.getBoundingClientRect=()=>({top:width<1200?74:210,bottom:width<1200?144:280,height:70});
  details.getBoundingClientRect=()=>({top:304,bottom:800,height:496});details.scrollTop=0;
  menu.clientWidth=320;
  menu.querySelectorAll('a').forEach((a,i)=>{a.offsetLeft=i*180;a.offsetWidth=170;});
  win.emit('resize');win.emit('scroll');
  check(entries[0].link.getAttribute('aria-current')==='location','reading starts with the overview in the contents');
  check(menu.querySelectorAll('a').length===7,'Japan and Myanmar committees are separate chapters in the year menu');
  for(const link of menu.querySelectorAll('a'))check(link.getAttribute('href').startsWith('#')&&new URL(link.href).pathname===win.location.pathname,'each year choice stays on the current document');
  for(const id of ['school','greeting-kazuki','japan-members-2027','member-koji','myanmar-members-2027','member-aleo','myanmar-academic-2027','member-hsaw-reh','documents-2027','supporters-2027']){
    const index=entries.findIndex(({target})=>target.getAttribute('id')===id);
    check(index>=0,'the contents includes every major section and Koji');
    const activation=(width<1200?74:210)+24;
    win.scrollY=600+index*900-activation+10;win.emit('scroll');
    check(entries[index].link.getAttribute('aria-current')==='location'&&contents.querySelectorAll('a[aria-current]').length===1,'scrolling identifies exactly the section being read');
    const chapter=entries[index].target.closest('[data-year-section]').getAttribute('data-year-section');
    check(menu.querySelector('[aria-current]').getAttribute('data-year-target')===chapter,'the year menu follows the current chapter');
    check(doc.querySelector('.site-header [data-year-target="'+chapter+'"]').getAttribute('aria-current')==='location','the header submenu follows the current chapter');
    win.scrollY+=800;win.emit('scroll');
    check(entries[index].link.getAttribute('aria-current')==='location','long sections stay selected until the next heading');
  }
  check(menu.scrollLeft>0,'the active year choice remains visible in the narrow menu');
  win.location.hash='#member-koji';win.emit('load');
  check(doc.getElementById('member-koji').scrolledIntoView,'member deep links reveal the named member');
  win.location.hash='';win.emit('load');
  const initial=hub.getAttribute('data-initial-section');
  if(initial!=='overview-2027')check(doc.getElementById(initial).scrolledIntoView,'existing year URLs open their original section');
  const language=doc.querySelector('[data-language-link="'+(fixture.path.startsWith('/en/')?'ja':'en')+'"]');
  win.location.hash='#member-koji';language.click();
  check(new URL(language.href).hash==='#member-koji','changing language preserves the current member anchor');
}
process.stdout.write(JSON.stringify({result:'pass',assertions:checks,fixtures:payload.fixtures.length,widths,scope:'Generated HTML + real site.js, simulated DOM events and layout geometry'}));
