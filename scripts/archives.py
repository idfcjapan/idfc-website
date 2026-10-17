"""Present captured activities first and retain closed recruitment at the end."""
import re
from lxml import etree


RECRUITMENT_RANGES = {
    '/これまでの活動/idfc2023/': [
        ('cc-m-14836223823', 'cc-m-14823550223'),
        ('cc-m-14815304623', 'cc-m-14799353423'),
        ('cc-m-14811272923', None),
    ],
    '/これまでの活動/idfc2024/': [
        ('cc-m-15058852123', 'cc-m-15052977323'),
        ('cc-m-15025725923', 'cc-m-14978653123'),
    ],
    '/これまでの活動/idfc2025/': [
        ('cc-m-15292733423', 'cc-m-15282343623'),
        ('cc-m-15235503423', 'cc-m-15282690623'),
    ],
}


def arrange(current, cleaned):
    if current != '/これまでの活動/' and current not in RECRUITMENT_RANGES:
        return
    matrices = cleaned.xpath('./div[starts-with(@id,"cc-matrix-")]')
    assert len(matrices) == 1, 'Expected the captured archive content matrix'
    matrix = matrices[0]
    children = list(matrix)

    if current == '/これまでの活動/':
        blocks = {}
        block = None
        for child in children:
            headings = child.xpath('./h2')
            match = re.fullmatch(r'IDFC(20\d{2})', headings[0].text_content().strip()) if headings else None
            if match:
                block = blocks.setdefault(int(match.group(1)), [])
            assert block is not None, 'Archive module must belong to a year'
            block.append(child)
        assert set(blocks) == {2014, 2016, 2017, 2018}, 'Unexpected years in the early archive'
        for year in (2016, 2017, 2018):
            for child in blocks[year]:
                matrix.append(child)
        founding = etree.SubElement(matrix, 'section', {'class': 'founding-archive'})
        etree.SubElement(founding, 'p', {'class': 'archive-label'}).text = '設立時の活動'
        for child in blocks[2014]:
            founding.append(child)
        return

    ids = [child.get('id') for child in children]
    recruitment = []
    for start, end in RECRUITMENT_RANGES[current]:
        first = ids.index(start)
        last = ids.index(end) if end is not None else len(children)
        assert first < last, 'Recruitment content range must be ordered'
        recruitment.extend(children[first:last])
    assert len(set(recruitment)) == len(recruitment), 'Recruitment ranges must not overlap'
    past = etree.SubElement(matrix, 'section', {'id': 'past-recruitment', 'class': 'past-recruitment'})
    etree.SubElement(past, 'h2', {'id': 'past-recruitment-heading'}).text = '過去の募集要項'
    details = etree.SubElement(past, 'details')
    etree.SubElement(details, 'summary').text = '募集終了の募集要項を見る'
    body = etree.SubElement(details, 'div', {'class': 'past-recruitment-body'})
    etree.SubElement(body, 'p', {'class': 'archive-label'}).text = '掲載当時の募集情報です。現在は募集していません。'
    for child in recruitment:
        body.append(child)
