"""Responsive views of the IDFC2026 photographs supplied by the site owner."""
import json
from pathlib import Path
from html import escape

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT/'source/idfc2026/photos.json').read_text())
PHOTOS = {photo['id']: photo for photo in DATA['photos']}
ROUTE = '/これまでの活動/idfc2026/'


def photo(ident, css_class='', priority=False, caption=None, sizes='(max-width:600px) 50vw, (max-width:900px) 45vw, 33vw'):
    item = PHOTOS[ident]
    label = caption or item['caption']['ja']
    loading = 'fetchpriority="high"' if priority else 'loading="lazy"'
    src = item['src'] if priority else item['preview']
    srcset = f'{item["preview"]} {item["preview_width"]}w, {item["src"]} {item["width"]}w'
    return f'''<figure class="event-photo {escape(css_class)}" data-photo-year="2026" data-photo-id="{escape(ident)}">
<a href="{escape(item['src'])}" data-lightbox="true" data-title="{escape(label)}" aria-label="写真を開く"><img src="{escape(src)}" srcset="{escape(srcset)}" sizes="{escape(sizes)}" alt="{escape(item['alt']['ja'])}" width="{item['width']}" height="{item['height']}" decoding="async" {loading}></a><figcaption>{escape(label)}</figcaption></figure>'''


def hero():
    return photo('group-outdoors', 'hero-photo', True, sizes='(max-width:900px) 90vw, 50vw')


def home_preview():
    return '<div class="home-photo-preview" role="region" aria-label="IDFC2026の写真" tabindex="0">'+''.join(
        photo(ident, sizes='(max-width:600px) 80vw, 33vw') for ident in DATA['home_preview'])+'</div>'+f'<a class="text-link photo-album-link" href="{ROUTE}#photos-2026">IDFC2026の写真をすべて見る →</a>'


def gallery():
    return '<section class="update-section" id="photos-2026"><h2>IDFC2026 活動写真</h2><p class="photo-album-hint">写真を押すと大きく表示できます。</p><div class="photo-album">'+''.join(photo(item['id']) for item in DATA['photos'])+'</div></section>'
