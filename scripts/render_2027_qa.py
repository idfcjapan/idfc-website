"""Render lightweight PDFs and compare all pages to original PDF renders."""
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

root=Path(__file__).resolve().parents[1]
original_renders=Path(sys.argv[1])
target=original_renders/'compressed'
target.mkdir(exist_ok=True)
sources=json.loads((root/'source/idfc2027/documents.json').read_text())
results=[]
for d in sources:
    pdf=root/'site'/d['pdf'].lstrip('/')
    text=subprocess.check_output(['pdftotext','-layout',str(pdf),'-'],text=True)
    original=''.join(x['text'] for x in d['pages'])
    identical=''.join(original.split())==''.join(text.split())
    folder=target/d['slug'];folder.mkdir(exist_ok=True)
    process=subprocess.run(['pdftoppm','-scale-to','1400','-jpeg','-jpegopt','quality=85',str(pdf),str(folder/'page')],capture_output=True,text=True,check=True)
    diffs=[]
    for n in range(1,len(d['pages'])+1):
        name=f'page-{n:02d}.jpg'
        first=Image.open(original_renders/d['slug']/name).convert('RGB')
        second=Image.open(folder/name).convert('RGB')
        if first.size!=second.size:raise ValueError('Page dimensions changed')
        diffs.append(round(sum(ImageStat.Stat(ImageChops.difference(first,second)).mean)/3,2))
    record={'document':d['slug'],'pages':len(d['pages']),'text_matches':identical,
            'mean_pixel_difference_max':max(diffs),'mean_pixel_difference_by_page':diffs,
            'pdf_bytes':pdf.stat().st_size,'render_pages':len(list(folder.glob('page-*.jpg'))),
            'renderer_messages':process.stderr.strip()}
    results.append(record)
    print(json.dumps(record,ensure_ascii=False),flush=True)
(target/'qa.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
if any(not r['text_matches'] or r['mean_pixel_difference_max']>10 or r['renderer_messages'] for r in results):
    raise SystemExit('PDF verification failed')
