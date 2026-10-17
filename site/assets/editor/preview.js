(() => {
  const scope=document.body.dataset.editorScope;
  const root=document.querySelector(scope==='main'?'main#main':scope==='header'?'header.site-header':'footer.site-footer');
  if(!root)return;
  let selected=null,range=null,nextID=0;
  const send=(type,value={})=>parent.postMessage({channel:'idfc-editor',type,...value},location.origin);
  const within=node=>node&&root.contains(node.nodeType===1?node:node.parentElement);
  function setup(){
    root.querySelectorAll('[contenteditable]').forEach(el=>el.removeAttribute('contenteditable'));
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,dt,dd,figcaption,td,th,blockquote,a,span').forEach(el=>{
      if(el.closest('svg')||el.querySelector('img,picture,svg,button,input,select,textarea,p,li,h1,h2,h3,h4,ul,ol,dl,div,section,article')||!el.textContent.trim())return;
      if(el.parentElement.closest('[contenteditable=true]'))return;
      el.setAttribute('contenteditable','true');el.setAttribute('spellcheck','true');
    });
    root.querySelectorAll('img,a').forEach(el=>{if(!el.dataset.editorId)el.dataset.editorId=String(++nextID);});
  }
  setup();
  document.addEventListener('selectionchange',()=>{const s=getSelection();if(s.rangeCount&&within(s.anchorNode)){range=s.getRangeAt(0).cloneRange();}});
  document.addEventListener('click',e=>{
    if(e.target.closest('summary'))return;
    e.preventDefault();e.stopImmediatePropagation();
    if(!root.contains(e.target))return;
    const node=e.target.closest('img,[contenteditable=true],a');if(!node)return;
    if(selected)selected.removeAttribute('data-editor-selected');
    selected=node;node.setAttribute('data-editor-selected','');
    const link=node.closest('a');
    send('selected',{kind:node.tagName==='IMG'?'image':'text',text:node.tagName==='IMG'?(node.alt||'写真'):node.textContent.slice(0,65),src:node.getAttribute('src'),alt:node.getAttribute('alt')||'',href:link?.getAttribute('href')||'',hasLink:!!link});
  },true);
  document.addEventListener('submit',e=>e.preventDefault(),true);
  root.addEventListener('input',()=>send('dirty'));
  root.addEventListener('paste',e=>{e.preventDefault();const text=e.clipboardData.getData('text/plain');document.execCommand('insertText',false,text);send('dirty');});
  function html(){const clone=root.cloneNode(true);clone.querySelectorAll('[contenteditable],[data-editor-selected],[data-editor-id]').forEach(el=>{for(const attr of ['contenteditable','data-editor-selected','data-editor-id','spellcheck'])el.removeAttribute(attr);});return clone.innerHTML;}
  window.addEventListener('message',e=>{
    if(e.origin!==location.origin||e.source!==parent||e.data.channel!=='idfc-editor')return;
    const msg=e.data;
    if(msg.type==='serialize'){send('serialized',{html:html(),requestId:msg.requestId});return;}
    if(msg.type==='replace'){root.innerHTML=msg.html;selected=null;range=null;setup();send('ready');if(msg.requestId)send('replaced',{requestId:msg.requestId});return;}
    if(msg.type==='command'){
      if(!range||!within(range.commonAncestorContainer))return;
      const target=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
      target.closest('[contenteditable=true]')?.focus();
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      document.execCommand(msg.command,false,msg.value||null);send('dirty');return;
    }
    if(!selected)return;
    if(msg.type==='image'&&selected.tagName==='IMG'){
      selected.src=msg.url;selected.removeAttribute('srcset');selected.removeAttribute('sizes');selected.removeAttribute('data-src');selected.removeAttribute('width');selected.removeAttribute('height');
      const anchor=selected.closest('a[data-lightbox]');if(anchor)anchor.href=msg.url;
    }
    if(msg.type==='alt'&&selected.tagName==='IMG')selected.alt=msg.value;
    if(msg.type==='link'){const link=selected.closest('a');if(link)link.setAttribute('href',msg.url);}
    send('dirty');
  });
  if(scope==='footer')root.scrollIntoView();
  if(scope==='header')window.scrollTo(0,0);
  send('ready');
})();
