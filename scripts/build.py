"""Build complete bilingual static pages from the captured source."""
import copy, hashlib, json, re, shutil
from pathlib import Path
from urllib.parse import urljoin, urlsplit, unquote, quote
from html import escape
from lxml import html, etree
import content_2027
import polish
import news as news_content
import photos_2026
import design
import archives
from contacts import INSTAGRAMS
from languages import Translations, locale_path, remember, inner_html, set_inner_html, restore_document, SOURCE, GENERATED

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT/'site'
ORIGIN = 'https://idfc-jpn-mmr.jimdofree.com'
SITE = json.loads((ROOT/'.openai/hosting.json').read_text())
NEW_ORIGIN = 'https://idfc-japan-myanmar.hannaowo.chatgpt.site'
DATA = json.loads((ROOT/'reports/inventory.json').read_text())
PAGES = json.loads((ROOT/'source/all-pages.json').read_text())
NAV = DATA['navigation']
NAV.insert(2, {'path':'/idfc2027/','label':'IDFC2027','children':[
    {'path':'/idfc2027/#'+ident,'label':label,'children':[],'year_target':ident}
    for ident,label in content_2027.HUB_SECTIONS]})
next(n for n in NAV if n['path']=='/これまでの活動/')['children'].append(
    {'path':'/これまでの活動/idfc2026/','label':'IDFC2026','children':[]})
HEADER_LINK_PATHS = ('/新規スポンサー様募集/', '/お問合せ/')
HEADER_NAV = [copy.deepcopy(item) for item in NAV if item['path'] not in ('/web-media/', '/blog/', *HEADER_LINK_PATHS)]
next(n for n in HEADER_NAV if n['path']=='/これまでの活動/')['children'].insert(0,
    {'path':'/これまでの活動/','label':'IDFC2016–2018','children':[]})
LABELS = {}
def flatten(items):
    for i in items:
        LABELS[i['path']]=i['label']; flatten(i['children'])
flatten(NAV)
LABELS.update({'/about/':'概要','/j/privacy/':'プライバシーポリシー','/sitemap/':'サイトマップ','/blog-1/':'Blog'})
LABELS.update(content_2027.ROUTES)

def path_of(u):
    s=unquote(urlsplit(u).path)
    return s.rstrip('/')+'/' if s != '/' else '/'

def norm(s): return re.sub(r'\s+',' ',s).strip()
def serial(n): return html.tostring(n,encoding='unicode',method='html')
def inner(n): return (escape(n.text) if n.text else '')+''.join(serial(c) for c in n)
def klass(n,c): n.set('class',(n.get('class','')+' '+c).strip())
def remove(n):
    if n.getparent() is not None: n.drop_tree()
def decode_email(n):
    a=n if n.tag=='a' else n.getparent()
    t=a.get('title','')
    if re.match(r'^[^ @]+@[^ @]+\.[^ @]+$',t): return t
    encoded=n.get('data-cfemail','')
    if encoded:
        try:
            b=bytes.fromhex(encoded); return bytes(x^b[0] for x in b[1:]).decode('utf-8')
        except ValueError: pass
    return None

def new_href(u,base):
    if u.startswith('#') or u.startswith('mailto:') or u.startswith('tel:'): return u
    a=urljoin(base,u.strip()); s=urlsplit(a)
    if s.hostname=='idfc-jpn-mmr.jimdofree.com':
        if s.path.startswith('/app/download/') or s.path.startswith('/rss/'): return a
        p=path_of(a)
        return p+('?' + s.query if s.query else '')+('#'+s.fragment if s.fragment else '')
    return a if s.scheme in ('http','https') else u

def clean(source,base,footer=False):
    n=copy.deepcopy(source)
    for c in n.xpath('.//comment()'): c.getparent().remove(c)
    for el in list(n.xpath('.//script|.//style|.//link|.//*[@id="imprint"]|.//*[@data-display="cms-only"]|.//*[contains(concat(" ",normalize-space(@class)," ")," j-spacing ")]')):
        remove(el)
    for el in list(n.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," cc-clear ") or contains(concat(" ",normalize-space(@class)," ")," cc-m-video-overlay ") or contains(concat(" ",normalize-space(@class)," ")," cc-m-gallery-slider-fullscreen ")]')): remove(el)
    for el in list(n.xpath('.//*[contains(@class,"__cf_email__")]')):
        email=decode_email(el)
        if email:
            if el.tag=='a':
                for child in list(el): el.remove(child)
                el.text=email; el.set('href','mailto:'+email); el.attrib.pop('data-cfemail',None)
            else:
                el.text=email; el.attrib.pop('data-cfemail',None); parent=el.getparent()
                if parent.tag=='a':parent.set('href','mailto:'+email)
    for el in n.iter():
        if not isinstance(el.tag,str):continue
        style=el.get('style','')
        if 'display: none' in style or 'display:none' in style: el.set('hidden','hidden')
        if 'text-decoration: underline' in style:klass(el,'underlined')
        el.attrib.pop('style',None)
        for attr in list(el.attrib):
            if attr.lower().startswith('on'): el.attrib.pop(attr,None)
        if el.tag=='h1':el.tag='h2'
        if el.tag in ('h4','h5','h6'):el.tag='h3'
        if el.tag=='a':
            u=el.get('href','')
            if u.startswith('javascript:') and el.get('data-href'):
                u=el.get('data-href');el.set('data-lightbox','true')
            if u=='javascript:' and not el.get('data-href'):el.set('hidden','hidden')
            else:el.set('href',new_href(u,base))
            if el.get('target')=='_blank':el.set('rel','noopener noreferrer')
            if el.xpath('./img') and not norm(''.join(el.itertext())):el.set('aria-label',el.xpath('./img')[0].get('alt') or '写真を開く')
        if el.tag=='img':
            el.set('loading','lazy');el.set('decoding','async')
            if el.get('alt') is None:el.set('alt','')
            w=el.get('data-src-width') or el.get('data-orig-width') or el.get('width')
            h=el.get('data-src-height') or el.get('data-orig-height') or el.get('height')
            if w and h:
                try:el.set('width',str(round(float(w))));el.set('height',str(round(float(h))))
                except ValueError:pass
            if el.get('srcset'):el.set('sizes','(max-width: 767px) calc(100vw - 40px), 800px')
        if el.tag=='iframe':
            el.set('loading','lazy');el.set('title',el.get('title') or ('YouTube' if 'youtube' in el.get('src','') else 'Google Drive')+' — '+LABELS.get(path_of(base),'IDFC'))
            el.set('allowfullscreen','allowfullscreen');el.set('referrerpolicy','strict-origin-when-cross-origin')
    for grid in n.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," j-hgrid ")]'):
        cols=grid.xpath('./div[contains(@class,"cc-m-hgrid-column")]')
        grid.set('data-columns',str(len(cols)))
        if not grid.xpath('.//img|.//iframe|.//input|.//a[@href]') and not norm(''.join(grid.itertext())):remove(grid)
    for gallery in n.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," j-gallery ")]'):
        anchors=gallery.xpath('.//ul/li/a[@data-href]')
        for a in gallery.xpath('.//a[@data-slide-index]'):
            i=int(a.get('data-slide-index')); a.set('href',anchors[i].get('href') if i<len(anchors) else '#')
            a.set('data-lightbox','true');a.set('aria-label','写真を開く')
        for a in anchors:
            caption=a.get('data-title','') or (a.xpath('./img')[0].get('data-subtitle','') if a.xpath('./img') else '')
            if caption:
                span=etree.SubElement(a,'span',{'class':'gallery-caption'});span.text=caption
    for form in n.xpath('.//form'):
        form.set('action','#contact-note');form.set('data-pending-backend','true');form.set('aria-describedby','contact-note')
        for field in form.xpath('.//div[contains(@class,"cc-m-required")]//input|.//div[contains(@class,"cc-m-required")]//textarea'):
            field.set('required','required');field.set('aria-required','true')
        for field in form.xpath('.//input[@type="submit"]'):
            field.set('type','button');field.set('disabled','disabled');field.set('aria-describedby','contact-note')
        for label in form.xpath('.//label[@for]'):
            if not form.xpath('.//*[@id=$ident]',ident=label.get('for')):
                label.tag='p';label.attrib.pop('for',None)
    if footer:
        for module in list(n.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," j-facebook ") or contains(concat(" ",normalize-space(@class)," ")," j-twitter ")]')):
            buttons=module.xpath('.//button')
            text=norm(''.join(buttons[0].itertext())) if buttons else ''
            dest='https://www.facebook.com/idfc.myanmar.japan/' if 'j-facebook' in module.get('class','') else 'https://x.com/mingalabar_idfc'
            # User requested one official link per SNS instead of duplicate widgets.
            if any(a.get('href')==dest and module not in a.iterancestors() for a in n.xpath('.//a[@href]')):
                remove(module)
                continue
            for child in list(module):module.remove(child)
            a=etree.SubElement(module,'a',{'href':dest,'target':'_blank','rel':'noopener noreferrer','class':'social-connect'});a.text=text
    seen={}
    for element in n.xpath('.//*[@id]'):
        ident=element.get('id');seen[ident]=seen.get(ident,0)+1
        if seen[ident]>1:
            element.set('data-source-id',ident);element.set('id',ident+'-duplicate-'+str(seen[ident]))
    return n

DOCS={path_of(p['url']):html.fromstring(p['text']) for p in PAGES}
HOME_DOC=DOCS['/']
ORIGINAL_LOGO=HOME_DOC.xpath('//*[@id="cc-website-logo"]//img')[0]
LOGO_SRC=ORIGINAL_LOGO.get('src')
ICON_SRC='/assets/images/idfc-logo.svg?v='+hashlib.sha256((DIST/'assets/images/idfc-logo.svg').read_bytes()).hexdigest()[:12]
EN_TITLE=norm(''.join(HOME_DOC.xpath('//*[@id="cc-website-title"]')[0].itertext()))
HERO=HOME_DOC.xpath('//meta[@property="og:image"]')[0].get('content')
ABOUT_DOC=DOCS['/about-idfc/'].xpath('//*[@id="content_area"]')[0]
ABOUT_COPY=ABOUT_DOC.xpath('.//div[contains(concat(" ",normalize-space(@class)," ")," j-text ")]')[0]
ABOUT_INTRO=''.join(ABOUT_COPY.xpath('./p')[1].itertext())

def nav_html(items,current,level=0,prefix='nav'):
    result=[]
    for idx,item in enumerate(items):
        active=current==item['path'];branch=bool(item['children']) and current.startswith(item['path']) and item['path']!='/'
        cls='has-menu' if item['children'] else ''
        if active or branch:cls+=' is-current'
        aria=' aria-current="page"' if active else ''
        target=f' data-year-target="{escape(item["year_target"])}"' if item.get('year_target') else ''
        text=f'<a href="{escape(item["path"])}"{aria}{target}>{escape(item["label"])}</a>'
        if item['children']:
            mid=f'{prefix}-{idx}'
            text+=f'<button type="button" class="dropdown-toggle" aria-label="{escape(item["label"])}の子ページ" aria-expanded="false" aria-controls="{mid}"><span aria-hidden="true">⌄</span></button>'
            text+=f'<ul id="{mid}" class="nav-level-{level+1}">'+nav_html(item['children'],current,level+1,mid)+'</ul>'
        result.append(f'<li class="{cls.strip()}">{text}</li>')
    return ''.join(result)

def header(current):
    links = ''.join(
        f'<a href="{escape(path)}"'
        + (' class="contact-button"' if path == '/お問合せ/' else '')
        + (' aria-current="page"' if current == path else '')
        + f'>{escape(LABELS[path])}</a>'
        for path in HEADER_LINK_PATHS
    )
    return f'''<a class="skip-link" href="#main">本文へ移動</a>
<header class="site-header"><div class="brand-row wrap">
<a class="brand" href="/"><img src="{escape(LOGO_SRC)}" alt="{escape(ORIGINAL_LOGO.get('alt',''))}" width="72" height="54" decoding="async"><span><strong>IDFC</strong><span>日本ミャンマー学生会議</span></span></a>
<div class="header-tools"><div class="header-links">{links}</div></div>
<button type="button" class="mobile-toggle" aria-expanded="false" aria-controls="primary-navigation" aria-label="メニューを開く"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></button></div>
<nav id="primary-navigation" class="primary-nav" aria-label="メインナビゲーション"><div class="wrap"><ul class="nav-level-0">{nav_html(HEADER_NAV,current)}</ul></div></nav></header>'''

FOOTER_NODE=HOME_DOC.xpath('//*[@data-container="sidebar"]')[0]
def footer():
    ft=clean(FOOTER_NODE,ORIGIN+'/',footer=True)
    # The user has retired this address; remove its complete contact row.
    for paragraph in ft.xpath('.//p[.//a[@href="mailto:idfc.jp.2016@gmail.com"]]'):
        paragraph.drop_tree()
    for paragraph in ft.xpath('.//p'):
        text=norm(paragraph.text_content())
        if '団体名：' in text or text in (
            '日本ミャンマー学生会議',
            '( International Development Field Camp',
            'for Myanmar and Japan Youth Leaders )',
        ):
            paragraph.drop_tree()
    for paragraph in list(ft.xpath('.//p')):
        if not norm(paragraph.text_content()) and not paragraph.xpath('.//a|.//img|.//iframe|.//svg'):
            paragraph.drop_tree()
    for module in list(ft.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," j-module ")]')):
        if not norm(module.text_content()) and not module.xpath('.//a|.//img|.//iframe|.//svg'):
            module.drop_tree()
    columns=ft.xpath('.//*[contains(@class,"cc-m-hgrid-column")]')
    if columns:klass(columns[0],'footer-sitemap')
    if len(columns)>1:
        klass(columns[1],'footer-contact')
        columns[1].append(html.fragment_fromstring(content_2027.footer_contacts()))
    if len(columns)>2:
        klass(columns[2],'footer-social')
        for link in columns[2].xpath('.//a[@href]'):
            host=urlsplit(link.get('href')).hostname or ''
            icon,label=('facebook','Facebook') if host in ('facebook.com','www.facebook.com') else \
                       ('x','X') if host in ('twitter.com','www.twitter.com','x.com','www.x.com') else \
                       ('instagram','Instagram') if host in ('instagram.com','www.instagram.com') else (None,None)
            if icon is None:continue
            if icon=='instagram':label='Instagram（日本側）'
            paragraph=link.getparent()
            originals=json.loads(paragraph.get(SOURCE,'{}'))
            originals.setdefault('html',inner(paragraph))
            paragraph.set(SOURCE,json.dumps(originals,ensure_ascii=False,separators=(',',':')))
            paragraph.text=None
            link.text=None
            remember(link,'title',label)
            link.set('aria-label',label)
            klass(link,'footer-social-link')
            klass(paragraph,'footer-social-row')
            etree.SubElement(link,'img',{'src':f'/assets/icons/{icon}.svg','alt':'','width':'28','height':'28','loading':'lazy','decoding':'async',GENERATED:'true'})
            etree.SubElement(link,'span',{GENERATED:'true'}).text=label
            if icon=='instagram':
                row=etree.SubElement(paragraph.getparent(),'p',{'class':'footer-social-row',GENERATED:'true'})
                myanmar_link=etree.SubElement(row,'a',{'href':INSTAGRAMS['myanmar'],'target':'_blank','rel':'noopener noreferrer','class':'footer-social-link','aria-label':'Instagram（ミャンマー側）'})
                etree.SubElement(myanmar_link,'img',{'src':'/assets/icons/instagram.svg','alt':'','width':'28','height':'28','loading':'lazy','decoding':'async'})
                etree.SubElement(myanmar_link,'span').text='Instagram（ミャンマー側）'
        grid=columns[0].getparent()
        klass(grid,'footer-layout')
        secondary=etree.SubElement(grid,'div',{'class':'footer-secondary'})
        secondary.append(columns[1])
        secondary.append(columns[2])
    return f'''<footer class="site-footer"><div class="wrap"><div class="footer-brand"><span>IDFC</span></div>{content_2027.footer_update()}<div data-preserved-footer="true">{inner(ft)}</div><div class="footer-bottom"><a href="/about/">概要</a><a href="/j/privacy/">プライバシーポリシー</a><a href="/sitemap/">サイトマップ</a><a href="http://idfc-jp-2016.hatenablog.com/" target="_blank" rel="noopener noreferrer">Blog</a><a href="#top" class="back-top">ページの先頭へ ↑</a></div></div></footer>'''

def page_head(doc,current):
    title=doc.findtext('.//title') or LABELS.get(current,'IDFC')
    meta=''.join(serial(n) for n in doc.xpath('//head/meta[@name="description" or starts-with(@property,"og:") or starts-with(@name,"twitter:") or @name="robots"]'))
    # Preserve captured metadata except the user-requested homepage introduction.
    mh=html.fragment_fromstring('<div>'+meta+'</div>')
    for n in mh.xpath('./meta[@property="og:url"]'):n.set('content',NEW_ORIGIN+quote(current,safe='/'))
    if current=='/':
        title='IDFC日本ミャンマー学生会議'
        values={'description':norm(ABOUT_INTRO),'og:title':title,'twitter:title':title,
                'og:description':norm(ABOUT_INTRO),'twitter:description':norm(ABOUT_INTRO)}
        for field,value in values.items():
            attribute='property' if field.startswith('og:') else 'name'
            nodes=mh.xpath('./meta[@'+attribute+'=$field]',field=field)
            if not nodes:nodes=[etree.SubElement(mh,'meta',{attribute:field})]
            for node in nodes:node.set('content',value)
    canonical=NEW_ORIGIN+quote(current,safe='/')
    return f'''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{escape(title)}</title>{inner(mh)}<link rel="canonical" href="{escape(canonical)}"><link rel="icon" href="{escape(ICON_SRC)}" type="image/svg+xml"><link rel="stylesheet" href="/assets/css/site.css?v={content_2027.ASSET_VERSION}"><script src="/assets/js/site.js?v={content_2027.ASSET_VERSION}" defer></script>{design.assets()}</head>'''

def breadcrumbs(current,label):
    parts=current.strip('/').split('/') if current!='/' else []
    result='<li><a href="/">HOME</a></li>'
    for i in range(1,len(parts)):
        p='/'+'/'.join(parts[:i])+'/'
        if p in LABELS:result+=f'<li><a href="{escape(p)}">{escape(LABELS[p])}</a></li>'
    result+=f'<li aria-current="page">{escape(label)}</li>'
    return '<nav class="breadcrumbs" aria-label="パンくず"><ol>'+result+'</ol></nav>'

def image_from(path):
    d=DOCS[path];c=d.xpath('//*[@id="content_area"]')[0]
    ims=c.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," j-gallery ")]//ul/li/a/img') or c.xpath('.//img[contains(@src,"jimcdn")]')
    return ims[0].get('src') if ims else HERO

def link_card(path,img=None):
    label=LABELS.get(path,path)
    photo=f'<img src="{escape(img)}" alt="" loading="lazy" decoding="async">' if img else ''
    return f'<a class="feature-link" href="{escape(path)}">{photo}<span>{escape(label)}</span><span class="arrow" aria-hidden="true">↗</span></a>'

def unify_social_icons(modules):
    """Replace the four mismatched badges while preserving original source fields."""
    for module in modules:
        for img in module.xpath('.//a[@href]/img'):
            link = img.getparent()
            host = urlsplit(link.get('href')).hostname or ''
            icon, label = ('facebook', 'Facebook') if 'facebook.com' in host else \
                          ('x', 'X') if host in ('twitter.com', 'x.com') else \
                          ('instagram', 'Instagram') if 'instagram.com' in host else \
                          ('blog', 'Blog') if host.endswith('hatenablog.com') else (None, None)
            if icon is None: continue
            if icon=='instagram':label='Instagram（日本側）'
            remember(img, 'src', f'/assets/icons/{icon}.svg')
            remember(img, 'alt', label)
            remember(img, 'width', '64')
            remember(img, 'height', '64')
            for field in ('srcset', 'sizes', 'data-src', 'data-src-width', 'data-src-height'):
                remember(img, field, None)
            link.set('aria-label', label)
            klass(link, 'social-icon-link')
            etree.SubElement(link, 'span', {'class':'social-name', GENERATED:'true'}).text = label

def homepage(cleaned):
    matrix=cleaned.xpath('./div[starts-with(@id,"cc-matrix")]')[0]
    children=list(matrix)
    news=children[:2]
    sponsor=[x for x in children if x.get('id') in ('cc-m-13828738423','cc-m-13824376823')]
    social=[x for x in children if x.get('id') in ('cc-m-12892055523','cc-m-12892055123')]
    # Locate by source heading/column content, independent of a vendor module ID.
    if not social:
        social=[x for x in children if 'Please Check Our Activities!' in ''.join(x.itertext()) or (x.xpath('.//a[contains(@href,"facebook.com")]') and '参加者募集' in ''.join(x.itertext()))]
    used={id(x) for x in news+sponsor+social}
    remaining=[x for x in children if id(x) not in used and (norm(''.join(x.itertext())) or x.xpath('.//img|.//iframe|.//a'))]
    news_html=serial(news[0])+news_content.render_collection(news[1])
    sponsor_html=''.join(serial(x) for x in sponsor)
    unify_social_icons(social)
    for module in social:
        japan_links=module.xpath('.//a[@href=$url]',url=INSTAGRAMS['japan'])
        if not japan_links:continue
        grid=japan_links[0].xpath('ancestor::*[contains(concat(" ",normalize-space(@class)," ")," j-hgrid ")]')[0]
        remember(grid,'data-columns',str(len(grid.xpath('./div[contains(@class,"cc-m-hgrid-column")]'))+1))
        column=etree.SubElement(grid,'div',{'class':'cc-m-hgrid-column',GENERATED:'true'})
        link=etree.SubElement(column,'a',{'href':INSTAGRAMS['myanmar'],'target':'_blank','rel':'noopener noreferrer','class':'social-icon-link','aria-label':'Instagram（ミャンマー側）'})
        etree.SubElement(link,'img',{'src':'/assets/icons/instagram.svg','alt':'','width':'64','height':'64','loading':'lazy','decoding':'async'})
        etree.SubElement(link,'span',{'class':'social-name'}).text='Instagram（ミャンマー側）'
    social_html=''.join(serial(x) for x in social)
    yrs=[n for n in NAV if n['path']=='/これまでの活動/'][0]['children']
    yearlinks=''.join(f'<a href="{escape(y["path"])}">{escape(y["label"])}</a>' for y in reversed(yrs))
    yearlinks+='<a href="/これまでの活動/">IDFC2016–2018</a>'
    voice_paths=['/idfc-next-参加者の声/idfc創設者/hashimoto-yu-前半/','/idfc-next-参加者の声/参加学生の声/sawada-mei/','/idfc-next-参加者の声/参加学生の声/nakada-naoyuki/']
    return f'''<main id="main" class="home">
<section class="hero">{design.hero_background()}<div class="hero-copy wrap"><div class="country-mark" aria-hidden="true"><span></span><span></span></div><p class="eyebrow">{escape(EN_TITLE)}</p><h1><span>IDFC</span>日本ミャンマー学生会議</h1><p class="hero-description">{escape(ABOUT_INTRO)}</p><div class="hero-actions"><a class="button" href="/idfc2027/">IDFC2027 <span aria-hidden="true">↗</span></a><a class="text-link" href="/about-idfc/">About IDFC <span aria-hidden="true">↗</span></a><a class="text-link" href="/これまでの活動/">これまでの活動 <span aria-hidden="true">→</span></a></div></div></section>
{design.story()}
{content_2027.home_feature()}
<div class="home-source" data-migrated="true" data-source-path="/">
<section class="home-news section wrap" id="news"><div class="section-label"><span>HOME / NEWS</span><div class="section-rule"></div></div><div class="news-layout">{news_html}</div></section>
<section class="home-activities section"><div class="wrap"><div class="section-heading"><h2>これまでの活動</h2><a class="text-link" href="/これまでの活動/">これまでの活動 <span aria-hidden="true">→</span></a></div><div class="activity-feature">{link_card(photos_2026.ROUTE,photos_2026.PHOTOS['group-evening']['src'])}<div class="archive-list">{yearlinks}</div></div>{photos_2026.home_preview()}</div></section>
<section class="home-voices section wrap"><div class="section-heading"><h2>IDFC NEXT~参加者の声~</h2><a class="text-link" href="/idfc-next-参加者の声/">IDFC NEXT~参加者の声~ →</a></div><div class="voice-grid">{''.join(link_card(p,image_from(p)) for p in voice_paths)}</div><div class="other-voices">{link_card('/アドバイザー/')}{link_card('/ミャンマーからの声/')}</div></section>
<section class="home-sponsor section"><div class="wrap sponsor-layout"><div class="sponsor-label"><span class="eyebrow">IDFC</span><h2>新規スポンサー様募集</h2><a class="button" href="/新規スポンサー様募集/">新規スポンサー様募集 ↗</a></div><div class="sponsor-original">{sponsor_html}</div></div></section>
<section class="home-social section wrap">{social_html}</section>
{''.join(serial(x) for x in remaining)}
{content_2027.home_supporters()}
</div></main>'''

def year_nav(current):
    items=[n for n in NAV if n['path']=='/これまでの活動/'][0]['children']
    links=''.join(f'<a href="{escape(n["path"])}"'+(' aria-current="page"' if n['path']==current else '')+f'>{escape(n["label"])}</a>' for n in items)
    return '<nav class="year-nav" aria-label="年別の活動"><a href="/これまでの活動/"'+(' aria-current="page"' if current=='/これまでの活動/' else '')+'>IDFC2016–2018</a>'+links+'</nav>'

def generic_page(p,cleaned):
    current=path_of(p['url']);label=LABELS.get(current,p.get('title') or 'IDFC')
    for idx,h in enumerate(cleaned.xpath('.//h2|.//h3')):
        h.set('id',h.get('id') or f'section-{idx+1}')
    archives.arrange(current,cleaned)
    polish.arrange(current,cleaned)
    for idx,h in enumerate(cleaned.xpath('.//h2|.//h3')):
        if not h.get('id'):h.set('id',f'section-{idx+1}')
    if current.startswith('/2016/'):label=p['title']
    category=LABELS.get('/'+current.strip('/').split('/')[0]+'/',label)
    interview=current.count('/')>=4 and ('idfc-next-' in current or '/ミャンマーからの声/' in current)
    cls='interview' if interview else 'archive-page' if current.startswith('/これまでの活動/') else ''
    heads=cleaned.xpath('.//h2[not(ancestor::details)]|.//h3[not(ancestor::details)]')
    toc=[]
    for h in heads:
        ident=h.get('id')
        if norm(''.join(h.itertext())):toc.append(f'<li><a href="#{escape(ident)}">{escape(norm("".join(h.itertext())))}</a></li>')
    toc_html='<aside class="article-aside"><details open><summary>このページ</summary><ol>'+''.join(toc)+'</ol></details></aside>' if len(toc)>2 else ''
    sub=''
    item=next((i for i in NAV if i['path']==current),None)
    if item and item['children'] and not current.startswith('/これまでの活動/'):
        sub='<nav class="category-links" aria-label="子ページ">'+''.join(f'<a href="{escape(c["path"])}">{escape(c["label"])}</a>' for c in item['children'])+'</nav>'
    if current == '/アドバイザー/':
        sub=sub.replace('</nav>','<a href="#advisor-khaing">ナンミャケーカイン 特別研究員</a></nav>')
    year=year_nav(current) if current.startswith('/これまでの活動/') else ''
    notice=''
    if current=='/お問合せ/':
        notice='<div class="notice" id="contact-note"><p>お問い合わせはメールで受け付けています。</p></div>'
    tail=''
    siblings=[r for r in DATA['pages'] if r['path'].rsplit('/',2)[0]==current.rsplit('/',2)[0]]
    paths=[r['path'] for r in siblings]
    if current in paths and len(paths)>1 and current!='/' and current.count('/')>2:
        i=paths.index(current);prev=siblings[i-1] if i>0 else None;nxt=siblings[i+1] if i+1<len(siblings) else None
        if prev or nxt:
            tail='<nav class="page-neighbors" aria-label="前後のページ">'+(f'<a href="{escape(prev["path"])}"><span>← Previous</span>{escape(LABELS.get(prev["path"],prev["title"]))}</a>' if prev else '<span></span>')+(f'<a href="{escape(nxt["path"])}"><span>Next →</span>{escape(LABELS.get(nxt["path"],nxt["title"]))}</a>' if nxt else '')+'</nav>'
    addition=content_2027.legacy_addition(current)
    return f'''<main id="main" class="{cls}"><div class="wrap">{breadcrumbs(current,label)}<header class="page-masthead"><p class="eyebrow">{escape(category)}</p><h1>{escape(label)}</h1></header>{year}{sub}<div class="article-layout {'with-aside' if toc_html else ''}"><article class="legacy-content" data-migrated="true" data-source-path="{escape(current)}">{addition}{notice}{inner(cleaned)}{tail}</article>{toc_html}</div></div></main>'''

def build():
    translations=Translations()
    paths=[r['path'] for r in DATA['pages']]+list(content_2027.ROUTES)
    def write_page(current, source):
        for locale in ('ja','en'):
            route=locale_path(current,locale)
            target=DIST/route.strip('/')/'index.html'
            target.parent.mkdir(parents=True,exist_ok=True)
            rendered=translations.render(polish.public_copy(source),current,locale,NEW_ORIGIN,set(paths))
            document=html.document_fromstring(rendered)
            for link in document.xpath('//a[@href]'):
                if link.get('data-language-link'):continue
                parts=urlsplit(link.get('href'))
                route=unquote(parts.path)
                prefix='/en' if locale=='en' else ''
                normalized=route[len(prefix):] if prefix and route.startswith(prefix+'/') else route
                ident=content_2027.HUB_ROUTES.get(normalized)
                if normalized=='/新規スポンサー様募集/' and parts.fragment=='supporters-2027':ident='partners-2027'
                if not ident or parts.scheme or parts.netloc:continue
                fragment=parts.fragment or ident
                # On every compatibility route, menu and shortcut clicks stay local.
                href='#'+fragment if current in content_2027.HUB_ROUTES else prefix+content_2027.BASE+'#'+fragment
                remember(link,'href',href)
            if current=='/about-idfc/' and locale=='ja':
                for paragraph in document.xpath('//p'):
                    if 'を開催して以来、本年度で7回目の開催を迎えようとしています。' in ''.join(paragraph.itertext()):
                        remember(paragraph, 'text', (paragraph.text or '').lstrip())
            if current=='/これまでの活動/':
                for link in document.xpath('//a[starts-with(@href,"javascript:")]'):
                    # The captured IDFC2017 link has no detail-page destination.
                    # Show its availability instead of a button that cannot work.
                    originals=json.loads(link.get(SOURCE,'{}'))
                    originals.setdefault('html',inner_html(restore_document(link)))
                    link.set(SOURCE,json.dumps(originals,ensure_ascii=False,separators=(',',':')))
                    remember(link,'href',None)
                    link.tag='span'
                    link.set('class','unavailable-link')
                    set_inner_html(link,'詳細ページは未掲載です。' if locale=='ja' else 'No separate report page is available.')
            for link in document.xpath('//a'):
                if link.get('aria-label') or link.get('title') or norm(''.join(link.itertext())) or len(link):
                    continue
                parent=link.getparent()
                originals=json.loads(parent.get(SOURCE,'{}'))
                originals.setdefault('html',inner_html(restore_document(parent)))
                parent.set(SOURCE,json.dumps(originals,ensure_ascii=False,separators=(',',':')))
                if link.get('id') or link.get('name'):
                    # Retain document bookmarks without making them empty links.
                    link.tag='span'
                    link.set('id',link.get('id') or link.get('name'))
                    link.attrib.pop('href',None)
                    link.attrib.pop('name',None)
                else:
                    link.drop_tree()
            target.write_text('<!doctype html>\n'+html.tostring(document,encoding='unicode',method='html'))
    DIST.mkdir(exist_ok=True)
    for folder in ['assets/css','assets/js','assets/images','migration']:(DIST/folder).mkdir(parents=True,exist_ok=True)
    for p in PAGES:
        current=path_of(p['url']);doc=DOCS[current];node=doc.xpath('//*[@id="content_area"]')[0]
        c=clean(node,p['url']);main=homepage(c) if current=='/' else generic_page(p,c)
        write_page(current,page_head(doc,current)+'<body id="top">'+header(current)+main+footer()+'''<dialog class="photo-dialog" aria-label="写真"><button class="photo-close" aria-label="写真を閉じる">×</button><img alt=""><p class="photo-caption"></p></dialog></body></html>''')
    for current in content_2027.ROUTES:
        write_page(current,content_2027.head(current,NEW_ORIGIN,ICON_SRC)+'<body id="top">'+header(current)+content_2027.render(current,breadcrumbs,year_nav)+footer()+'''<dialog class="photo-dialog" aria-label="写真・資料ページ"><button class="photo-close" aria-label="写真を閉じる">×</button><img alt=""><p class="photo-caption"></p></dialog></body></html>''')
    paths+=['/en'+path for path in paths]
    urls=''.join(f'<url><loc>{escape(NEW_ORIGIN+quote(path,safe="/"))}</loc></url>' for path in paths)
    (DIST/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls+'</urlset>')
    (DIST/'robots.txt').write_text('User-agent: *\nAllow: /\nSitemap: '+NEW_ORIGIN+'/sitemap.xml\n')
    (DIST/'_redirects').write_text('/j/privacy /j/privacy/ 301\n/en/j/privacy /en/j/privacy/ 301\n')
    print(json.dumps({'html_pages':len(paths),'output':str(DIST),'pdf_pages':48},ensure_ascii=False))

if __name__=='__main__':build()
