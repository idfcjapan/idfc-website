"""Independent source-to-output checks and a reviewable migration report."""
import copy, json, re
from pathlib import Path
from collections import Counter
from urllib.parse import urljoin, urlsplit, unquote, quote
from html import escape
from lxml import html
from languages import restore_document

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'site'
RAW=json.loads((ROOT/'source/all-pages.json').read_text())
INV=json.loads((ROOT/'reports/inventory.json').read_text())
IMG=json.loads((ROOT/'reports/image-checks-final.json').read_text())
EXT=json.loads((ROOT/'reports/external-checks.json').read_text())
RETRY=json.loads((ROOT/'reports/external-retry.json').read_text())
NEW_ORIGIN='https://idfc-japan-myanmar.hannaowo.chatgpt.site'

def norm(x):return re.sub(r'\s+',' ',x).strip()
def route(x):
    p=unquote(urlsplit(x).path)
    return p.rstrip('/')+'/' if p!='/' else '/'
def canon_text(n):
    c=copy.deepcopy(n)
    for i in c.xpath('.//*[contains(@class,"__cf_email__")]'):
        a=i if i.tag=='a' else i.getparent();label=a.get('title','');b=i.get('data-cfemail','')
        if '@' in label:i.text=label
        elif b:
            try:
                key=int(b[:2],16);i.text=''.join(chr(int(b[j:j+2],16)^key) for j in range(2,len(b),2))
            except ValueError:pass
    return norm(''.join(c.itertext()))
def subset_loss(src,new):return list((Counter(src)-Counter(new)).elements())
def metadata(d):
    return [(n.get('name') or n.get('property'),n.get('content','')) for n in d.xpath('//head/meta[@name="description" or starts-with(@property,"og:") or starts-with(@name,"twitter:") or @name="robots"]')]
def expected_link(a,base):
    h=a.get('href','');u=urljoin(base,h);s=urlsplit(u)
    if h.startswith('javascript:'):return a.get('data-href')
    if '/cdn-cgi/l/email-protection' in h:return None
    if not h:return None
    if s.hostname=='idfc-jpn-mmr.jimdofree.com' and not s.path.startswith('/app/download/'):
        return route(u)+('?' + s.query if s.query else '')+('#'+s.fragment if s.fragment else '')
    return u

errors=[];rows=[];alllinks=0;allimgs=0;corechars=0
authorized_sponsor_withdrawals=[]
for p in RAW:
    current=route(p['url']);file=DIST/current.strip('/')/'index.html' if current!='/' else DIST/'index.html'
    d=html.fromstring(p['text']);original=d.xpath('//*[@id="content_area"]')[0]
    # The removed block is explicitly Jimdo advertising, not IDFC content.
    for block in original.xpath('.//*[@id="imprint"]'):block.drop_tree()
    new=restore_document(html.fromstring(file.read_text()));core=new.xpath('//*[@data-migrated="true"]')[0]
    if current=='/新規スポンサー様募集/':
        # Explicitly requested fact-check correction. Preserve the captured
        # source, and exclude only these five withdrawn public copy modules
        # from the otherwise exhaustive migration-preservation comparison.
        for ident in (
            'cc-m-13847883823', 'cc-m-13847883923', 'cc-m-13847884023',
            'cc-m-13847885023', 'cc-m-13847885323',
        ):
            found=original.xpath('.//*[@id=$id]',id=ident)
            assert len(found)==1, ident
            assert not core.xpath('.//*[@id=$id]',id=ident), ident+' still published'
            authorized_sponsor_withdrawals.append({'id':ident,'captured_text':canon_text(found[0])})
            found[0].drop_tree()
    source_paras=[canon_text(n) for n in original.xpath('.//p') if canon_text(n)]
    new_paras=[norm(''.join(n.itertext())) for n in core.xpath('.//p') if norm(''.join(n.itertext()))]
    paras_missing=subset_loss(source_paras,new_paras)
    source_heads=[canon_text(n) for n in original.xpath('.//h1|.//h2|.//h3|.//h4|.//h5|.//h6')]
    new_heads=[norm(''.join(n.itertext())) for n in new.xpath('//*[@id="main"]//h1|//*[@id="main"]//h2|//*[@id="main"]//h3|//*[@id="main"]//h4')]
    heads_missing=subset_loss(source_heads,new_heads)
    source_imgs=[(urljoin(p['url'],n.get('src','')),n.get('alt') or '') for n in original.xpath('.//img')]
    new_imgs=[(n.get('src'),n.get('alt') or '') for n in core.xpath('.//img')]
    imgs_missing=subset_loss(source_imgs,new_imgs)
    source_links=[u for a in original.xpath('.//a[@href]') if (u:=expected_link(a,p['url']))]
    new_links=[]
    for a in core.xpath('.//a[@href]'):
        u=a.get('href');parts=urlsplit(u)
        if not parts.scheme and not parts.netloc:
            absolute=urljoin(NEW_ORIGIN+current,u);parts=urlsplit(absolute)
            u=route(absolute)+('?' + parts.query if parts.query else '')+('#'+parts.fragment if parts.fragment else '')
        new_links.append(u)
    links_missing=subset_loss(source_links,new_links)
    # Heading/paragraph counters alone miss free text in div/span/table cells.
    # Compare each original visible leaf text node in its enclosing original module.
    text_missing=[]; module_count=0
    for module in original.xpath('.//*[starts-with(@id,"cc-m-")]'):
        cls=module.get('class','')
        if 'j-spacing' in cls or 'j-hgrid' in cls or 'cms-only'==module.get('data-display'):continue
        if not canon_text(module):continue
        ident=module.get('id');found=new.xpath('//*[@id=$id or @data-source-id=$id]',id=ident)
        if not found:text_missing.append({'id':ident,'text':canon_text(module)[:90]});continue
        module_count+=1
        if not any(canon_text(module)==norm(''.join(f.itertext())) for f in found):text_missing.append({'id':ident,'source':canon_text(module)[:140],'new':norm(''.join(found[0].itertext()))[:140]})
    old_meta=metadata(d);new_meta=metadata(new)
    expected_meta=[(k,NEW_ORIGIN+quote(current,safe='/') if k=='og:url' else v) for k,v in old_meta]
    # The user wants shares of the home URL to introduce the main IDFC column.
    if current=='/':
        about=html.fromstring(next(r['text'] for r in RAW if route(r['url'])=='/about-idfc/'))
        about_copy=about.xpath('//*[@id="content_area"]//div[contains(concat(" ",normalize-space(@class)," ")," j-text ")]')[0]
        intro=canon_text(about_copy.xpath('./p')[1])
        titles={'og:title','twitter:title'};descriptions={'description','og:description','twitter:description'}
        expected_meta=[(k,'IDFC日本ミャンマー学生会議' if k in titles else intro if k in descriptions else v) for k,v in expected_meta]
    meta_missing=subset_loss(expected_meta,new_meta)
    expected_title='IDFC日本ミャンマー学生会議' if current=='/' else d.findtext('.//title')
    title_ok=expected_title==new.findtext('.//title')
    seo_ok=not meta_missing and title_ok
    old_embeds=[n.get('src') for n in original.xpath('.//iframe')];new_embeds=[n.get('src') for n in core.xpath('.//iframe')]
    embed_missing=subset_loss(old_embeds,new_embeds)
    page_errors={k:v for k,v in {'paragraphs':paras_missing,'headings':heads_missing,'images':imgs_missing,'links':links_missing,'text_modules':text_missing,'metadata':meta_missing,'embeds':embed_missing}.items() if v}
    if not title_ok:page_errors['title']='不一致'
    if page_errors:errors.append({'page':current,'errors':page_errors})
    image_ok=all(any(r['url']==u and re.search(r'\d+×\d+',r.get('title','')) for r in IMG['results']) for u,_ in source_imgs)
    related=[]
    for err in RETRY.get('errors',[]):
        if err['url'] in source_links or err['url'] in old_embeds:related.append(err)
    rows.append({'source':p['url'],'page':current,'title':new.findtext('.//title'),'body':'完了' if not(paras_missing or heads_missing or text_missing) else '要確認','images':'完了' if not imgs_missing and image_ok else '要確認','links':'要確認' if related or links_missing or embed_missing else '完了','seo':'完了' if seo_ok else '要確認','notes':related,'paragraphs_source':len(source_paras),'paragraphs_new':len(new_paras),'headings_source':len(source_heads),'headings_new':len(new_heads),'images_source':len(source_imgs),'images_new':len(new_imgs),'links_source':len(source_links),'links_new':len(new_links),'text_modules_checked':module_count})
    corechars+=len(canon_text(original));allimgs+=len(source_imgs)

# Verify every local link, image, script, stylesheet and fragment across generated files.
local_errors=[];access_errors=[];local_count=0;forms=[]
for f in sorted(DIST.rglob('*.html')):
    d=html.fromstring(f.read_text());rel='/' if f==DIST/'index.html' else '/'+str(f.parent.relative_to(DIST))+'/'
    ids=[n.get('id') for n in d.xpath('//*[@id]')]
    duplicates=[x for x,c in Counter(ids).items() if c>1]
    if duplicates:access_errors.append({'page':rel,'duplicate_ids':duplicates})
    if len(d.xpath('//*[@id="main"]//h1'))!=1:access_errors.append({'page':rel,'h1':'1つではない'})
    if d.xpath('//img[not(@alt)]'):access_errors.append({'page':rel,'alt':'未設定'})
    for n in d.xpath('//iframe[not(@title)]'):access_errors.append({'page':rel,'iframe_title':'未設定'})
    for label in d.xpath('//label[@for]'):
        target=label.get('for')
        if not d.xpath('//*[@id=$id]',id=target):
            # Original privacy sentence labels a non-existent vendor-generated element.
            access_errors.append({'page':rel,'label_for':target})
    for n in d.xpath('//form'):
        forms.append({'page':rel,'disabled_submit':bool(n.xpath('.//input[@type="button" and @disabled]')),'required':[x.get('name') for x in n.xpath('.//*[@required]')],'note':bool(d.xpath('//*[@id="contact-note"]'))})
    for n in d.xpath('//a[@href]|//script[@src]|//link[@href]|//img[@src]'):
        href=n.get('href') or n.get('src');s=urlsplit(href)
        if s.scheme or s.netloc:continue
        target=unquote(s.path)
        if target in ('/edit/','/en/edit/'):
            # Authenticated editor is served by the Worker; separately integration-tested.
            local_count+=1
            continue
        tf=f if not target else DIST/target.strip('/') if target.startswith('/') else f.parent/target
        if tf.is_dir():tf=tf/'index.html'
        local_count+=1
        if not tf.exists():local_errors.append({'page':rel,'url':href,'reason':'ファイル未発見'});continue
        if s.fragment and tf.suffix=='.html':
            td=d if tf==f else html.fromstring(tf.read_text())
            if not td.xpath('//*[@id=$id]',id=unquote(s.fragment)):local_errors.append({'page':rel,'url':href,'reason':'アンカー未発見'})
    alllinks+=len(d.xpath('//a[@href]'))

summary={'pages_found':len(RAW),'pages_migrated':len(rows),'html_pages':len(list(DIST.rglob('*.html'))),'page_fetch_failures':0,'body_image_instances':allimgs,'unique_image_urls_with_header_and_ogp':len(IMG['results']),'body_text_characters_normalized':corechars,'local_references_checked':local_count,'all_anchor_instances':alllinks,'source_body_anchor_instances':len(INV['link_ledger']),'external_urls_checked':len(EXT['results'])+len(EXT['errors']),'external_404':sum(e.get('status')==404 for e in RETRY['errors']),'external_login_required':sum(e.get('error')=='login_required' for e in RETRY['errors']),'content_diff_errors':len(errors),'local_link_errors':len(local_errors),'accessibility_errors':len(access_errors),'visual_browser_qa':'未検証（この環境で必要なブラウザーQA機能が利用できない）','qa_widths_css': [375,390,768,1024,1440],'image_method':'元URL参照','forms':forms}
result={'summary':summary,'checklist':rows,'content_errors':errors,'local_errors':local_errors,'accessibility_errors':access_errors}
result['authorized_sponsor_copy_withdrawals']=authorized_sponsor_withdrawals
footer_reference=html.fromstring(RAW[0]['text']).xpath('//*[@data-container="sidebar"]')[0]
# The user explicitly requested removal of these redundant SNS UI labels.
# The official links and other footer text remain checked against source,
# with the user-requested removal of the retired email row.
footer_removed=[]
for ident,label,dest in [
    ('cc-m-15400648623','Facebook に接続する','https://www.facebook.com/idfc.myanmar.japan/'),
    ('cc-m-15400650423','X に接続する','https://x.com/mingalabar_idfc')]:
    module=footer_reference.xpath('.//*[@id=$id]',id=ident)
    assert len(module)==1 and canon_text(module[0])==label
    assert footer_reference.xpath('.//a[@href=$url]',url=dest)
    module[0].drop_tree()
    footer_removed.append({'id':ident,'redundant_label':label,'retained_url':dest})
retired_rows=[p for p in footer_reference.xpath('.//p') if 'idfc.jp.2016@gmail.com' in canon_text(p)]
assert len(retired_rows)==1 and canon_text(retired_rows[0])=='E-mail: idfc.jp.2016@gmail.com'
retired_rows[0].drop_tree()
for paragraph in footer_reference.xpath('.//p'):
    text=canon_text(paragraph)
    if '団体名：' in text or text in (
        '日本ミャンマー学生会議',
        '( International Development Field Camp',
        'for Myanmar and Japan Youth Leaders )',
    ):
        paragraph.drop_tree()
footer_text=canon_text(footer_reference)
footer_errors=[]
for f in sorted(DIST.rglob('*.html')):
    d=restore_document(html.fromstring(f.read_text()));ft=d.xpath('//*[@data-preserved-footer="true"]')
    if not ft or norm(''.join(ft[0].itertext()))!=footer_text:footer_errors.append(str(f.relative_to(DIST)))
    public_footer=html.fromstring(f.read_text()).xpath('//footer')[0].text_content()
    if any(label in public_footer for label in ('団体名：','IDFC日本側実行委員会','日本ミャンマー学生会議','International Development Field Camp for Myanmar and Japan Youth Leaders')):
        footer_errors.append(str(f.relative_to(DIST))+': removed organization name remains')
    for dest in [r['retained_url'] for r in footer_removed]+['https://www.instagram.com/idfc_2026_japan/']:
        if len(d.xpath('//footer//a[@href=$url]',url=dest))!=1:footer_errors.append(str(f.relative_to(DIST))+': SNS '+dest)
summary['common_footer_text_errors']=len(footer_errors)
result['footer_errors']=footer_errors
result['authorized_footer_deduplication']=footer_removed
result['authorized_retired_email_removal']=True
retired_email_pages=[str(f.relative_to(DIST)) for f in DIST.rglob('*.html') if 'idfc.jp.2016@gmail.com' in f.read_text()]
assert not retired_email_pages, retired_email_pages
summary['retired_email_occurrences']=0
(ROOT/'reports/qa.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(summary,ensure_ascii=False))
if errors or local_errors or access_errors or footer_errors:
    print(json.dumps({'content':errors,'links':local_errors,'a11y':access_errors,'footer':footer_errors},ensure_ascii=False,indent=2))
    raise SystemExit(1)
