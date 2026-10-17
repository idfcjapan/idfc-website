"""Verify chart counts against captured documents, proportional SVG arcs and locales."""
import json
import math
import re
from pathlib import Path
from lxml import html

ROOT = Path(__file__).resolve().parents[1]
docs = {d['slug']: d for d in json.loads((ROOT/'source/idfc2027/documents.json').read_text())}
text = lambda slug, page: next(p['text'] for p in docs[slug]['pages'] if p['page'] == page)
assert 'Participants (10) + Committees (6)' in text('proposal', 6)
assert 'Participants (12) + Committees (5)' in text('proposal', 6)
assert '18 students from' in text('proposal', 17) and '36 participants in' in text('proposal', 17)
for phrase in ['女12', '男6', '文系13', '理系5', '関東11', '愛知（1名）', '富山（1名）', '大阪（3名）', '北米（2名）']:
    assert re.sub(r'\s+', '', phrase) in re.sub(r'\s+', '', text('brochure', 19)), phrase

expected = {
    'participants-2026': ('これまでの活動/idfc2026', [10, 12]),
    'committees-2026': ('これまでの活動/idfc2026', [6, 5]),
    'gender-2027': ('idfc2027/実行委員', [12, 6]),
    'study-2027': ('idfc2027/実行委員', [13, 5]),
    'region-2027': ('idfc2027/実行委員', [11, 1, 1, 3, 2]),
    'specialty-2027': ('idfc2027/実行委員', [6, 4, 4, 4]),
}
count = 0
for locale in ('ja', 'en'):
    for ident, (route, values) in expected.items():
        doc = html.parse(str(ROOT/'site'/('en' if locale == 'en' else '')/route/'index.html'))
        figure = doc.xpath('//*[@data-pie-chart=$ident]', ident=ident)
        assert len(figure) == 1, ident
        figure = figure[0]
        total = sum(values)
        assert int(figure.get('data-pie-total')) == total
        graphic = figure.xpath('.//*[local-name()="svg"]')[0]
        assert graphic.get('aria-hidden') == 'true' and graphic.get('focusable') == 'false'
        paths = graphic.xpath('./path')
        assert [int(p.get('data-pie-value')) for p in paths] == values
        legends = figure.xpath('.//ul[@class="pie-legend"]/li')
        assert len(legends) == len(values)
        for value, path, legend in zip(values, paths, legends):
            assert int(legend.xpath('.//strong')[0].text.strip()) == value
            assert legend.xpath('.//small')[0].text.strip() == f'{100*value/total:.1f}%'
            coords = [float(n) for n in re.findall(r'-?\d+(?:\.\d+)?', path.get('d'))]
            _, _, x1, y1, rx, ry, _, large, sweep, x2, y2 = coords
            assert rx == ry == 90 and sweep == 1 and large == int(value/total > .5)
            delta = (math.atan2(y2-100, x2-100)-math.atan2(y1-100, x1-100)) % math.tau
            assert math.isclose(delta/math.tau, value/total, abs_tol=1e-7)
            assert math.isclose(math.hypot(x1-100,y1-100), 90, abs_tol=1e-5)
            assert math.isclose(math.hypot(x2-100,y2-100), 90, abs_tol=1e-5)
        assert figure.xpath('.//figcaption/h3|.//figcaption/h4')[0].text.strip()
        if ident == 'specialty-2027':
            assert figure.xpath('.//p[contains(@class,"pie-note")]'), 'Combined counts must be explained'
        if route == 'idfc2027/実行委員':
            assert not doc.xpath('//*[@id="diversity-2027"]//*[@class="statistics-grid"]'), 'Duplicate member statistics remain'
        if route == 'これまでの活動/idfc2026':
            assert not doc.xpath('//*[@id="conference-overview-2026"]//table'), 'Duplicate participant table remains'
        count += 1

for prefix in ('', 'en/'):
    hub = html.parse(str(ROOT/'site'/prefix/'idfc2027/index.html'))
    plan = hub.xpath('//*[@data-participant-plan="plan-2027"]')
    assert len(plan) == 1 and plan[0].get('data-participant-total') == '36'
    assert plan[0].xpath('.//*[@data-participant-count]/@data-participant-count') == ['18', '18']
    assert not hub.xpath('//*[@data-pie-chart="plan-2027"]')
    assert not plan[0].xpath('.//svg'), 'The 18 + 18 plan uses direct number displays'
    previous = html.parse(str(ROOT/'site'/prefix/'これまでの活動/idfc2025/index.html'))
    current = html.parse(str(ROOT/'site'/prefix/'これまでの活動/idfc2026/index.html'))
    links = lambda d: d.xpath('//nav[@class="year-nav"]/a/@href')
    assert links(previous) == links(current)
    assert not current.xpath('//nav[@class="update-nav"]')
    assert current.xpath('//nav[@class="year-nav"]/a[@aria-current="page"]')[0].get('href').endswith('/idfc2026/')

result = {'result':'pass', 'charts_checked':count, 'participant_plans_checked':2, 'languages':['ja','en'],
          'counts_match_captured_documents':True, 'svg_proportions_verified':True,
          'accessible_text_breakdowns':True, 'year_navigation_matches':True,
          'rendering_browser_qa':False}
(ROOT/'reports/qa-charts.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
