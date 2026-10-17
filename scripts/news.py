"""Compact dated notices grouped by IDFC year, retaining verified source records."""
import copy
import json
from pathlib import Path
from html import escape
from lxml import html
from languages import SOURCE, inner_html, set_inner_html

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'source/news.json').read_text())
ENTRIES = sorted(DATA['entries'], key=lambda entry: entry['date'], reverse=True)
ARCHIVE_LABEL = '以前のお知らせを見る'
VISIBLE_PER_YEAR = 3


def collection_html():
    def notice(entry):
        date = entry['date'].replace('-', '.')
        text = escape(entry['summary'][0])
        if entry['links']:
            href = entry['links'][0][0]
            attrs = ' target="_blank" rel="noopener noreferrer"' if href.startswith('https://') else ''
            text = f'<a href="{escape(href)}"{attrs}>{text} <span aria-hidden="true">↗</span></a>'
        state = f'<span class="news-status">{escape(entry["status"])}</span>' if entry.get('status') else ''
        return f'<article class="news-item" id="news-{entry["id"]}" data-news-id="{entry["id"]}" data-news-edition="{entry["edition"]}" data-news-kind="{entry["kind"]}"><time datetime="{entry["date"]}" title="{escape(entry["date_kind"])}">{date}</time><p>{text}{state}</p></article>'

    groups = []
    for year in (2027, 2026, 2025):
        entries = [entry for entry in ENTRIES if entry['edition'] == year]
        latest = ''.join(notice(entry) for entry in entries[:VISIBLE_PER_YEAR])
        earlier = ''.join(notice(entry) for entry in entries[VISIBLE_PER_YEAR:])
        archive = f'<details class="news-archive"><summary>{ARCHIVE_LABEL}</summary>{earlier}</details>' if earlier else ''
        groups.append(f'<section class="news-year" aria-labelledby="news-year-{year}"><h3 id="news-year-{year}">IDFC{year}</h3>{latest}{archive}</section>')
    return '<div class="news-current">' + ''.join(groups) + '</div>'


def render_collection(source_module):
    """Retain the captured notice module for independent migration comparisons."""
    node = copy.deepcopy(source_module)
    originals = json.loads(node.get(SOURCE, '{}'))
    originals['html'] = inner_html(node)
    originals['class'] = node.get('class')
    node.set(SOURCE, json.dumps(originals, ensure_ascii=False, separators=(',', ':')))
    node.set('class', 'news-body')
    set_inner_html(node, collection_html())
    return html.tostring(node, encoding='unicode', method='html')


def translations():
    """Source strings and reviewed English equivalents used by the locale builder."""
    pairs = [
        (ARCHIVE_LABEL, 'Earlier notices'), ('掲載日', 'Published'),
        ('投稿日', 'Posted'), ('お知らせ日', 'Notice date'),
        ('募集終了', 'Applications closed'),
        ('過去の告知', 'Past announcement'),
        ('開催案内（過去の告知）', 'Original event announcement')]
    for entry in ENTRIES:
        pairs.append(tuple(entry['summary']))
        pairs.append(tuple(entry['title']))
        pairs.extend(tuple(pair) for pair in entry['paragraphs'])
        pairs.extend((ja, en) for href, ja, en in entry['links'])
    return pairs
