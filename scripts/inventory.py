import json, re
from pathlib import Path
from urllib.parse import urljoin, urlsplit, unquote
from lxml import html

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://idfc-jpn-mmr.jimdofree.com'
PAGES = json.loads((ROOT/'source/all-pages.json').read_text())

def path_of(url):
    p = unquote(urlsplit(url).path)
    return '/j/privacy/' if p.rstrip('/') == '/j/privacy' else (p.rstrip('/')+'/' if p != '/' else '/')

def content(doc):
    return doc.xpath('//*[@id="content_area"]')[0]

def norm(text):
    return re.sub(r'\s+', ' ', text).strip()

def records(node, base):
    return {
        'headings': [{'level': n.tag, 'text': ''.join(n.itertext()), 'id': n.get('id')} for n in node.xpath('.//h1|.//h2|.//h3|.//h4|.//h5|.//h6')],
        'paragraphs': [''.join(n.itertext()) for n in node.xpath('.//p')],
        'lists': len(node.xpath('.//ul|.//ol')),
        'tables': len(node.xpath('.//table')),
        'text': ''.join(node.itertext()),
        'images': [{'url': urljoin(base,n.get('src','')), 'alt': n.get('alt'), 'srcset': n.get('srcset'), 'caption': n.get('data-subtitle'), 'id': n.get('id')} for n in node.xpath('.//img')],
        'links': [{'url': urljoin(base,n.get('href','')), 'original': n.get('href'), 'text': ''.join(n.itertext()), 'gallery_url': n.get('data-href')} for n in node.xpath('.//a[@href]')],
        'embeds': [{'url':n.get('src'), 'title':n.get('title')} for n in node.xpath('.//iframe')],
    }

nav_doc=html.fromstring(PAGES[0]['text'])
nav=nav_doc.xpath('//div[contains(@class,"jtpl-mobile-navigation")]//ul[contains(@class,"cc-nav-level-0")]')[0]
def nav_items(ul):
    out=[]
    for li in ul.xpath('./li'):
        a=li.xpath('./a')[0]; subs=li.xpath('./ul')
        out.append({'label':''.join(a.itertext()),'path':path_of(urljoin(ORIGIN,a.get('href'))),'children':nav_items(subs[0]) if subs else []})
    return out

images=[]; links=[]; inventory=[]
for idx,p in enumerate(PAGES):
    d=html.fromstring(p['text']); c=content(d); r=records(c,p['url'])
    metadata=[dict(n.attrib) for n in d.xpath('//head/meta[@name="description" or starts-with(@property,"og:") or starts-with(@name,"twitter:") or @name="robots"]')]
    row={'id':f'P{idx+1:03}', 'source_url':p['url'],'path':path_of(p['url']),'title':d.findtext('.//title'), 'retrieval':'取得済み', 'http_status':'取得サービスはHTTP状態を返さない', 'content':r, 'metadata':metadata}
    inventory.append(row)
    for n in d.xpath('//img'):
        if 'jimdo-logo' in n.get('src',''): continue
        images.append({'page':row['path'],'source_url':urljoin(p['url'],n.get('src','')),'alt':n.get('alt'),'srcset':n.get('srcset'),'new_url':urljoin(p['url'],n.get('src','')),'method':'元URL参照','verification':'未検証'})
    for n in d.xpath('//meta[@property="og:image"]'):
        images.append({'page':row['path'],'source_url':n.get('content'),'alt':None,'srcset':None,'new_url':n.get('content'),'method':'元URL参照（OGP／背景）','verification':'未検証'})
    for n in c.xpath('.//a[@href]'):
        u=urljoin(p['url'],n.get('href')); s=urlsplit(u)
        links.append({'page':row['path'],'original':n.get('href'),'url':u,'label':''.join(n.itertext()),'type':'internal' if s.hostname=='idfc-jpn-mmr.jimdofree.com' else 'external' if s.scheme in ('http','https') else s.scheme,'gallery_url':n.get('data-href'),'verification':'未検証'})

(ROOT/'reports').mkdir(exist_ok=True)
data={'pages':inventory,'navigation':nav_items(nav),'image_ledger':images,'link_ledger':links,'image_method':'元Jimdo URL参照。実行環境からのローカルダウンロードは403となったため。','source_origin':ORIGIN,'unique_pages':len(inventory)}
(ROOT/'reports/inventory.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
(ROOT/'reports/url-map.json').write_text(json.dumps([{'source_url':r['source_url'],'new_path':r['path'],'redirect_on_old_host':'301（旧ホストの管理設定が必要）'} for r in inventory]+[{'source_url':ORIGIN+'/j/privacy','new_path':'/j/privacy/','redirect_on_old_host':'301'}],ensure_ascii=False,indent=2))
print(json.dumps({'pages':len(inventory),'body_images':sum(len(r['content']['images']) for r in inventory),'images_with_common_and_ogp':len(images),'unique_image_urls':len(set(r['source_url'] for r in images)),'body_links':len(links),'headings':sum(len(r['content']['headings']) for r in inventory),'paragraphs':sum(len(r['content']['paragraphs']) for r in inventory)},ensure_ascii=False))
