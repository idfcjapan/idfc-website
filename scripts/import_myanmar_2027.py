"""Extract the supplied Myanmar department portraits without changing their content."""
import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'source/idfc2027/myanmar-departments'
DEST = ROOT/'site/assets/idfc2027/myanmar-departments'
DEST.mkdir(parents=True, exist_ok=True)
departments = json.loads((ROOT/'source/idfc2027/myanmar-members.json').read_text())
for original in SOURCE.glob('*.png'):
    shutil.copy2(original, DEST/original.name)
count = 0
for department in departments:
    with Image.open(SOURCE/f'{department["source_page"]}.png') as page:
        for member in department['members']:
            portrait = page.crop(tuple(member['bbox'])).convert('RGB')
            assert portrait.size == (member['width'], member['height'])
            portrait.save(ROOT/'site'/member['image'].lstrip('/'), 'WEBP', quality=94, method=6)
            count += 1
assert count == 14
print(json.dumps({'departments':len(departments), 'portraits':count, 'source_images':len(list(SOURCE.glob('*.png')))}))
