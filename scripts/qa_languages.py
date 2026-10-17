"""Check complete locale pairs, visible translations, document readers and preserved content."""
import copy
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit
from lxml import html
from languages import Translations, restore_document, normalized, key, content_value, FIELDS, SOURCE, GENERATED, inner_html

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'site'
T = Translations()
document_sources = {d['slug']: {str(p['page']): p for p in d['pages']}
                    for d in json.loads((ROOT / 'source/idfc2027/documents.json').read_text())}
errors = []
checks = 0
used = set()
translated_nodes = 0
paragraphs = 0
document_pages = 0

def check(condition, label):
    global checks
    checks += 1
    if not condition: errors.append(label)

def signature(node):
    attrs = dict(node.attrib)
    for field in ('href','src'):
        if field in attrs:
            uri = urlsplit(attrs[field])
            attrs[field] = (uri.scheme,uri.netloc,unquote(uri.path),uri.query,unquote(uri.fragment))
    return (node.tag, sorted(attrs.items()), node.text, node.tail,
            [signature(child) for child in node if isinstance(child.tag, str)])

files = sorted(f for f in DIST.rglob('*.html') if f.relative_to(DIST).parts[0] != 'en')
routes = {'/' + f.parent.relative_to(DIST).as_posix().strip('./') + '/' for f in files}
routes.discard('//'); routes.add('/')
for file in files:
    relative = file.relative_to(DIST)
    current = '/' if relative == Path('index.html') else '/' + relative.parent.as_posix() + '/'
    english_file = DIST / 'en' / relative
    check(english_file.exists(), current + ': missing English page')
    if not english_file.exists(): continue
    ja = html.fromstring(file.read_text())
    en = html.fromstring(english_file.read_text())
    check(signature(restore_document(ja)) == signature(restore_document(en)), current + ': source reconstruction differs by language')
    for locale, doc in (('ja', ja), ('en', en)):
        route = current if locale == 'ja' else '/en' + current
        check(doc.get('lang') == locale, route + ': wrong HTML language')
        switches = doc.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," language-switch ")]//a')
        check(len(switches) == 2, route + ': wrong language button count')
        check([n.get('data-language-link') for n in switches if n.get('aria-current') == 'page'] == [locale], route + ': wrong active language')
        for link in switches:
            target = current if link.get('data-language-link') == 'ja' else '/en' + current
            check(unquote(urlsplit(link.get('href')).path) == target, route + ': switch changes page')
            check(link.get('lang') == link.get('hreflang') == link.get('data-language-link'), route + ': native language label')
        alternates = doc.xpath('//head/link[@rel="alternate"]')
        check({n.get('hreflang') for n in alternates} == {'ja', 'en', 'x-default'}, route + ': missing alternate language metadata')
        check(unquote(urlsplit(doc.xpath('//head/link[@rel="canonical"]')[0].get('href')).path) == route, route + ': canonical URL')
        original = restore_document(doc)
        original_nodes = list(original.iter())
        for node in original_nodes:
            if not isinstance(node.tag, str): continue
            if node.tag in ('script', 'style'): continue
            values = [(field, getattr(node, field)) for field in ('text', 'tail')]
            values += [(field, node.get(field)) for field in FIELDS]
            for field, source in values:
                if content_value(source):
                    check(key(source) in T.values, route + ': unregistered text ' + normalized(source)[:70])
                    used.add(key(source))
        for node in doc.xpath('//*[@data-i18n-source]'):
            if node.get('data-i18n-block'):
                ident = node.get('data-i18n-block')
                expected = html.fragment_fromstring('<p>' + T.paragraphs[ident] + '</p>')
                check(normalized(node.text_content()) == normalized(expected.text_content()), route + ': fluent paragraph text differs ' + ident)
                check(Counter(node.xpath('.//a/@href')) == Counter(expected.xpath('.//a/@href')), route + ': fluent paragraph links differ ' + ident)
                paragraphs += 1
                continue
            for field, source in json.loads(node.get(SOURCE)).items():
                if field in ('text', 'tail') or field in FIELDS or (node.tag == 'meta' and field == 'content') or (node.tag == 'input' and field == 'value'):
                    if source is None or key(source) not in T.values: continue
                    actual = getattr(node, field) if field in ('text', 'tail') else node.get(field)
                    check(normalized(actual) == normalized(T.values[key(source)][locale]), route + ': translation value differs ' + key(source))
                    translated_nodes += 1
        for page in doc.xpath('//*[@data-pdf-source]'):
            pre = page.xpath('.//*[@data-pdf-text]')[0]
            images = page.xpath('./a[contains(@class,"document-page-image")]')
            check(len(images) == 1 and not images[0].xpath('ancestor-or-self::*[@hidden]'), route + ': original page image is not the default view')
            source = document_sources[page.get('data-pdf-source')][page.get('data-pdf-page')]
            if len(images) == 1:
                image = images[0].xpath('./img')
                check(len(image) == 1 and image[0].get('src') == images[0].get('href') == source['image'], route + ': original image source differs')
                check(images[0].get('data-lightbox') == 'true', route + ': original image enlargement unavailable')
            check(not page.xpath('.//*[contains(@class,"document-page-translation") or contains(@class,"document-original-link")]'), route + ': text replacement remains')
            details = page.xpath('./details[contains(@class,"document-text")]')
            check(len(details) == 1 and not details[0].xpath('ancestor-or-self::*[@hidden]') and details[0].get('open') is None, route + ': optional text is not collapsed')
            check(pre.get('lang', locale) == locale, route + ': wrong reader language')
            document_pages += 1
        for node in doc.xpath('//body//*'):
            if node.tag in ('script', 'style') or node.xpath('ancestor-or-self::*[@hidden]'): continue
            for value in (node.text, node.tail):
                text = normalized(value)
                if locale == 'ja':
                    text = re.sub(r'https?://\S+|[\w.+-]+@[\w.-]+|www\.\S+', '', text)
                    if len(re.findall('[A-Za-z]+', text)) >= 4 and not re.search('[一-龯ぁ-んァ-ン]', text):
                        check(text in ('J-SAT Consulting Co., Ltd.', 'Fridtjof Detzner, Matthias Henze, Christian Springub'), route + ': English prose on Japanese page ' + text[:90])
                elif re.search('[ぁ-ん]', text) and len(re.findall('[ぁ-ん]', text)) > 12:
                    check(False, route + ': Japanese prose on English page ' + text[:90])
        for link in doc.xpath('//a[@href]'):
            if link.get('data-language-link'): continue
            parts = urlsplit(link.get('href'))
            if parts.scheme or parts.netloc or not parts.path: continue
            path = unquote(parts.path)
            if locale == 'en': check(path not in routes, route + ': internal link leaves English ' + path)
            else: check(not path.startswith('/en/'), route + ': internal link leaves Japanese ' + path)

check(len(files) == 44 and len(list(DIST.rglob('*.html'))) == 88, 'Expected 44 Japanese/English page pairs')
check(document_pages == 96, 'Expected original image readers for 48 PDF pages in each language')
for locale in ('ja','en'):
    plan = html.parse(str(DIST / ('en/' if locale == 'en' else '') / 'idfc2027/index.html')).xpath('//*[@id="conference-2027"]')[0].text_content()
    for number in ('2027','20','26','36','18'): check(number in plan, locale + ': conference plan lost ' + number)

result = {'result': 'pass' if not errors else 'fail', 'languages': ['ja','en'], 'page_pairs': len(files),
          'translation_records': len(T.catalog), 'fluent_paragraph_records': len(T.paragraphs),
          'fluent_paragraph_instances_checked': paragraphs, 'translated_node_values_checked': translated_nodes,
          'pdf_page_views_checked': document_pages, 'document_default_view': 'original page images',
          'assertions': checks, 'errors': errors,
          'rendering_browser_qa': False}
(ROOT / 'reports/qa-languages.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({**result, 'errors': errors[:20], 'error_count': len(errors)}, ensure_ascii=False))
if errors: raise SystemExit(1)
