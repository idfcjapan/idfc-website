"""Import the three user-supplied 2027 documents into the static Site.

Run with the upload directory and the reviewed extraction directory. Originals
are untouched; PDFs served by the Site are explicitly labelled lightweight copies.
"""
import hashlib, json, subprocess, sys, io
from pathlib import Path
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import NameObject, NumberObject

ROOT = Path(__file__).resolve().parents[1]
upload, reviewed = map(Path, sys.argv[1:3])
assets = ROOT/'site/assets/idfc2027'
source = ROOT/'source/idfc2027'
source.mkdir(parents=True, exist_ok=True)
assets.mkdir(parents=True, exist_ok=True)
documents = [
    ('overview', 'Paint Splodge Insta Post (1080 x 1440 px).pdf', '団体概要', '/idfc2027/資料/団体概要/', 10),
    ('proposal', 'IDFC 2027 Brand Proposal.pdf', 'IDFC 2027 Brand Proposal', '/idfc2027/資料/協賛提案/', 18),
    ('brochure', '新歓用IDFC2027団体パンフレット.pdf', '新歓用IDFC2027団体パンフレット', '/idfc2027/資料/新歓パンフレット/', 20),
]
result = []

def compress_pdf(original, output):
    # Keep the content streams, font encodings, QR vectors and annotations.
    # Compress only large raster XObjects, once per shared object.
    writer=PdfWriter(clone_from=original)
    seen=set()
    for page in writer.pages:
        for image in page.images:
            ref=image.indirect_reference
            if ref is None or ref.idnum in seen:continue
            seen.add(ref.idnum)
            obj=ref.get_object()
            if len(image.data)<100_000 or obj.get('/Filter')=='/DCTDecode':continue
            im=image.image.convert('RGB')
            if not obj.get('/SMask') and not obj.get('/Mask'):
                im.thumbnail((1800,1800))
            buf=io.BytesIO();im.save(buf,format='JPEG',quality=88,optimize=True)
            obj._data=buf.getvalue()
            obj[NameObject('/Filter')]=NameObject('/DCTDecode')
            obj[NameObject('/ColorSpace')]=NameObject('/DeviceRGB')
            obj[NameObject('/BitsPerComponent')]=NumberObject(8)
            obj[NameObject('/Width')]=NumberObject(im.width)
            obj[NameObject('/Height')]=NumberObject(im.height)
            for key in ['/DecodeParms','/Decode']:obj.pop(NameObject(key),None)
    # Canva exports contain shared ICC/font references; keep the complete
    # object graph rather than removing objects considered unreferenced.
    writer.write(output)

if '--pdf-only' in sys.argv:
    records=json.loads((source/'documents.json').read_text())
    for slug,name,label,route,count in documents:
        output=assets/f'{slug}.pdf'
        compress_pdf(upload/name,output)
        next(d for d in records if d['slug']==slug)['pdf_bytes']=output.stat().st_size
    (source/'documents.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
    print(json.dumps({d['slug']:d['pdf_bytes'] for d in records}))
    raise SystemExit(0)

for slug, name, label, route, count in documents:
    original = upload/name
    output = assets/f'{slug}.pdf'
    compress_pdf(original,output)
    # Poppler's layout extraction is more legible than character-by-character
    # pypdf extraction for the Japanese Canva typography.
    extracted = subprocess.check_output(['pdftotext','-layout',str(original),'-'],text=True)
    texts = extracted.split('\f')[:count]
    assert len(texts) == count
    pages=[]
    folder = assets/slug
    folder.mkdir(exist_ok=True)
    for i,text in enumerate(texts,1):
        jpg = reviewed/slug/f'page-{i:02d}.jpg'
        if not jpg.exists(): jpg=reviewed/slug/f'page-{i}.jpg'
        im=Image.open(jpg).convert('RGB')
        im.save(folder/f'page-{i:02d}.webp',quality=88,method=6)
        pages.append({'page':i,'text':text.strip(),'image':f'/assets/idfc2027/{slug}/page-{i:02d}.webp','width':im.width,'height':im.height})
    result.append({'slug':slug,'original_filename':name,'label':label,'route':route,
                   'pages':pages,'pdf':f'/assets/idfc2027/{slug}.pdf',
                   'original_sha256':hashlib.sha256(original.read_bytes()).hexdigest(),
                   'original_bytes':original.stat().st_size,'pdf_bytes':output.stat().st_size})

# Exact photographs extracted from the PDFs, reviewed before use.
selected={
 'group-2026':'overview-02-02', 'kazuki':'brochure-12-00',
 'ryota':'brochure-12-01','hanna':'brochure-13-00','yuka':'brochure-13-01',
 'waka':'brochure-14-00','hla':'brochure-14-01','sai':'brochure-14-03',
 'yua':'brochure-15-01','yu':'brochure-15-02','honoka':'brochure-16-00',
 'koji':'brochure-16-01','khin':'brochure-17-00','rika':'brochure-17-01',
 'ayu':'brochure-18-00','ayane':'brochure-18-01',
 'kazuki-greeting':'brochure-06-02','aleo-greeting':'brochure-07-02',
 'workshop':'brochure-08-03','discussion':'proposal-07-01',
 'panel':'proposal-08-02','fieldwork':'proposal-08-07',
 'culture':'proposal-07-05','aleo':'proposal-05-00',
 'win-war':'proposal-05-02','pyae-phyo-kyaw':'proposal-05-01',
 'sojitz':'overview-09-01','kokotel':'overview-09-02',
 'nogezaka':'overview-09-03','little-one':'overview-09-04',
}
for name,src in selected.items():
    im=Image.open(reviewed/'extracted'/f'{src}.png')
    im.thumbnail((1400,1400))
    filename='koji-portrait' if name=='koji' else name
    im.save(assets/f'{filename}.webp',quality=88,method=6)
    for record in result:
        if record['slug']==src.split('-')[0]:
            record.setdefault('extracted_images',[]).append({'name':name,'page':int(src.split('-')[1]),'image':f'/assets/idfc2027/{filename}.webp','width':im.width,'height':im.height})
(source/'documents.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({'documents':len(result),'pages':sum(len(x['pages']) for x in result),
                  'lightweight_pdf_bytes':{x['slug']:x['pdf_bytes'] for x in result}},ensure_ascii=False))
