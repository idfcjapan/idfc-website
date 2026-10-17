"""Run real site.js against generated HTML in a DOM adapter; no rendering browser."""
import json, subprocess
from pathlib import Path
from lxml import html

ROOT=Path(__file__).resolve().parents[1]
def tree(node):
    return {'tag':node.tag,'attrs':dict(node.attrib),'text':node.text or '',
            'children':[tree(n) for n in node if isinstance(n.tag,str)]}
files=sorted((ROOT/'site').rglob('*.html'))
routes=['/']+['/'+str(f.parent.relative_to(ROOT/'site'))+'/' for f in files if f!=ROOT/'site/index.html']
fixtures=[{'path':path,'tree':tree(html.parse(str(ROOT/'site'/path.strip('/')/'index.html')).getroot())} for path in routes]
payload={'script':(ROOT/'site/assets/js/site.js').read_text(),'fixtures':fixtures}
run=subprocess.run(['node',str(ROOT/'scripts/qa_interactions.mjs')],input=json.dumps(payload,ensure_ascii=False),text=True,capture_output=True)
if run.returncode:
    print(run.stdout,run.stderr)
    raise SystemExit(run.returncode)
result=json.loads(run.stdout)
css=(ROOT/'site/assets/css/site.css').read_text()
assert 'html:not(.js) .nav-level-0>li:hover>' in css
assert '.primary-nav{background:var(--paper)}' in css
assert '.js .primary-nav li.is-open>ul{display:block}' in css
assert '.js .primary-nav li>ul{display:none}' in css
assert 'body.menu-open{overflow:hidden}' not in css
assert 'max-height:var(--menu-height' in css and 'touch-action:pan-y pinch-zoom' in css
assert 'scroll-snap-type:x mandatory' in css and 'flex:0 0 100%' in css
home=html.parse(str(ROOT/'site/index.html'))
news_entries=json.loads((ROOT/'source/news.json').read_text())['entries']
assert len(home.xpath('//*[@id="news"]//article[contains(@class,"news-item")]'))==len(news_entries)
for path in routes:
    page=html.parse(str(ROOT/'site'/path.strip('/')/'index.html'))
    if not page.xpath('//*[@data-document-viewer]'):continue
    assert not page.xpath('//*[@data-pdf-source][@hidden or @inert or @aria-hidden]')
    assert page.xpath('//*[contains(@class,"document-controls")][@hidden]')
result.update({'static_ui_checks':'pass','rendering_browser_qa':False,'limitation':'DOM adapter tests interaction logic with simulated geometry; real rendering, CSS layout and touch gestures are not verified.'})
(ROOT/'reports/qa-ui.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
