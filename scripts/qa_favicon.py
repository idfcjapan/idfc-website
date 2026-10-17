"""Verify the favicon preserves the original IDFC logo on a transparent background."""
import base64, hashlib, json
from pathlib import Path
from lxml import html, etree

ROOT=Path(__file__).resolve().parents[1]
capture=json.loads((ROOT/'source/all-pages.json').read_text())[0]['text']
logo=html.fromstring(capture).xpath('//*[@id="cc-website-logo"]//img')[0].get('src')
asset=ROOT/'site/assets/images/idfc-logo.svg'
expected='/assets/images/idfc-logo.svg?v='+hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
svg=etree.parse(str(asset))
ns={'svg':'http://www.w3.org/2000/svg'}
images=svg.xpath('/svg:svg/svg:image',namespaces=ns)
assert len(svg.getroot())==len(images)==1
assert {k:images[0].get(k) for k in ('x','y','width','height')}=={'x':'0','y':'32','width':'256','height':'192'}
embedded=images[0].get('{http://www.w3.org/1999/xlink}href')
assert embedded.startswith('data:image/png;base64,')
assert base64.b64decode(embedded.split(',',1)[1])==(ROOT/'source/branding/idfc-logo-original.png').read_bytes()
files=list((ROOT/'site').rglob('*.html'))
errors=[]
for file in files:
    document=html.parse(str(file))
    icons=document.xpath('//head/link[@rel="icon"]')
    headers=document.xpath('//header[@id="top"]//a[@class="brand"]/img')
    if len(icons)!=1 or icons[0].get('href')!=expected or icons[0].get('type')!='image/svg+xml' or len(headers)!=1 or headers[0].get('src')!=logo:
        errors.append(str(file.relative_to(ROOT/'site')))
assert len(files)==88
result={'pages_checked':len(files),'icon_contains_original_header_logo':not errors,
        'format':'SVG','background':'transparent','self_contained':True,
        'original_asset_preserved':True,'errors':errors,
        'rendering_browser_qa':False}
(ROOT/'reports/qa-favicon.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
if errors:raise SystemExit(1)
