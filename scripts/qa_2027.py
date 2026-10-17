"""Check complete PDF coverage and lightweight copies against the originals."""
import json, subprocess, sys, re
from pathlib import Path
from lxml import html, etree
from PIL import Image
from languages import restore_document

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'site'
upload=Path(sys.argv[1])
render_check=Path(sys.argv[2])
docs=json.loads((ROOT/'source/idfc2027/documents.json').read_text())
errors=[];rows=[]
def compact(x):return re.sub(r'\s+','',x)
for source in docs:
    original=upload/source['original_filename']
    raw=subprocess.check_output(['pdftotext','-layout',str(original),'-'],text=True).split('\f')
    if not raw[-1].strip():raw.pop()
    page_file=DIST/source['route'].strip('/')/'index.html'
    doc=restore_document(html.fromstring(page_file.read_text()))
    blocks=doc.xpath('//*[@data-pdf-source]')
    if len(blocks)!=len(raw):errors.append({'source':source['slug'],'page_count':len(blocks),'expected':len(raw)})
    checked=[]
    for number,text in enumerate(raw,1):
        block=doc.xpath('//*[@data-pdf-page=$n]',n=str(number))
        if len(block)!=1:errors.append({'source':source['slug'],'page':number,'missing':True});continue
        written=block[0].xpath('.//*[@data-pdf-text]')[0].text_content()
        if written.strip()!=text.strip():errors.append({'source':source['slug'],'page':number,'text_diff':True})
        img=block[0].xpath('.//img')[0]
        path=DIST/img.get('src').lstrip('/')
        with Image.open(path) as im:im.verify()
        with Image.open(path) as im:
            if (im.width,im.height)!=(int(img.get('width')),int(img.get('height'))):errors.append({'source':source['slug'],'page':number,'image_dimensions':True})
        checked.append(number)
    pdf=DIST/source['pdf'].lstrip('/')
    copy=subprocess.check_output(['pdftotext','-layout',str(pdf),'-'],text=True)
    identical=compact(''.join(raw))==compact(copy)
    if not identical:errors.append({'source':source['slug'],'lightweight_pdf_text_diff':True})
    rows.append({'source':source['original_filename'],'pages':len(raw),'pages_checked':checked,'lightweight_pdf_bytes':pdf.stat().st_size,'pdf_text_matches_original':identical})

# Planning terms must remain readable in HTML, not just in downloads.
plan=restore_document(html.fromstring((DIST/'idfc2027/index.html').read_text())).xpath('//*[@id="conference-2027"]')[0].text_content()
expected=['2027年3月20日–26日','Bangkok','Mae Sot','Empowering Migrant Youths Through Resilience: Discovering Essential Skills In The Dynamic World','Including organizing committee members and support staffs from both countries.']
for phrase in expected:
    if phrase not in plan:errors.append({'conference_plan_missing':phrase})
plan_counts=html.parse(str(DIST/'idfc2027/index.html')).xpath('//*[@data-participant-plan="plan-2027"]')
if len(plan_counts)!=1 or plan_counts[0].get('data-participant-total')!='36' or plan_counts[0].xpath('.//*[@data-participant-count]/@data-participant-count')!=['18','18']:
    errors.append({'conference_plan_counts':'Expected total 36 with 18 from each country'})
images=0
for p in (DIST/'assets/idfc2027').rglob('*.webp'):
    with Image.open(p) as im:im.verify()
    images+=1
sitemap=etree.fromstring((DIST/'sitemap.xml').read_bytes())
if len(sitemap)!=len(list(DIST.rglob('*.html'))):errors.append({'sitemap_count':len(sitemap)})
rendered=json.loads(render_check.read_text())
result={'documents':rows,'pdf_pages_preserved':sum(r['pages'] for r in rows),'local_webp_images_checked':images,'lightweight_pdf_render_check':rendered,'errors':errors}
(ROOT/'reports/qa-2027.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({'pdf_pages_preserved':result['pdf_pages_preserved'],'documents':len(rows),'local_webp_images_checked':images,'errors':errors},ensure_ascii=False))
if errors:raise SystemExit(1)
