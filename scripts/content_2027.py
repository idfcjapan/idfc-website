"""2027 additions from the three supplied PDFs; historic source stays intact."""
import hashlib, json
from pathlib import Path
from html import escape as e
from urllib.parse import quote
from lxml import html
import photos_2026
import design
import pie_charts

ROOT=Path(__file__).resolve().parents[1]
ASSET_VERSION=hashlib.sha256(b''.join((ROOT/'site'/p).read_bytes() for p in ['assets/css/site.css','assets/js/site.js'])).hexdigest()[:12]
DOCUMENTS=json.loads((ROOT/'source/idfc2027/documents.json').read_text())
DOC={d['slug']:d for d in DOCUMENTS}
MYANMAR_DEPARTMENTS=json.loads((ROOT/'source/idfc2027/myanmar-members.json').read_text())
ASSET_DIMENSIONS={im['name']:(im['width'],im['height']) for d in DOCUMENTS for im in d.get('extracted_images',[])}
ASSET_IMAGES={im['name']:im['image'] for d in DOCUMENTS for im in d.get('extracted_images',[])}
SUPPORTER_LOGOS=json.loads((ROOT/'source/branding/supporter-logos.json').read_text())
ASSET_DIMENSIONS.update({key:(logo['width'],logo['height']) for key,logo in SUPPORTER_LOGOS.items()})
ASSET_IMAGES.update({key:logo['image'] for key,logo in SUPPORTER_LOGOS.items()})
for department in MYANMAR_DEPARTMENTS:
    for member in department['members']:
        ASSET_DIMENSIONS[member['photo']]=(member['width'],member['height'])
        ASSET_IMAGES[member['photo']]=member['image']
BASE='/idfc2027/'
HUB_ROUTES={BASE:'overview-2027',BASE+'活動/':'activities-2027',BASE+'実行委員/':'committee-2027',BASE+'資料/':'materials-2027'}
HUB_SECTIONS=[('overview-2027','IDFC2027'),('activities-2027','年間活動'),('committee-2027','運営幹部'),('japan-members-2027','日本側実行委員'),('myanmar-members-2027','ミャンマー側実行委員'),('materials-2027','資料'),('partners-2027','協賛・サポーター')]
THEME='Empowering Migrant Youths Through Resilience: Discovering Essential Skills In The Dynamic World'
INTRO='IDFC 2027 brings together bright young minds from Myanmar and Japan to learn, collaborate and co-create solutions for education challenges across borders and gaps.'
VISION='日緬の若者が国際協働を通じて互いに学び合い、両国を繋ぐ架け橋となる'
MISSION='主体的に学び、相互理解を深める場を提供することで、ミャンマーに関心を持つ人を増やし、社会課題に向き合い行動する人材を育む'
VALUES=['対等な協働と相互理解','学び続ける姿勢と多様性の受容','繋がりがずっと続く']
ROUTES={BASE:'IDFC2027',BASE+'活動/':'年間活動',BASE+'実行委員/':'運営幹部・代表挨拶',BASE+'資料/':'2027資料',
        '/これまでの活動/idfc2026/':'IDFC2026',**{d['route']:d['label'] for d in DOCUMENTS}}

def cite(slug,*pages):
    return ''

def paragraphs(*texts):return ''.join(f'<p>{e(t)}</p>' for t in texts)

def photo(name,alt,caption='',priority=False):
    attrs='fetchpriority="high"' if priority else 'loading="lazy"'
    w,h=ASSET_DIMENSIONS[name]
    return f'<figure class="document-photo"><img src="{e(ASSET_IMAGES[name])}" alt="{e(alt)}" width="{w}" height="{h}" {attrs} decoding="async">'+(f'<figcaption>{e(caption)}</figcaption>' if caption else '')+'</figure>'

def section(ident,title,body,source=''):
    return f'<section class="update-section" id="{e(ident)}"><h2>{e(title)}</h2>{body}{source}</section>'

def subnav(current):
    active=HUB_ROUTES.get(current,'materials-2027' if current.startswith(BASE+'資料/') else '')
    return '<nav class="update-nav year-section-nav" aria-label="IDFC2027">'+''.join(f'<a href="{e(BASE+"#"+ident)}" data-year-target="{ident}"'+(' aria-current="location"' if active==ident else '')+f'>{e(label)}</a>' for ident,label in HUB_SECTIONS)+'</nav>'

def year_hub(current,breadcrumbs):
    """The existing 2027 routes all retain the complete, anchor-linked hub."""
    bodies=[overview(),annual_activity(),committee(),japan_members(),myanmar_members(),resources(),supporters()+sponsorship_proposal()]
    chapters=[];groups=[]
    for (ident,label),body in zip(HUB_SECTIONS,bodies):
        fragment=html.fragment_fromstring('<div>'+body+'</div>')
        entries=[]
        for sec in fragment.xpath('./section[@id]'):
            heading=sec.find('h2')
            if heading is None:continue
            children=''
            profiles=sec.xpath('.//article[contains(concat(" ",normalize-space(@class)," ")," member-card ")]')
            if profiles:
                children='<ol class="toc-members">'+''.join(f'<li><a href="#{e(member.get("id"))}" data-toc-link>{e(member.find("h3").text_content())}</a></li>' for member in profiles)+'</ol>'
            entries.append(f'<li><a href="#{e(sec.get("id"))}" data-toc-link>{e(heading.text_content())}</a>{children}</li>')
        # The chapter heading is h2; preserve the remaining hierarchy below it.
        for heading in fragment.xpath('.//h2|.//h3|.//h4'):
            heading.tag='h'+str(int(heading.tag[1])+1)
        body=(e(fragment.text) if fragment.text else '')+''.join(html.tostring(child,encoding='unicode',method='html') for child in fragment)
        alias='<span id="members-2027" class="anchor-alias" aria-hidden="true"></span>' if ident=='japan-members-2027' else ''
        chapters.append(f'<section class="year-chapter" id="{ident}" data-year-section="{ident}" aria-labelledby="{ident}-title">{alias}<h2 class="year-chapter-title" id="{ident}-title">{e(label)}</h2>{body}</section>')
        groups.append(f'<li class="toc-group"><a href="#{ident}" data-toc-link data-year-target="{ident}">{e(label)}</a><ol>'+''.join(entries)+'</ol></li>')
    aside='<aside class="article-aside year-contents"><details open><summary>このページ</summary><nav aria-label="このページ"><ol>'+''.join(groups)+'</ol></nav></details></aside>'
    return f'<main id="main" class="current-page year-hub" data-year-hub data-initial-section="{HUB_ROUTES[current]}"><div class="wrap">{breadcrumbs(current,"IDFC2027")}<header class="page-masthead"><p class="eyebrow">International Development Field Camp</p><h1>IDFC2027</h1></header>{subnav(current)}<div class="article-layout with-aside"><article class="update-content">'+''.join(chapters)+f'</article>{aside}</div></div></main>'

def home_feature():
    return f'''<section class="home-2027 section wrap" aria-labelledby="home-2027-title">
<div class="home-2027-copy"><p class="eyebrow">International Development Field Camp</p><h2 id="home-2027-title">IDFC<span>2027</span></h2><p class="home-2027-theme" lang="en">{e(THEME)}</p><dl class="compact-facts"><div><dt>開催計画</dt><dd>2027年3月20日–26日</dd></div><div><dt>開催地</dt><dd>Bangkok / Mae Sot</dd></div></dl><p class="source-reference">Brand Proposal p.16–17に記載の計画</p><a class="button" href="/idfc2027/">IDFC2027について <span aria-hidden="true">↗</span></a></div>
<div class="home-2027-image">{photos_2026.photo('cultural-sharing',caption='写真：IDFC2026の文化交流',sizes='(max-width:900px) 90vw, 50vw')}<div class="update-shortcuts"><a href="/idfc2027/活動/">年間活動 →</a><a href="/idfc2027/実行委員/">運営幹部 →</a><a href="/idfc2027/資料/">2027資料 →</a></div></div></section>'''

def footer_update():
    return '<div class="footer-current"><a href="/idfc2027/">IDFC2027 ↗</a><a href="/edit/">編集</a></div>'

def footer_contacts():
    return '<section class="footer-contacts" data-locale-generated="true"><h2>メール</h2><p><strong>日本側のメール</strong><a href="mailto:idfc.japan@gmail.com" data-contact-region="japan">idfc.japan@gmail.com</a></p><p><strong>ミャンマー側のメール</strong><a href="mailto:idfc.myanmar@gmail.com" data-contact-region="myanmar">idfc.myanmar@gmail.com</a></p></section>'

TIMELINE=[
('2014','IDFC発足。日本とミャンマーの初の学生会議として、ヤンゴンでIDFCを初開催'),
('2016','“Community Development”を主題に、マンダレーで本会議を開催'),
('2017','“Beyond the Change”を掲げ、ヤンゴンで本会議を開催'),
('2018','ヤンゴンで本会議を開催し、初の成果物としてフリーペーパーを発行'),
('2019','“Seeking New Values”のもと、初の日本・ミャンマー両国開催を実施'),
('2020','京都・ヤンゴン・マンダレーの三都市で、本会議を開催'),
('2021','コロナ禍とクーデターの影響を受ける。海外開催が困難であったため、4回にわたるオンラインイベントを開催'),
('2022','“New Departure”を掲げ、3回のオンラインイベントを実施'),
('2023','大阪・東京で対面本会議を行い、議論の場を再構築'),
('2024','文化交流の対面企画を重ね、本会議では国内避難民問題を討議'),
('2025','日本在住のミャンマー人学生を招き、東京で日本・ミャンマー学生会議を開催'),
('2026','公開講演会の定期開催を開始。バンコクで6年振りとなる海外での本会議を開催。')]

def vision_block():
    return '<div class="values-layout"><div><p class="eyebrow">Vision</p>'+paragraphs(VISION)+'</div><div><p class="eyebrow">Mission</p>'+paragraphs(MISSION)+'</div><div><p class="eyebrow">Value</p><ol>'+''.join(f'<li>{e(x)}</li>' for x in VALUES)+'</ol></div></div>'

def overview():
    facts='<dl class="conference-facts"><div><dt>DATE / 開催計画</dt><dd>2027年3月20日–26日</dd></div><div><dt>LOCATION / 開催地</dt><dd>Bangkok<br>Mae Sot</dd></div><div><dt>PARTICIPANTS / 参加対象</dt><dd lang="en">High school students or university students from Japan or Myanmar</dd></div></dl>'
    goals='<div class="two-column"><div><h3>TARGET</h3><p lang="en">University-aged Myanmar migrants in Japan and Thailand who face barriers to accessing higher education.</p></div><div><h3>BRIEF PURPOSE AND INTENSION</h3><p lang="en">To explore challenges, co-design practical education pathways, and build cross-border collaboration that empowers Myanmar learners to access and succeed in higher education.</p></div></div>'
    participants='<p lang="en">Including organizing committee members and support staffs from both countries.</p><p class="source-note">人数はBrand Proposalの記載です。実行委員・サポートスタッフを含む内訳は要確認です。</p>'
    plan=section('conference-2027','IDFC2027 本会議の計画',f'<p class="conference-intro" lang="en">{e(INTRO)}</p>{facts}<h3>THEME</h3><p class="theme-statement" lang="en">“{e(THEME)}”</p>{goals}{participants}{pie_charts.plan_2027()}',cite('proposal',16,17))
    org=section('vision-2027','Vision / Mission / Value',vision_block(),cite('overview',5)+cite('brochure',4))
    stats='''<div class="impact-grid"><div><strong>12<span>回</span></strong><p>会議実施回数</p></div><div><strong>246<span>名以上</span></strong><p>日本側対面参加者数</p></div><div><strong>159<span>名以上</span></strong><p>ミャンマー側対面参加者数</p></div></div><p class="source-note">※参加者数は対面での参加者のうち確認できる人数。同一人物の複数回参加は重複計上している。日本側参加者数には、在日ミャンマー学生を含む。</p><div class="impact-grid secondary-impact"><div><strong>6<span>都市</span></strong><p>歴代開催都市</p></div><div><strong>441<span>名以上</span></strong><p>歴代参加者数（オンラインを含む）</p></div></div><p class="source-note">※本会議紹介ページの実施回数、参加者数はオンラインでのものを含む。</p><p>開催都市一覧（歴代）：ヤンゴン、マンダレー、東京、京都、大阪、バンコク</p>'''
    history=section('history-2027','これまでのIDFC', '<ol class="history-timeline">'+''.join(f'<li><span>{e(y)}</span><p>{e(t)}</p></li>' for y,t in TIMELINE)+'</ol>',cite('brochure',5))
    return f'<div class="conference-lead"><div><p class="eyebrow">日本ミャンマー学生会議</p><p class="large-copy">{e(VISION)}</p></div>{photo("group-2026","IDFC2026本会議の集合写真","写真：IDFC2026本会議",True)}</div>'+plan+org+section('impact-2027','実績（2014〜2026）',stats,cite('brochure',5,10)+cite('proposal',15))+history+section('more-2027','2027年度の活動とメンバー',f'<div class="resource-links"><a href="{BASE}活動/">1年間のIDFCでの活動 →</a><a href="{BASE}#committee-2027">代表挨拶・運営幹部 →</a><a href="{BASE}#japan-members-2027">日本側実行委員 →</a><a href="{BASE}#myanmar-members-2027">ミャンマー側実行委員 →</a><a href="/新規スポンサー様募集/#supporters-2027">協賛・サポーター →</a></div>')

ACTIVITY_INTRO='IDFCの活動は、本会議の開催だけにとどまりません。年間を通じて、講演会や勉強会、学校でのワークショップ、在日ミャンマー人との交流、情報発信など、さまざまな形で活動を重ねています。そうした取組を通じて、私たち自身がミャンマーへの理解を深めるだけでなく、団体の外にも学びや関心の輪を広げることを大切にしています。'
ACTIVITIES=[
('school','学校でのワークショップ','workshop',8,[
 'IDFCでは、学校でミャンマーについて知ってもらうためのワークショップも実施しています。特に地方での実施を重視しており、ミャンマーだけでなく、海外や大学といった環境にも触れる機会が限られがちな児童・学生に向けて活動を行っています。そうした場でワークショップを行うことは、ミャンマーを知ってもらうだけでなく、日本国内における都市と地方の情報格差という課題を考えることにもつながると考えています。',
 'ワークショップの内容は毎回、対象となる学年に応じて調整しています。学生が関心を持ちやすいよう、内容を工夫しながら授業を行うことで、ミャンマーという国を少しでも身近に感じてもらう機会をつくっています。']),
('lectures','公開講演会・勉強会','discussion',9,[
 'IDFCでは、日本国内でミャンマーへの関心と理解を広げることを目的に、講師を招いた公開講演会や団体内勉強会を継続的に実施しています。IDFC2026でも、ミャンマーの政治史、在日ミャンマー人社会、日本語教育、教育支援の現場などを扱い、計5回にわたって講演会・勉強会を開催しました。',
 '多様な視点から学ぶ機会を重ねることで、参加者にとって知識を深めるだけでなく、ミャンマーをより身近な存在として捉えるきっかけにもなっています。',
 'IDFC2027でも、こうした取組を引き続き大切にしていきます。私たち自身が学びを深めながら、日本国内のさまざまな人にミャンマーに関する知識や知見を共有する機会を広げていくことも、IDFCの大切な役割の一つだと考えています。']),
('communications','情報発信',None,9,[
 'IDFC2026では、Instagramでの投稿を中心に、ミャンマーの文化や社会について継続的に発信してきました。今後は、従来の投稿に加えてリールも積極的に活用し、より幅広い層に情報を届けていきたいと考えています。']),
('events','イベントの主催','culture',9,[
 'これまでIDFCでは、本会議以外にも一般参加者を対象とした交流イベントを実施してきました。',
 '日緬学生が一緒に旅のしおりを作るオンライン企画や、日本とミャンマーのカレーを協力して作り食文化を通じて交流する対面イベントを通じて、ミャンマーの文化や考え方に親しむきっかけづくりをしています。'])]
SCHEDULE=[('4〜5月','新旧メンバーが合流','一緒に仕事をしながら引き継ぎを実施'),('6月','新年度に正式移行','決起会の実施'),('6〜7月','日本側合宿を実施','学習を通して、仲間同士の友情を深める'),('8〜9月','文化イベントを主催','自らも体感しながら文化を伝える'),('10月','日本側プレ本会議','国内参加者やミャンマー留学生との間で議論を深めます'),('11月','学校でのワークショップを実施',''),('12〜2月','本会議のテーマに対する勉強会・講演会','勉強会・講演会を通して、会議への準備を万全にします'),('2〜3月','本会議を実施','現地のミャンマー学生と共に施策提言をします')]
CONFERENCE_COPY=[
 'IDFCの中心となる活動が、本会議です。本会議では、日本とミャンマーの学生が集まり、講義や議論、交流を通じて、互いの社会や文化、課題について学びを深めます。単に知識を得る場ではなく、学生同士が率直に意見を交わし、新たな視点や関係を築く場であることに大きな意義があります。IDFCは、この本会議を通じて、日緬の若者が学びながら、つながりを育むことを目指しています。',
 'また本会議は、提言して終わる場ではありません。IDFCでは通年で活動を続け、本会議で生まれた提言を検討し、実現につなげています。過去には、提言をもとにフリーペーパーを発行した例もあります。議論をその場限りで終わらせず、形にしていけることは、IDFCならではの特徴です。']

def annual_activity():
    result=section('year-round','1年間のIDFCでの活動',paragraphs(ACTIVITY_INTRO),cite('brochure',8))
    for ident,title,img,page,copy in ACTIVITIES:
        body='<div class="activity-copy">'+paragraphs(*copy)+'</div>'
        if img:body='<div class="activity-row">'+body+photo(img,title,'写真：提供資料に掲載の活動写真')+'</div>'
        result+=section(ident,title,body,cite('brochure',page))
    rows=''.join(f'<tr><th scope="row">{e(month)}</th><td>{e(task)}</td><td>{e(desc)}</td></tr>' for month,task,desc in SCHEDULE)
    result+=section('annual-schedule','年間スケジュール', '<p class="source-note">※あくまで一例であり、内容は毎年変更しています。</p><div class="table-scroll"><table><caption>年間の活動例</caption><thead><tr><th scope="col">時期</th><th scope="col">活動</th><th scope="col">内容</th></tr></thead><tbody>'+rows+'</tbody></table></div>',cite('brochure',8,9))
    result+=section('main-conference','IDFC本会議',paragraphs(*CONFERENCE_COPY)+'<a class="text-link" href="/これまでの活動/idfc2026/">IDFC2026本会議を見る →</a>',cite('brochure',10))
    result+=section('gatherings','懇親会',paragraphs('メンバーやOBの方と共に、不定期で食事会や合宿を行っています。他大学や先輩社会人の方と親睦を深めました。'),cite('overview',8))
    return result

GREETINGS=[
('kazuki','かずき','慶應義塾大学3年 IDFC日本代表','kazuki-greeting',6,[
 '2014年に発足したIDFCは、本年度で13年目を迎えます。',
 'IDFCは、ミャンマーの民政移管と日緬国交樹立60周年を機に設立されました。しかし、当時と今とでは、日緬交流を取り巻く状況は一変しました。新型コロナウイルス感染拡大による移動制限や、ミャンマー情勢の変化により、それまで積み重ねてきた交流が途絶えた時期もありました。',
 'IDFCは、そのような中でも、日本とミャンマーをつなぐ学生間交流を絶やさぬよう模索を重ねてまいりました。オンラインイベントの実施から始め、在日ミャンマー人学生、高校生へと参加対象を広げることで、少しずつ活動の広がりを取り戻してきました。',
 'そして昨年度は、悲願であった6年ぶりの海外での本会議開催を実現するため、実行委員が一丸となって準備を進めてまいりました。OB・OGの皆様からも多大なご支援とご指導を賜り、その積み重ねの末に、タイ・バンコクでの会議開催に至りました。',
 '本年度は、現地団体の立ち上げにも取り組む重要な節目の年です。これまで築いてきた交流を土台としながら、新たなつながりと学びの機会をさらに広げていきたいと考えております。IDFC2027では、東南アジア地域においてミャンマー側団体の立ち上げを進めるとともに、日本国内でも講演会、在日ミャンマー人との交流、情報発信を重ねることで、IDFCのビジョンである「日緬の若者が国際協働を通じて互いに学び合い、両国をつなぐ架け橋となる」ことの実現を目指してまいります。その責任の重さを、私自身あらためて強く感じています。',
 '私が考えるIDFCの意義は、支援や難民といった問題でミャンマーを捉えるのではなく、社会や文化、人々の営みに目を向け、日本とミャンマーの学生が相互理解を深めてきた点にあります。民政移管の時代に、アジア最後のフロンティアとも呼ばれ、明るい未来への期待の中で歩み始めた団体であるからこそ、改めて、その原点に立ち返る意味があると考えています。',
 '学生という立場だからこそ生まれる率直な対話と交流を通じて、新たな関係を育み、その積み重ねを将来の日緬関係の発展へとつなげていきたいと考えております。']),
('aleo','Aleo','チュラロンコン大学 IDFCミャンマー代表','aleo-greeting',7,[
 'ミャンマー側にとって、IDFCの団体としての本格的な再始動は、2022年以来の大きな節目となります。ミャンマー側IDFCが、今年度より再び歩みを進めることができることを、強い責任感とともに大変嬉しく思っています。',
 '現時点では、ミャンマー本国で会議を開催することは困難であり、悔しさもあります。その一方で、今回は世界各地に留学・居住しているミャンマー人学生ともつながることができる可能性があります。これまでとは異なる形で、より広いミャンマー人学生のネットワークを築く新たな機会になると考えています。',
 '近年、日本で学び、働くことを志すミャンマー人は増えており、日本への関心は学生の間でも高まっています。日緬の学生がつながることで、新たな学びや気づき、将来につながる関係が生まれると信じています。IDFC2027が、その第一歩となることを願っています。',
 'タイで本会議を開催しようという発想は、私自身がタイでの留学中に、多くのミャンマー学生と出会ったことが始まりでした。隣国でミャンマーの現状と向き合いながら懸命に学び、未来を切り拓こうとする学生達に接した経験は、私がIDFCに関わるきっかけとなりました。昨年度は、友人に声をかけることから始まり、日緬の双方で議論と準備を重ね、無事に会議開催へとつなげることができました。今年度は、会議参加者を中心にミャンマー側団体が自ら動き始める重要な年であると考えています。その実現は容易ではありませんが、IDFC全体で支えながら、自走に向けて取り組んでまいります。',
 'また今年度は、かつてご支援をいただいていた双日国際交流財団様より、再び助成を賜ることとなりました。複雑な情勢の中でも、私たちの活動の意義を認めて戴けたことに、深く感謝しております。今後活動をさらに広げていくためには、継続的な支援と基盤強化が欠かせません。いただいた助成を大切に活かしながら、より充実した活動へとつなげてまいります。'])]

# Name, role, affiliation, page, original profile fields. Other quotations,
# reasons for joining and peer comments remain available on every source page.
MEMBERS=[
('kazuki','かずき','代表','慶應義塾大学3年 / 経済学部経済学科',12,['徳島県出身。','好きな料理：シュクメルリ、カレー','特技：プロ野球の応援歌を大体歌える','苦手なこと：折り鶴。作れたことがない']),
('ryota','りょうた','会計','東京大学3年 / 薬学部',12,['埼玉県出身。','自分を動物に例えると：温和な蛇','好きなタイ料理：หมูกระทะ (ムーカタ)','苦手なこと：年上との日本語での会話']),
('hanna','はんな','副代表 / 広報&リサーチ','Orange College 2年 / Economics',13,['東京都出身。','休みの日に行くところ：カフェ巡り','隠れた特技：ゲームが得意','口癖：うち(一人称)']),
('yuka','ゆうか','副代表 / 日本渉外 / ミャンマー渉外','大阪大学4年 / 外国語学部外国語学科',13,['岡山県出身。','好きな海外料理：マンサフ','地元の自慢：美観地区','直したい癖：バイトの過剰シフト申請']),
('waka','わか','広報&リサーチ','龍谷大学2年 / 政策学部政策学科',14,['大阪府出身。','自分の一字：和','宝物：友達からもらった手紙','よく使う絵文字：🙇‍♀️']),
('hla','HLA（ラー）','広報&リサーチ','筑波大学3年 / 芸術専門学群 建築デザイン領域',14,['ミャンマー出身。','好きな日本料理：うどん','集めたい物：ない、好きな物だけ持つ','人生の映画：FROZEN']),
('sai','サイ','広報&リサーチ','日本大学2年 / 商学部',14,['ミャンマー・ミッチーナ出身。','お金が貯まったらすること：旅行','休みの日にすること：カフェ巡り','最近ハマっていること：音楽きく']),
('yua','ゆうあ','広報&リサーチ','富山大学2年 / 医学部医学科',15,['長野県出身。','好きな本：ハリー・ポッターシリーズ','海外で驚いたこと：会話に必要なのはpassion','今年の抱負：人生の糧になることを学び成長']),
('yu','ゆう / Yu Nakayama','広報&リサーチ / 企画','獨協大学3年 / 経済学部 経営学科',15,['静岡県出身。','地元の自慢：富士山が近い、川の水が飲める','欲しい超能力：この世の全ての金属を操る','最近の失敗：タイで調子乗り過ぎて風邪引く']),
('koji','こじ','日本渉外','東海大学4年 / 医学部医学科',16,['東京都出身。','好きな曲：EVER, UVERworld','弱点：寝不足に弱い','一番怒った時：繋がらないWi-Fi']),
('honoka','ほのか','日本渉外','上智大学2年 / 総合グローバル学部総合グローバル学科',16,['岐阜県出身。','好きな日本文化：書道','寝る前の習慣：オキニのブランケット探し','嫌いな飲み物：ルートビア']),
('rika','リカ','ミャンマー渉外 / 広報&リサーチ','東洋大学2年 / 国際学部グローバルイノベーション学科',17,['ミャンマー・エーヤワディー出身。','日本の好きな都市：富山市','子ども頃の夢：女優さん','苦手な日本の食べ物：たくさんのわさび']),
('khin','キン','ミャンマー渉外','筑波大学2年 / 国際社会学群',17,['ミャンマー・カチン出身。','好きなミャンマーの曲：ချို့','欲しい才能：間食を欲さない能力','将来の夢：国際機関で働きたい']),
('ayu','あゆ','企画','名古屋大学4年 / 医学部保健学科理学療法学専攻',18,['愛知県出身。','機嫌の取り方：おいしいものを食べる','苦手な教科：暗記科目','口ぐせ：間違いない']),
('ayane','あやね','企画 / 日本渉外','早稲田大学4年 / 法学部',18,['埼玉県出身。','宝物：トラのぬいぐるみ','実は〇〇派：カラオケは昭和歌謡','黒歴史：センターを張ったお遊戯会'])]

EXECUTIVE_TEAM=[('aleo','Aleo','President / Myanmar'),('win-war','Win War','Vice-President / Myanmar'),('pyae-phyo-kyaw','Pyae Phyo Kyaw','Vice-President / Myanmar'),('kazuki','Hemmi Kazuki','President / Japan'),('hanna','Ueno Hanna','Vice-President / Japan'),('yuka','Kokubu Yuka','Vice-President / Japan')]


def committee():
    greetings=''
    for ident,name,affiliation,img,page,copy in GREETINGS:
        side='日本側' if ident=='kazuki' else 'ミャンマー側'
        title=name+' / '+side+'IDFC代表挨拶'
        greetings+=section('greeting-'+ident,title,'<div class="greeting-layout"><div class="greeting-portrait">'+photo(img,name)+f'<p>{e(affiliation)}</p></div><div class="greeting-copy">'+paragraphs(*copy)+'</div></div>',cite('brochure',page))
    team='<div class="executive-grid">'+''.join('<article>'+photo('myanmar-'+img if role.endswith(' / Myanmar') else img,name)+f'<h3>{e(name)}</h3><p>{e(role)}</p></article>' for img,name,role in EXECUTIVE_TEAM)+'</div><p class="source-note">Brand Proposal p.5の役職・表記を掲載しています。</p>'
    return greetings+section('executive-team','2027年運営幹部の組織体制',team,cite('proposal',5))


def japan_members():
    # The brochure profiles belong to the Japan-based organizing team.
    # Membership is grouped by IDFC side, regardless of a member's birthplace.
    japan_cards=''
    for img,name,role,affiliation,page,fields in MEMBERS:
        japan_cards+=f'<article class="member-card" id="member-{e(img)}">'+photo(img,name)+f'<p class="member-role">{e(role)}</p><h3>{e(name)}</h3><p class="member-affiliation">{e(affiliation)}</p><ul>'+''.join(f'<li>{e(x)}</li>' for x in fields)+f'</ul><a class="member-source" href="{e(DOC["brochure"]["route"])}#page-{page}">入会の理由・紹介コメントを読む →</a></article>'
    japan=section('japan-team-2027','実行委員紹介','<p class="source-note">所属・学年・役職は2027パンフレット掲載時の表記です。紹介コメントと入会の理由は各資料ページで全文を確認できます。</p><div class="member-grid">'+japan_cards+'</div>',cite('brochure',12,13,14,15,16,17,18))
    statistics=paragraphs('IDFCは多様性に溢れた団体です！','国際系の学生団体というと、文系であったり、国際系の学生ばかりと思うかもしれません。しかし、IDFCでは文系だけでなく、医薬系や建築系の学生も所属しており、さまざまな分野の知見を深めている学生と出会うこともできます✨。また、地方や海外など、様々な地域の学生が一緒に活動しています。')+'<p class="source-note">副代表・上野絆那</p><p class="source-note">人数はパンフレットp.19の表記です。他資料の人数との対象・基準日は要確認です。</p>'
    return japan+section('diversity-2027','Statistics / 実行委員の多様性',statistics+pie_charts.diversity(),cite('brochure',19))


def myanmar_members():
    result=''
    for department in MYANMAR_DEPARTMENTS:
        cards=''.join(f'<article class="member-card" id="member-{e(member["id"])}">'+photo(member['photo'],member['name'])+f'<p class="member-role">{e(member["role"])}</p><h3>{e(member["name"])}</h3></article>' for member in department['members'])
        source=f'<p class="source-reference">出典：IDFC2027 ミャンマー側実行委員資料 <a href="{e(department["source"])}">{e(department["source_title"])}</a></p>'
        result+=section(department['id'],department['title'],'<div class="member-grid myanmar-member-grid">'+cards+'</div>',source)
    return result


def supporter_groups():
    groups=[('助成','supporter-grants',[('公益財団法人 三菱UFJ国際財団','mufg-foundation'),('公益財団法人 双日国際交流財団','sojitz')]),('協賛','supporter-sponsors',[('kokotel','kokotel'),('Little One','little-one')]),('後援','supporter-endorsements',[('野毛坂グローカル','nogezaka')])]
    body='<div class="supporter-groups">'
    for title,group_class,entries in groups:
        body+=f'<section class="supporter-group {group_class}"><h3>{e(title)}</h3><div class="supporter-cards">'
        for name,img in entries:
            width,height=ASSET_DIMENSIONS[img]
            image=f'<img src="{e(ASSET_IMAGES[img])}" alt="" width="{width}" height="{height}" loading="lazy" decoding="async">'
            if img=='mufg-foundation':
                image=f'<span class="foundation-logo-panel">{image}</span>'
            logo=f'<div class="supporter-logo">{image}</div>'
            body+=f'<article class="supporter-entry">{logo}<p>{e(name)}</p></article>'
        body+='</div></section>'
    return body+'</div>'

def home_supporters():
    return '<section class="home-supporters section wrap" aria-labelledby="home-supporters-title"><div class="section-heading"><h2 id="home-supporters-title">協賛・サポーター</h2><a class="text-link" href="/新規スポンサー様募集/">ご支援について →</a></div><p class="supporter-intro">IDFC2027の活動をご支援いただいている皆さま</p>'+supporter_groups()+'</section>'

def supporters():
    body=supporter_groups()
    body+=paragraphs('IDFCでは、日本とミャンマーの学生の交流と学びを支える企業・団体の皆さまを募集しています。', 'ロゴ掲載やイベントへの参加など、ご支援に伴う連携内容・費用・参加条件は、開催年度と企画に応じて個別にご相談ください。')+'<a class="button" href="mailto:idfc.japan@gmail.com" data-contact-primary="true">メールでお問い合わせ ↗</a>'
    return section('supporters-2027','IDFC2027 協賛・サポーター',body)

def sponsorship_proposal():
    about='International Development Field Camp for Myanmar and Japan Youth Leaders (IDFC) is a voluntary, non-incorporated organization serving as the organizing body of the annual Japan-Myanmar Student Conference. Established in 2014, marking the 60th anniversary of diplomatic relations between Japan and Myanmar, IDFC provides a youth-led platform that connects students from both nations to tackle shared social challenges, build mutual trust, and develop regional solutions.'
    missions=["Cultural Sharing: Facilitate direct, multi-faceted understanding of each nation's traditional and modern youth cultures to broaden individual mindsets.", 'Mutual Learning: Teach methodology for social problem-solving, exchange knowledge, and empower next-generation youth leaders.', 'Shared Social Concern: Enable delegates to identify common social interests, problem awareness, and mutual goals beyond borders.', 'Collaborative Action: Engage delegates in co-creating innovative solutions to real-world challenges through field research, workshops, and public symposia.', 'Sustainable Network Building: Cultivate long-term human networks across students, alumni, universities, NPOs, and corporate partners.']
    values=['Youth-Led Leadership: Driving grassroots initiative and autonomy.','Cross-Cultural Respect: Valuing diverse perspectives through open dialogue.','Field-Oriented Action: Grounding solutions in direct local observation and interaction.','Long-Term Partnership: Building enduring bilateral trust.']
    body='<div lang="en"><h3>What is IDFC?</h3>'+paragraphs(about)+'<h3>ORGANIZATION AT A GLANCE</h3><ul><li>Full Name : International Development Field Camp (IDFC)</li><li>Org Type : Voluntary, Non-Incorporated Student Conference Body</li><li>Established : 2014 (60th Anniversary of Japan-Myanmar Relations)</li><li>Core Body : Executive Committee Members (Japan &amp; Myanmar)</li></ul><h3>Our Vision</h3>'+paragraphs('"Create an opportunity for exchanging ideas between the youths of Myanmar and Japan, constructing sustainable relationships that continues for mutual future profit."')+'<h3>Our 5 Core Missions</h3><ul>'+''.join(f'<li>{e(x)}</li>' for x in missions)+'</ul><h3>Core Values</h3><ul>'+''.join(f'<li>{e(x)}</li>' for x in values)+'</ul></div><div class="resource-links"><a href="/idfc2027/">2027本会議の計画 →</a><a href="/idfc2027/資料/協賛提案/">Brand Proposal 全18ページを読む →</a><a href="/assets/idfc2027/proposal.pdf" download>Brand Proposal PDF（軽量版） ↓</a></div>'
    return section('brand-proposal-2027','Brand Sponsorship Proposal 2027',body,cite('proposal',2,3))

SOURCE_NOTES=[
('連絡先メール','2027パンフレット p.3・20：idfc.japan@gmail.com / 団体概要 p.10：idfc-japan@gmail.com / Brand Proposal p.18：idfc.myanmar@gmial.com','日本側メールのドット・ハイフン表記と、ミャンマー側メールの「gmial.com」は要確認。ここでは訂正せず、各資料の表記を保存しています。'),
('SNS','団体概要 p.10：Instagram「idfc_japan」、Facebook「idfc_2026_japan」/ Brand Proposal p.18：Instagram「idfc_myanmar」','既存サイトのSNSと異なる表記があります。アカウント名・QRコードの遷移先は要確認です。'),
('実行委員・メンバー人数','団体概要 p.3：16人（2026年5月現在）/ Brand Proposal p.5：14 dedicated student leaders / 2027パンフレット p.19：女12・男6、文系13・理系5','対象と基準日が揃っていないため、合計人数を一つの数値へ統一していません。'),
('2027本会議の人数','Brand Proposal p.17：36 participants in total / 18 students from each country / Including organizing committee members and support staffs from both countries.','学生・実行委員・サポートスタッフを含む人数の内訳は要確認です。'),
('2026本会議テーマ','Brand Proposal p.6：Learning Across Border & Gaps / p.15：Learning Across Borders','資料内の表記が異なるため、各出典の表記を保存しています。')]

def resources():
    descriptions={'overview':'団体概要、活動理念、発足の経緯、沿革、活動例、サポーター、連絡先。','proposal':'英語の協賛提案資料。団体理念、実行委員体制、過去の活動、2027本会議の計画と連絡先。','brochure':'代表挨拶、年間活動、本会議紹介、実行委員メンバー、団体統計を掲載した日本語パンフレット。'}
    cards=''
    for d in DOCUMENTS:
        page=d['pages'][0]
        cards+=f'<article class="document-card"><a href="{e(d["route"])}"><img src="{e(page["image"])}" alt="{e(d["label"])}の表紙" width="{page["width"]}" height="{page["height"]}" loading="lazy" decoding="async"><h3>{e(d["label"])}</h3></a><p>{e(descriptions[d["slug"]])}</p><p class="document-size">全{len(d["pages"])}ページ</p><a class="text-link" href="{e(d["route"])}">サイトで読む →</a><a class="document-download" href="{e(d["pdf"])}" download>PDF（軽量版・{d["pdf_bytes"]/1024/1024:.1f} MB） ↓</a></article>'
    notes='<div class="table-scroll"><table><caption>資料の表記と要確認事項</caption><thead><tr><th scope="col">項目</th><th scope="col">資料の記載</th><th scope="col">要確認事項</th></tr></thead><tbody>'+''.join(f'<tr><th scope="row">{e(item)}</th><td>{e(written)}</td><td>{e(note)}</td></tr>' for item,written,note in SOURCE_NOTES)+'</tbody></table></div>'
    contact='<p>お問い合わせメール：<a href="mailto:idfc.japan@gmail.com" data-contact-primary="true">idfc.japan@gmail.com</a></p><p>資料に記載されたホームページ：<a href="https://idfc-jpn-mmr.jimdofree.com/" target="_blank" rel="noopener noreferrer">https://idfc-jpn-mmr.jimdofree.com/</a></p><p>ミャンマー側の連絡担当者情報は<a href="/idfc2027/資料/協賛提案/#page-18">Brand Proposal p.18</a>に掲載しています。</p>'
    return section('documents-2027','2027資料を読む','<p>3資料の全48ページを掲載しています。写真・図表・QRコードはページ画像で、本文は「掲載テキスト」から確認できます。</p><div class="document-grid">'+cards+'</div><p class="source-note">PDFは画面で読みやすい軽量版です。ページ画像と掲載テキストは提供された原資料から作成しています。</p>')+section('contact-2027','資料掲載の連絡先',contact,cite('brochure',20)+cite('overview',10)+cite('proposal',18))+section('source-notes','資料の表記について / 要確認',notes)

def document_reader(d):
    count=len(d['pages'])
    index='<nav class="document-index" aria-label="資料のページ">'+''.join(f'<a href="#page-{p["page"]}" aria-label="{p["page"]}ページへ">{p["page"]}</a>' for p in d['pages'])+'</nav>'
    intro=f'<div class="reader-intro"><p>{e(d["original_filename"])} / 全{len(d["pages"])}ページ</p><a class="button" href="{e(d["pdf"])}" download>PDF（軽量版）をダウンロード ↓</a><p class="source-note">ページ画像とテキストは原資料の記載を保存しています。<a href="/idfc2027/資料/#source-notes">資料ごとの表記の違い・要確認事項</a></p></div>'
    pages=''
    for p in d['pages']:
        n=p['page']
        pages+=f'<section class="document-page" id="page-{n}" role="group" aria-roledescription="スライド" aria-label="{n} / {count}ページ" data-pdf-source="{e(d["slug"])}" data-pdf-page="{n}"><div class="document-page-heading"><h2>p.{n}</h2><span>画像を押すと拡大</span></div><a class="document-page-image" data-lightbox="true" href="{e(p["image"])}" aria-label="{e(d["label"])} p.{n}を拡大"><img src="{e(p["image"])}" alt="{e(d["label"])} p.{n}の原ページ" width="{p["width"]}" height="{p["height"]}" loading="lazy" decoding="async"></a><details class="document-text"><summary>p.{n} 掲載テキスト</summary><pre data-pdf-text="true"'+(' lang="en"' if d['slug']=='proposal' else '')+f'>{e(p["text"])}</pre></details></section>'
    controls=f'<div class="document-controls" hidden><button type="button" data-document-prev aria-label="前のページ" aria-controls="document-track" disabled>← 前へ</button><output data-document-status aria-live="polite" aria-atomic="true">1 / {count}</output><button type="button" data-document-next aria-label="次のページ" aria-controls="document-track">次へ →</button></div>'
    hint='<p class="document-hint" id="document-hint">左右にスワイプしてページを切り替えられます。矢印・ページ番号・キーボードの ← → でも移動できます。</p>'
    return intro+f'<div class="document-viewer" data-document-viewer aria-label="{e(d["label"])}">'+hint+controls+index+f'<div class="document-track" id="document-track" tabindex="0" role="region" aria-label="資料の横スクロール表示" aria-describedby="document-hint">'+pages+'</div></div>'

def conference_2026():
    facts='<dl class="conference-facts"><div><dt>開催日 / DATE</dt><dd>2026年3月26日–29日</dd></div><div><dt>会場 / LOCATION</dt><dd>Chulalongkorn University, Bangkok</dd></div><div><dt>THEME</dt><dd lang="en">Learning Across Border &amp; Gaps</dd></div></dl>'
    result=section('conference-overview-2026','IDFC2026 本会議',photo('group-2026','IDFC2026本会議の集合写真')+facts+pie_charts.conference_2026(),cite('proposal',6))
    activities=[('Keynote speeches','discussion','Keynote speeches by professors and senior students on educational pathways and policies in Thailand and Japan.',7),('Cultural exchange','culture','Cultural exchange and mutual learning between Japan and Myanmar to promote inclusiveness and diversity while preserving respected heritages.',7),('Hybrid panel discussion','panel','A hybrid panel discussion with in-person and online both for professors and participants, designed for interactive and engaging dialogue.',8),('Field visit','fieldwork','Participants visited one of the migrant learning centres in Bangkok for a hands-on look at the core theme, featuring an interactive Q&A with students and bridge for sustainable network building.',8)]
    for i,(title,img,copy,page) in enumerate(activities,1):
        result+=section('activity-2026-'+str(i),title,'<div class="activity-row"><p lang="en">'+e(copy)+'</p>'+photo(img,'IDFC2026 / '+title)+'</div>',cite('proposal',page))
    result+=photos_2026.gallery()
    greeting='IDFC2026本会議のタイでの開催は、安全上の理由でミャンマーに渡航できない今、本来のIDFCの目的である学生同士の交流の機会を再構築したいという思いから始まりました。'
    result+=section('voice-2026','IDFC2026代表 / ほのか',paragraphs(greeting,'「本会議」は、日本とミャンマーの学生が、対等な立場で互いの国の関係を考える機会です。ただ単に仲良くなるのではなく、文化の垣根を越えて、共に生活し、議論を交わす中で一生モノの絆と新たな視点を得られると思います。','IDFCでは、「それは日緬双方の学生のためになるのか」「本当に求められている交流の形なのか」「そのテーマは適切なのか」といった問いを繰り返し、本会議を実現しています。自らの手で企画し、実現する。その過程の中で皆さんも、人生を変えるような経験ができるはずです。'),cite('brochure',11))
    voices=['「対話」というものの本質を実感できた貴重な機会でした。この会議に携わることができたことを、大変誇りに思っています！','文化を紹介しあうだけでなく、お互いの国の移民に対する高等教育のあり方について話し合えたことがとても意味深かったと思います。特に、フィールドワークや講演を通して、皆で知識を深められたこともとてもよかったです。','It is a well-networking community to build further actions and the activities arrangement is so good, they so vary and give powerful insights.']
    result+=section('participants-2026','昨年度の本会議 / 参加者の声','<div class="provided-voices">'+''.join(f'<blockquote>{e(x)}</blockquote>' for x in voices)+'</div>',cite('brochure',11))
    result+=section('programs-2026','本会議のプログラム', '<div class="two-column">'+''.join('<div><h3>'+e(title)+'</h3>'+paragraphs(copy)+'</div>' for title,copy in [('ディスカッション','日緬の学生で、テーマに沿った議論をします。英語の議論だけど、みんな優しくしっかりサポートしてくれるので、語学が不安でも大丈夫！'),('食事・パーティー','みんなでご飯を食べながら離しているうちに、自然と仲良くなります！一生の友達ができることもよくあります♡'),('文化紹介','お互いの国の文化を紹介し合う、本会議の中でも特に人気のプログラムです✨。ミャンマーの衣装を着る、楽器を弾くといったこともできるかも！紹介する日本文化も考えてみましょう🇯🇵'),('ゲスト・OBOG','本会議では、さまざまな人を招いて講演や食事会などのプログラムを進めていきます。様々な道を進む先輩方や、普段会えないすごい人とのコネクションもできます！')])+'</div>',cite('brochure',11))
    return result

def legacy_addition(current):
    if current=='/about-idfc/':
        return section('about-update-2027','2027資料の団体紹介',vision_block()+'<p>設立年：2014年（日緬外交樹立60周年）</p><div class="resource-links"><a href="/idfc2027/#impact-2027">実績・沿革 →</a><a href="/idfc2027/活動/">年間活動 →</a><a href="/idfc2027/実行委員/">実行委員・代表挨拶 →</a></div>',cite('overview',3,5))
    if current=='/新規スポンサー様募集/':return supporters()+sponsorship_proposal()
    if current=='/アドバイザー/':return ''
    if current=='/お問合せ/':return section('contact-update-2027','お問い合わせ','<p><a href="mailto:idfc.japan@gmail.com" data-contact-primary="true">idfc.japan@gmail.com</a></p>')
    if current=='/sitemap/':return section('sitemap-update-2027','追加されたページ','<ul>'+''.join(f'<li><a href="{e(path)}">{e(label)}</a></li>' for path,label in ROUTES.items())+'</ul>')
    return ''

def render(current,breadcrumbs,year_nav=None):
    if current in HUB_ROUTES:return year_hub(current,breadcrumbs)
    label=ROUTES[current]
    reader=next((d for d in DOCUMENTS if d['route']==current),None)
    body=document_reader(reader) if reader else overview() if current==BASE else annual_activity() if current==BASE+'活動/' else committee() if current==BASE+'実行委員/' else resources() if current==BASE+'資料/' else conference_2026()
    doc=html.fragment_fromstring('<div>'+body+'</div>')
    entries=doc.xpath('./section[@id]/h2')
    toc='<aside class="article-aside"><details open><summary>このページ</summary><ol>'+''.join(f'<li><a href="#{e(h.getparent().get("id"))}">{e(h.text_content())}</a></li>' for h in entries)+'</ol></details></aside>' if len(entries)>2 and not reader else ''
    archive=current.startswith('/これまでの活動/')
    cls='document-reader' if reader else 'archive-page' if archive else 'current-page'
    navigation=year_nav(current) if archive and year_nav else subnav(current)
    category='これまでの活動' if archive else 'International Development Field Camp'
    return f'<main id="main" class="{cls}"><div class="wrap">{breadcrumbs(current,label)}<header class="page-masthead"><p class="eyebrow">{category}</p><h1>{e(label)}</h1></header>{navigation}<div class="article-layout '+('with-aside' if toc else '')+f'"><article class="update-content">{body}</article>{toc}</div></div></main>'

def head(current,origin,icon_href):
    label=ROUTES[current]
    descriptions={BASE:INTRO,BASE+'活動/':ACTIVITY_INTRO,BASE+'実行委員/':'IDFC2027の代表挨拶、実行委員メンバー、団体組織図。',BASE+'資料/':'IDFC2027の団体概要、Brand Proposal、新歓パンフレットの全48ページ。','/これまでの活動/idfc2026/':'2026年3月26日–29日、Chulalongkorn University, Bangkokで開催されたIDFC2026本会議。'}
    description=descriptions.get(current,label+'の全ページを掲載。')
    canonical=origin+quote(current,safe='/')
    return f'<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{e(label)} - IDFC日本ミャンマー学生会議</title><meta name="description" content="{e(description)}"><meta property="og:title" content="{e(label)} - IDFC日本ミャンマー学生会議"><meta property="og:description" content="{e(description)}"><meta property="og:type" content="website"><meta property="og:url" content="{e(canonical)}"><meta property="og:image" content="{e(origin)}/assets/idfc2027/group-2026.webp"><link rel="canonical" href="{e(canonical)}"><link rel="icon" href="{e(icon_href)}" type="image/svg+xml"><link rel="stylesheet" href="/assets/css/site.css?v={ASSET_VERSION}"><script src="/assets/js/site.js?v={ASSET_VERSION}" defer></script>{design.assets()}</head>'
