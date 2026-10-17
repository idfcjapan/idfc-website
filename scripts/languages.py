"""Build native Japanese and English pages while retaining recoverable source text."""
import copy
import hashlib
import json
import re
from pathlib import Path
from collections import Counter
from html import escape
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from lxml import html, etree
from contacts import EMAILS

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ('alt', 'title', 'aria-label', 'aria-roledescription', 'placeholder', 'data-title', 'data-subtitle')
SOURCE = 'data-i18n-source'
GENERATED = 'data-locale-generated'

def inner_html(node):
    return (escape(node.text) if node.text else '') + ''.join(html.tostring(child, encoding='unicode') for child in node)

def set_inner_html(node, value):
    fragment = html.fragment_fromstring('<div>' + value + '</div>')
    for child in list(node): node.remove(child)
    node.text = fragment.text
    for child in list(fragment): node.append(child)

def normalized(value):
    return re.sub(r'\s+', ' ', value or '').strip()

def key(value):
    return hashlib.sha256(normalized(value).encode()).hexdigest()[:16]

def content_value(value):
    value = normalized(value)
    return bool(value and re.search(r'[A-Za-z\u3040-\u30ff\u3400-\u9fff\u1000-\u109f]', value)
                and not re.fullmatch(r'(?:https?://|www\.)\S+', value)
                and not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", value))

def remember(node, field, value):
    previous = node.text if field == 'text' else node.tail if field == 'tail' else node.get(field)
    if previous == value:
        return
    originals = json.loads(node.get(SOURCE, '{}'))
    originals.setdefault(field, previous)
    node.set(SOURCE, json.dumps(originals, ensure_ascii=False, separators=(',', ':')))
    if field == 'text':
        node.text = value
    elif field == 'tail':
        node.tail = value
    elif value is None:
        node.attrib.pop(field, None)
    else:
        node.set(field, value)

def restore_document(document):
    """Independent QA can compare every translated node to its captured original."""
    result = copy.deepcopy(document)
    for node in list(result.xpath('//*[@data-locale-generated]')):
        if node.getparent() is not None:
            node.getparent().remove(node)
    # Replacing a paragraph's children must not invalidate traversal of later nodes.
    for node in list(result.iter()):
        if not isinstance(node.tag, str):
            continue
        for field, value in json.loads(node.get(SOURCE, '{}')).items():
            if field == 'text': node.text = value
            elif field == 'tail': node.tail = value
            elif field == 'html': set_inner_html(node, value)
            elif value is None: node.attrib.pop(field, None)
            else: node.set(field, value)
        node.attrib.pop(SOURCE, None)
    return result

def locale_path(path, locale):
    return '/en' + path if locale == 'en' else path

class Translations:
    def __init__(self):
        folder = ROOT / 'source/translations'
        self.catalog = {r['id']: r for r in json.loads((folder / 'catalog.json').read_text())}
        self.values = {}
        for filename in sorted(folder.glob('batch-*.json')):
            for ident, value in json.loads(filename.read_text()).items():
                if ident in self.values:
                    raise ValueError('Duplicate translation: ' + ident)
                self.values[ident] = value
        if (folder / 'overrides.json').exists():
            self.values.update(json.loads((folder / 'overrides.json').read_text()))
        missing = [ident for ident in self.catalog if not all(self.values.get(ident, {}).get(lang, '').strip() for lang in ('ja', 'en'))]
        if missing:
            raise ValueError(f'{len(missing)} incomplete translations: {missing[:12]}')
        self.paragraph_catalog = json.loads((folder / 'paragraph-catalog.json').read_text()) if (folder / 'paragraph-catalog.json').exists() else []
        self.paragraphs = {}
        for filename in sorted(folder.glob('paragraphs-*.json')):
            for ident, value in json.loads(filename.read_text()).items():
                if ident in self.paragraphs: raise ValueError('Duplicate paragraph: ' + ident)
                self.paragraphs[ident] = value['en_html']
        missing = [r['id'] for r in self.paragraph_catalog if not self.paragraphs.get(r['id'])]
        if missing: raise ValueError(f'{len(missing)} incomplete paragraph translations')
        for record in self.paragraph_catalog:
            fragment = html.fragment_fromstring('<div>' + self.paragraphs[record['id']] + '</div>')
            if Counter(fragment.xpath('.//a/@href')) != Counter(record['links']):
                raise ValueError('Paragraph links changed: ' + record['id'])
            if Counter(fragment.xpath('.//*[@id]/@id')) != Counter(record['ids']):
                raise ValueError('Paragraph anchors changed: ' + record['id'])
            if any(n.tag not in ('a','b','strong','em','i','u','span','br','s','small','sub','sup') or any(a.lower().startswith('on') for a in n.attrib) for n in fragment.iterdescendants()):
                raise ValueError('Unsupported paragraph markup: ' + record['id'])

    def text(self, source, locale, inline=False):
        ident = key(source)
        if ident not in self.values:
            return source
        target = self.values[ident][locale]
        if target == normalized(source):
            target = source
        else:
            left = re.match(r'^\s*', source).group()
            right = re.search(r'\s*$', source).group()
            target = left + target + right
        # Separate translated inline fragments, including nodes around emphasized names.
        if locale == 'en' and inline:
            target = ' ' + target.strip() + ' '
        return target

    def render(self, source, current, locale, origin, routes):
        doc = html.document_fromstring(source)
        if locale == 'ja':
            for paragraph in doc.xpath('//footer//p'):
                if normalized(paragraph.text_content()) != '( International Development Field Camp': continue
                continuation = paragraph.getnext()
                assert continuation is not None and normalized(continuation.text_content()) == 'for Myanmar and Japan Youth Leaders )'
                module = paragraph.getparent()
                originals = json.loads(module.get(SOURCE, '{}'))
                originals.setdefault('html', inner_html(module))
                module.set(SOURCE, json.dumps(originals, ensure_ascii=False, separators=(',', ':')))
                set_inner_html(paragraph, '<strong>International Development Field Camp for Myanmar and Japan Youth Leaders</strong>')
                paragraph.set('class', 'footer-organization')
                continuation.drop_tree()
        paragraph_sources = {node: (key(node.text_content()), inner_html(node)) for node in doc.xpath('//p') if key(node.text_content()) in self.paragraphs}
        for node in doc.iter():
            if not isinstance(node.tag, str):
                continue
            if node.tag not in ('script', 'style') and node.text:
                inline = node.tag != 'pre' and bool(node.xpath('ancestor::body'))
                remember(node, 'text', self.text(node.text, locale, inline))
            if node.tail:
                inline = not bool(node.xpath('ancestor::pre')) and bool(node.xpath('ancestor::body'))
                remember(node, 'tail', self.text(node.tail, locale, inline))
            for field in FIELDS:
                if node.get(field):
                    remember(node, field, self.text(node.get(field), locale))
            if node.tag == 'input' and node.get('type') in ('button', 'submit', 'reset') and node.get('value'):
                remember(node, 'value', self.text(node.get('value'), locale))
            if node.tag == 'meta' and (node.get('name') == 'description' or node.get('property') in ('og:title', 'og:description') or node.get('name') in ('twitter:title', 'twitter:description')):
                remember(node, 'content', self.text(node.get('content', ''), locale))
            if node.get('lang'):
                remember(node, 'lang', locale)
            if locale == 'en' and node.get('href'):
                parts = urlsplit(node.get('href'))
                if not parts.scheme and not parts.netloc and unquote(parts.path) in routes:
                    remember(node, 'href', urlunsplit(('', '', locale_path(unquote(parts.path), locale), parts.query, parts.fragment)))
        remember(doc, 'lang', locale)
        if locale == 'en':
            for node, (ident, original) in paragraph_sources.items():
                originals = json.loads(node.get(SOURCE, '{}'))
                originals['html'] = original
                node.set(SOURCE, json.dumps(originals, ensure_ascii=False, separators=(',', ':')))
                set_inner_html(node, self.paragraphs[ident])
                remember(node, 'data-i18n-block', ident)
                for link in node.xpath('.//a[@target="_blank"]'):
                    link.set('rel', 'noopener noreferrer')
        # Inquiry links, including links in older activity pages, follow the
        # page language. The footer keeps both explicitly labelled team links.
        for link in doc.xpath('//a[not(ancestor::footer) and (@data-contact-primary="true" or @href=$url)]', url='mailto:' + EMAILS['ja']):
            remember(link, 'href', 'mailto:' + EMAILS[locale])
            if normalized(link.text_content()) == EMAILS['ja']:
                remember(link, 'text', EMAILS[locale])
        canonical = origin + quote(locale_path(current, locale), safe='/')
        for node in doc.xpath('//link[@rel="canonical"]'):
            remember(node, 'href', canonical)
        for node in doc.xpath('//meta[@property="og:url"]'):
            remember(node, 'content', canonical)
        head = doc.find('head')
        for lang in ('ja', 'en', 'x-default'):
            etree.SubElement(head, 'link', {'rel': 'alternate', 'hreflang': lang, 'href': origin + quote(locale_path(current, 'en' if lang == 'en' else 'ja'), safe='/'), GENERATED: 'true'})
        row = doc.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " brand-row ")]')[0]
        switch = etree.Element('nav', {'class': 'language-switch', 'aria-label': '表示言語' if locale == 'ja' else 'Language', GENERATED: 'true'})
        for lang, label in (('ja', '日本語'), ('en', 'English')):
            attrs = {'href': locale_path(current, lang), 'lang': lang, 'hreflang': lang, 'data-language-link': lang}
            if lang == locale: attrs['aria-current'] = 'page'
            etree.SubElement(switch, 'a', attrs).text = label
        tools = row.xpath('./div[contains(concat(" ", normalize-space(@class), " "), " header-tools ")]')[0]
        tools.append(switch)
        return '<!doctype html>\n' + html.tostring(doc, encoding='unicode', method='html')
