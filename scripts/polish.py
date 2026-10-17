"""Current presentation clean-up; historical content remains recoverable."""
from lxml import html, etree
from languages import remember

def arrange(current, node):
    if current == '/新規スポンサー様募集/':
        # The source remains in source/all-pages.json. The 2020 self-reported
        # totals, applicant rankings/wealth and sponsor guarantees lack records
        # that substantiate their use in the current public sponsorship page.
        for ident in (
            'cc-m-13847883823', 'cc-m-13847883923', 'cc-m-13847884023',
            'cc-m-13847885023', 'cc-m-13847885323',
        ):
            module = node.xpath('.//*[@id=$id]', id=ident)
            assert len(module) == 1, ident
            module[0].drop_tree()
        heading = node.xpath('.//*[@id="cc-m-header-13847883523"]')[0]
        remember(heading, 'text', '過去の活動写真')
        archive = etree.Element('details', {'class':'sponsor-archive'})
        etree.SubElement(archive, 'summary').text = 'これまでの協賛募集・ご支援の記録'
        etree.SubElement(archive, 'p', {'class':'context-note'}).text = '以下は過去の募集資料と活動写真です。参加費・募集人数・協賛条件は当時の記載です。現在のご支援条件は個別にご相談ください。'
        for child in list(node): archive.append(child)
        node.append(archive)
    if current != '/アドバイザー/': return
    for p in node.xpath('.//p'):
        if not p.text_content().strip() and not p.xpath('.//img|.//a[@id]'):p.drop_tree()
    matrix = node.xpath('./div[starts-with(@id,"cc-matrix")]')[0]
    grid = etree.Element('div', {'class':'advisor-cards'})
    for index, (module_id, link_id) in enumerate([
        ('cc-m-13347653723', 'cc-m-13347684023'),
        ('cc-m-13347659423', 'cc-m-13347698523'),
    ]):
        card = etree.SubElement(grid, 'article', {
            'class':'advisor-card',
            'id':'advisor-nemoto' if index == 0 else 'advisor-matsuda',
        })
        module = matrix.xpath('./*[@id=$id]', id=module_id)[0]
        for p in module.xpath('.//p'):
            if not p.text_content().strip(): p.drop_tree()
        paragraphs = module.xpath('.//p')
        paragraphs[0].set('class', 'advisor-name')
        paragraphs[1].set('class', 'advisor-affiliation')
        if index == 0:
            remember(paragraphs[0].xpath('.//span')[0], 'text', '根本 敬 名誉教授')
            remember(paragraphs[1].xpath('.//span/span')[0], 'text', '上智大学総合グローバル学部名誉教授・専門：ビルマ近現代史')
        card.append(module)
        card.append(matrix.xpath('./*[@id=$id]', id=link_id)[0])
    grid.append(html.fragment_fromstring('<article class="advisor-card advisor-khaing" id="advisor-khaing"><h2 class="advisor-name">ナンミャケーカイン 特別研究員</h2><p class="advisor-affiliation">京都精華大学特別研究員・ミャ日本教育センター所長</p></article>'))
    matrix.append(grid)

def public_copy(source):
    doc = html.document_fromstring(source)
    for p in doc.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," source-reference ")]'):
        p.drop_tree()
    for p in doc.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," source-note ")]'):
        text = p.text_content()
        if text.startswith('※') or text == '副代表・上野絆那':
            p.set('class', 'context-note')
        elif 'pie-note' in p.get('class',''):
            p.set('class', 'chart-note pie-note')
        else: p.drop_tree()
    for n in doc.xpath('//*[@id="source-notes"]|//a[contains(@href,"#source-notes")]/parent::li'):
        n.drop_tree()
    for link in doc.xpath('//a[contains(@href,"#source-notes")]'): link.drop_tree()
    return html.tostring(doc, encoding='unicode', method='html')
