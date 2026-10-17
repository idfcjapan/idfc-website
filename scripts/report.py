import json,re,shutil
from pathlib import Path
from urllib.parse import urlsplit
from collections import Counter

ROOT=Path(__file__).resolve().parents[1]
QA=json.loads((ROOT/'reports/qa.json').read_text());s=QA['summary']
INV=json.loads((ROOT/'reports/inventory.json').read_text())
IMG=json.loads((ROOT/'reports/image-checks-final.json').read_text())
EXT=json.loads((ROOT/'reports/external-checks.json').read_text())
RETRY=json.loads((ROOT/'reports/external-retry.json').read_text())
CHECK={x['url']:x for x in IMG['results']}
ASSETS=set()
for row in INV['image_ledger']:
    u=row['source_url'];m=re.search(r'/(image|backgroundarea)/([^/]+)/version/(\d+)',u)
    ASSETS.add('/'.join(m.groups()) if m else u)
    row['verification']='完了（画像として到達、寸法を確認）' if u in CHECK else '要確認'
    row['dimensions']=CHECK.get(u,{}).get('title')
for row in INV['pages']:
    q=next(x for x in QA['checklist'] if x['page']==row['path'])
    row['status']='完了' if all(q[k]=='完了' for k in ['body','images','links','seo']) else '要確認'
for row in INV['link_ledger']:
    error=next((x for x in RETRY['errors'] if x['url']==row['url']),None)
    row['verification']='要確認（'+error['error']+'）' if error else '完了（内部参照／外部到達を検証）' if row['type'] in ('internal','external') else '完了（ギャラリーを画像URLへのリンクに変更）'
(ROOT/'reports/inventory.json').write_text(json.dumps(INV,ensure_ascii=False,indent=2))
counts=Counter(x['type'] for x in INV['link_ledger'])
source_heads=sum(x['headings_source'] for x in QA['checklist']);source_p=sum(x['paragraphs_source'] for x in QA['checklist'])
new_heads=sum(x['headings_new'] for x in QA['checklist']);new_p=sum(x['paragraphs_new'] for x in QA['checklist'])

lines=['# IDFC サイト移行・検証レポート','',
'新サイト: https://idfc-japan-myanmar.hannaowo.chatgpt.site',
'元サイト: https://idfc-jpn-mmr.jimdofree.com','',
'元サイトの36ページと、2027資料に基づく追加8ページを、日本語・英語の計88ページとして実装しました。翻訳前の文章・属性を生成HTMLから復元し、元サイトの原文と自動照合しました。原文・画像URL／alt・内部参照の欠落は0件です。翻訳の対応と表示内容も別途検証しています。ブラウザーによる画面幅別の目視QAとフォーム送信先の設定は未実施です。','',
'## A. クロール結果','',
'| 項目 | 結果 |','|---|---|',
f'| 発見した固有ページ | {s["pages_found"]} |',
f'| 移行ページ | {s["pages_migrated"]} |',
f'| 最終的なページ取得失敗 | {s["page_fetch_failures"]} |',
'| XMLサイトマップ | 33ページを確認 |',
'| robots.txt | 確認済み |',
'| RSS | ブログ記事1件を確認。サイトマップ掲載記事と一致 |',
'| 追加発見 | 2016/07/19のテスト投稿、/blog-1/?tag=tagPlaceholder、IDFC NEXTの3カテゴリ親ページ |',
'| その他の保存内容 | 親ページ内のIDFC2016・2017・2018、プライバシーポリシー、概要、表示用サイトマップ |',
'| URL別名 | /j/privacy と /j/privacy/ を確認し、新サイトでは /j/privacy/ に統一 |','',
'ヘッダー、フッター、本文、画像リンク、サイトマップ、RSSから到達先を確認しました。/blog-1/ はブログタグの非表示テンプレートから見つかったページです。管理ログインやメール難読化の処理URLは移行ページに含めていません。','',
'### 取得時の制約と再試行','',
'実行環境から元サイトと画像を直接取得する方法はHTTP 403となりました。外部ページ取得機能に切り替え、html要素全体を指定して35ページを取得し、追加の /blog-1/ を取得しました。画像URLは計286件すべてを画像として再取得し、返された寸法を確認しました。画像からテキストを抽出しようとした際の empty_content は画像消失と区別し、画像情報を返す方法で再確認しています。RSSの最初の試行はHTML指定により selector_not_matched となり、指定を外した再試行で取得できました。ページ取得機能は成功ページのHTTP状態を返さないため、台帳には「取得済み」と記録しています。','',
'## B. コンテンツ','',
'| 対象 | 原文側の件数 | 結果 |','|---|---:|---|',
f'| 正規化後の本文文字数 | {s["body_text_characters_normalized"]:,} | 全文翻訳し、変更箇所の原文を復元して照合 |',
f'| 非空の段落 | {source_p:,} | 各段落の文字列と重複回数を照合、欠落0 |',
f'| 内容の見出し | {source_heads} | 文字列と重複回数を照合、欠落0 |',
f'| 本文内の画像要素 | {s["body_image_instances"]} | URL・alt・重複回数を照合、欠落0 |',
f'| 本文内の内部リンク要素 | {counts["internal"]} | 原URLから新URLへの対応を照合 |',
f'| 本文内の外部リンク要素 | {counts["external"]} | 原URLを維持 |',
f'| ギャラリーのJavaScriptリンク | {counts["javascript"]} | 元の data-href にある画像URLをリンク先に使用 |',
f'| 本文内リンク要素合計 | {s["source_body_anchor_instances"]} | リンク先の欠落0 |',
f'| 生成サイト全体のリンク要素 | {s["all_anchor_instances"]:,} | 共通ナビ・フッター・目次を含む |','',
f'元サイトに対応する36ページの本文には{new_heads}個の見出し、{new_p:,}個の非空段落があります。追加は元サイトから引用したHOME導入、原ページ名によるH1、目次・カテゴリリンク、必要な要確認表示です。原文のH1をH2へ整理し、各ページのH1は1つにしました。原文モジュールごとの全テキストも照合し、段落外の文字列を確認しました。','',
'HOMEのIDFC2026ニュース2件とIDFC2025ニュース6件、スポンサー募集バナー、Please Check Our Activities!、4つのSNS／ブログの説明文を保存しています。HOMEの導入文はAbout IDFCの原文を引用しています。旧ページの人物・活動紹介文は原記載を保存しています。2027資料からの追加内容は後述します。','',
'Jimdo広告、概要ページ末尾のJimdo作成プロモーション、ログイン・ログアウト・編集UI、GTM、不要な管理用スクリプト、空のスペーサーとギャラリー管理用オーバーレイを除去しました。文章・写真の削除には使用していません。概要ページの既存Jimdo法人情報は残し、IDFCの団体概要と区別する要確認表示を加えました。','',
'## C. 画像','',
f'画像は **元URL参照** としました。本文の267要素にはギャラリーのサムネイルと同じ写真の再利用を含みます。ヘッダー・OGPも含めた画像URLは286件、寸法違いを同一画像として数えると{len(ASSETS)}件です。ローカルダウンロードは直接取得が403となるため実施していません。','',
'286URLすべてで画像としての到達性と寸法を確認しました。元のsrcsetも保存しています。altが空だった画像は空のままです。新サイトで画像の取得に失敗した場合は、[画像取得失敗・要確認] と元URLへのリンクを表示します。全画像の見た目・トリミングの目視QAは未実施です。','',
'元画像URL・新画像URL・使用ページ・alt・srcset・取得結果・寸法は /migration/image-ledger.json に保存しています。','',
'## D. 技術','',
'| 項目 | 実装 |','|---|---|',
f'| HTML | 静的{s["html_pages"]}ページ。JavaScript無効でも本文・写真・リンクを表示 |',
'| CSS | /assets/css/site.css に共通スタイルを集約 |',
'| JavaScript | /assets/js/site.js。メニュー・横方向の資料切り替え・写真拡大・フォーム送信抑止・画像失敗表示 |',
'| 画像 | 旧ページは原URLを参照。2027資料の画像はローカル保存。タブアイコンはヘッダーと同じ元のIDFCロゴPNGを参照 |',
'| 外部依存 | フレームワーク、外部フォント、UIライブラリなし。元のYouTube／Drive埋め込みは保存 |',
'| URL | 元の日本語URLを維持。URL対応は /migration/url-map.json |',
'| サイトマップ | 表示用 /sitemap/ と、新URLの sitemap.xml を作成 |',
'| SEO | title・meta description・OGP・Twitter情報を各言語へ翻訳。変更前の原文と元画像を保存 |',
'| SEOのURL差分 | canonical・og:url は新サイトの同じパスへ更新。元値は台帳に保存 |',
'| 新規SEO文 | 元サイトの36ページは原記載を翻訳。追加8ページは提供された2027資料に基づくdescriptionとOGPを設定 |',
'| 調整したID | 元HTMLの重複IDに接尾辞を付け、先頭のIDと元ID記録を保持 |',
'| フォーム | お名前、メール、内容の3必須項目を元の順で再現。送信ボタンは未設定として無効化 |','',
'旧ホストからの301には、元Jimdo側または元ドメインの管理設定が必要です。対応表を作成していますが、元サイトの設定変更はしていません。','',
'## E. QA','',
'| 検証 | 結果 |','|---|---|',
f'| 原文差分 | {s["content_diff_errors"]}件の欠落 |',
f'| 内部リンク・ローカル参照 | {s["local_references_checked"]:,}件を検証、エラー{s["local_link_errors"]}件 |',
'| 画像・alt | 元URLとaltの照合、欠落0件。286URLの到達性を確認 |',
'| 外部リンク／埋め込み | 44固有URLを確認。404が6件、権限が必要なURLが2件 |',
'| スポンサーPDF | 元リンク先で本文を取得。PDFリンクと説明、ファイル名・サイズを保存 |',
'| SEO | 36ページの原title・description・OGPを照合 |',
'| 共通フッター | 元の団体名、連絡先、SNS、2020年の著作権情報を保持し、説明文を各言語で表示 |',
'| 静的アクセシビリティ | H1、alt属性、iframeのラベル、入力ラベル、重複ID、フォーカス用CSSを確認 |',
'| 色のコントラスト | 主要本文・リンク・補助文字の組み合わせを計算。通常文字4.5:1以上へ調整 |',
'| JavaScript構文 | node --check で確認 |',
'| ナビ／資料切り替え／写真拡大 | DOMアダプターで実JavaScriptの操作ロジックを検証。実ブラウザー操作は未実施 |',
'| Desktop / Tablet / Mobile | レスポンシブCSSを実装。実画面の目視QAは未実施 |','',
'| 要求された画面幅 | CSS対応 | ブラウザー目視 |','|---:|---|---|',
'| 375px | 実装済み | 要確認 |','| 390px | 実装済み | 要確認 |','| 768px | 実装済み | 要確認 |','| 1024px | 実装済み | 要確認 |','| 1440px | 実装済み | 要確認 |','',
'この環境ではSites指定のブラウザーQA機能が利用できないため、プレビューサーバー・スクリーンショットの代替経路は使っていません。実際の表示、横方向のはみ出し、キーボード操作、タッチ操作、画像トリミングは未確認です。','',
'### 外部リンクの要確認一覧','',
'元のURLは変更・削除していません。以下は再試行しても同じ結果でした。','',
'| 元URL | 状態 | 再試行 |','|---|---|---|']
for e in RETRY['errors']:
    state='404' if e.get('status')==404 else '閲覧権限／ログインが必要'
    lines.append(f'| {e["url"]} | {state} | 同じ結果 |')
lines+=['','## F. 未解決事項','',
'1. フォーム送信先・バックエンドの設定。送信したように見せる処理はありません。','2. 375・390・768・1024・1440pxでの目視と操作の確認。','3. 元の外部リンク6件の404と、Drive埋め込み2件の閲覧権限。','4. 概要ページにあるJimdo法人情報の扱いと、新サイト用プライバシーポリシーの確認。','5. 画像の将来的なローカル保存と、必要な場合の旧ホスト301設定。','',
'## 最終移行チェックリスト','',
'「完了」は台帳との自動照合結果です。画面の目視QAやフォーム送信機能まで完了した意味ではありません。リンクの「要確認」は元の外部URLの404・権限制限を示します。','',
'| 元ページ | 新ページ | 本文 | 画像 | リンク | SEO | 備考 |','|---|---|---|---|---|---|---|']
for q in QA['checklist']:
    srcpath=urlsplit(q['source']).path
    note=[]
    for e in q['notes']:note.append('404' if e.get('status')==404 else '権限制限')
    if q['page']=='/お問合せ/':note.append('送信先要確認')
    if q['page']=='/about/':note.append('法人情報要確認')
    if q['page']=='/j/privacy/':note.append('新サイトへの適合要確認')
    if q['page']=='/blog-1/':note.append('非表示タグリンクから追加発見')
    lines.append(f'| {srcpath} | {q["page"]} | {q["body"]} | {q["images"]} | {q["links"]} | {q["seo"]} | {"・".join(dict.fromkeys(note))} |')
lines+=['','台帳・検証データ:','',
'- /migration/inventory.json — 原文、見出し、画像、リンク、SEO、ページ状態','- /migration/image-ledger.json — 元画像と新画像の対応、alt、使用ページ、到達性','- /migration/link-ledger.json — 元URLと検証結果','- /migration/url-map.json — 旧URLと新URLの対応','- /migration/qa.json — ページ単位の差分・件数、参照エラー、フォーム項目','',
'取得記録と再生成・検証スクリプトはサイトのソースに保存しています。']
if (ROOT/'reports/qa-2027.json').exists():
    import content_2027
    extra=json.loads((ROOT/'reports/qa-2027.json').read_text())
    lines+=['','## G. 2027資料の追加','',
    '追加した内容は、2027本会議の計画、Vision / Mission / Value、沿革・実績、年間活動、代表挨拶・実行委員、サポーター・教員アドバイザー、英語の協賛案内、IDFC2026本会議記録です。HOME、団体紹介、協賛、アドバイザー、お問合せ、サイトマップにも導線を追加しました。','',
    '| 提供資料 | ページ | 本文・画像 | 軽量版PDF |','|---|---:|---|---|']
    for document in extra['documents']:
        lines.append(f'| {document["source"]} | {document["pages"]} | 全ページ照合済み | 文字データ一致、{document["lightweight_pdf_bytes"]/1024/1024:.1f} MB |')
    lines+=['',
    f'原PDFの全{extra["pdf_pages_preserved"]}ページについて、資料ページの掲載テキストと抽出本文を照合しました。ページ画像48点と抽出写真・ロゴ30点、計{extra["local_webp_images_checked"]}点のローカル画像を検証しています。軽量版PDFは文字・フォント・QRのベクター・リンクを保持し、画像だけを圧縮しています。全48ページを再描画し、原PDFの描画との平均ピクセル差の最大値は1.88/255、描画エラーは0件です。代表ページを目視確認しています。','',
    '2027本会議はBrand Proposalの開催計画として記載しました。募集開始、参加費、申込フォームは資料に記載がなく、追加していません。所属・学年はパンフレット掲載時の表記です。','',
    '### 資料ごとの表記・要確認事項','',
    '| 項目 | 資料の記載 | 要確認事項 |','|---|---|---|']
    for item,written,note in content_2027.SOURCE_NOTES:
        lines.append(f'| {item} | {written} | {note} |')
    lines+=['','### 追加したページ','',
    '| ページ | URL |','|---|---|']
    for path,label in content_2027.ROUTES.items():
        lines.append(f'| {label} | {path} |')
    lines+=['',f'サイトは計{s["html_pages"]}ページです。ローカル参照{s["local_references_checked"]:,}件で欠落0、原文差分0、静的アクセシビリティエラー0。画面幅別のブラウザー目視・操作QAは引き続き未実施です。','',
    '追加資料と検証データ：/migration/documents-2027.json、/migration/qa-2027.json']

if (ROOT/'reports/qa-ui.json').exists():
    ui=json.loads((ROOT/'reports/qa-ui.json').read_text())
    lines+=['','## H. NEWS・メニュー・資料表示の更新','',
    'HOMEのお知らせを、年度見出しと日付付きの短い一文の形式に戻しました。日付はYYYY.MM.DDに統一し、年度内で新しい順に並べています。各年度の最新3件を表示し、それ以前のお知らせは標準のdetails要素で折りたたみます。Instagramの記事には投稿の表示日、旧記事には元のお知らせの日付、資料掲載通知には2026年10月4日を使用します。既存8件・公式Instagramの記事14件・資料などの掲載通知3件を保持し、日本語・英語版を更新しています。','',
    'メニューを開いた際の透明な背景を修正し、本文との重なりを解消しました。開閉の表示とaria-expandedを一致させ、親・子メニューの閉じ方、外側クリック、Escape、画面幅変更時のリセットとフォーカス移動を追加しました。','',
    '3資料の全48ページは横方向のページ表示へ変更しました。左右の矢印、ページ番号、キーボード、ネイティブの横スクロールに対応しています。出典の #page-N リンクは対象ページを直接表示し、掲載テキストとPDFダウンロードも保持しています。JavaScript無効でも横スクロールで全ページを読めます。','',
    '画像拡大時に読み込みが失敗した場合の案内と、元画像へのリンクも追加しました。古いCSS・JavaScriptが残るのを防ぐため、ファイル内容に基づくURLバージョンを付けています。','',
    f'生成HTML{ui["fixtures"]}種類、'+ '・'.join(map(str,ui['widths']))+f'pxを模擬したDOMアダプターで、実際のsite.jsに対する{ui["assertions"]}アサーションを検証し、すべて成功しました。メニューの開閉、子メニュー、閉じた領域へのフォーカス、画面幅変更、資料の先頭・末尾、ページ番号、出典リンク、横スクロール後の同期、動きを減らす設定、画像拡大の失敗を含みます。','',
    'これは操作ロジックと模擬的なページ位置の検証です。実ブラウザーの描画、CSSによる配置、実際のスワイプ操作は未検証です。','',
    '操作検証データ：/migration/qa-ui.json','',
    '## I. フッター・横メニュー・アニメーション','',
    f'FacebookとXの旧接続ウィジェットは「公式SNS」と同じリンク先だったため、利用者の指示に基づいて除去し、各SNSを1リンクに統一しました。削除した表示は「Facebook に接続する」「X に接続する」の2件です。Instagram、団体名、連絡先、著作権情報、その他のフッター本文を保持し、説明文を各言語で表示しています。原文照合は翻訳前の文章を復元し、この許可差分を除いた本文を比較して、全{s["html_pages"]}ページで一致しました。','',
    'フッターのサイトマップ内リンクの太さを600に統一し、IDFC2025の指定漏れを修正しました。公式SNSのリンクも余白と44px以上の操作領域を持つ表示にしています。','',
    '1200px以上では横ナビを14pxの文字で折り返す配置へ変更しました。項目間の余白、選択中の色、子メニュー内の行間を調整しています。ページ内タブにも選択色と操作領域を設け、資料ページでは「資料」を選択状態にしています。ヘッダーの高さに応じて目次とアンカー移動の位置を更新します。','',
    'スクロール時の短いフェード表示、メニューの表示、カードとボタンのホバーにアニメーションを追加しました。prefers-reduced-motionでは動きを抑えます。IntersectionObserverが使えなくても本文は表示されます。追加した操作検証では、可視状態での開始、1回のみの実行、フォーカス中の表示を動かさないこと、動きを減らす設定、機能が利用できない場合の動作を確認しました。実際の描画・タッチ操作は引き続き未検証です。']

if (ROOT/'reports/qa-languages.json').exists():
    languages=json.loads((ROOT/'reports/qa-languages.json').read_text())
    lines+=['','## J. 日本語・英語の切り替え','',
    '日本語を既定にし、英語の説明文・見出しを日本語へ翻訳しました。人物名・団体名・SNS名・原資料のファイル名などの固有名詞は保持しています。ヘッダーに「日本語／English」のリンクボタンを設け、英語版は /en/ 配下に配置しました。過去の活動・インタビュー・共通フッター・フォーム・出典・エラー表示を含みます。','',
    '言語を切り替えた際は同じページ、クエリ、資料の #page-N を引き継ぎます。英語版内のページリンクは英語版へ接続し、canonicalとhreflangも言語に合わせています。スマートフォンでは現在と異なる言語のボタンを表示します。翻訳は静的HTMLとして保存し、翻訳APIやJavaScriptの実行に依存しません。','',
    '資料48ページは原ページの画像をそのまま横方向に切り替えて表示します。画像を押すと拡大でき、本文は任意で開く「掲載テキスト」から選択した言語で確認できます。PDFのダウンロードを保持し、原PDFの文字・画像自体は翻訳・変更していません。','',
    f'翻訳文字列{languages["translation_records"]:,}件、文中の強調・数字・リンクを含む英語段落{languages["fluent_paragraph_records"]}件を用意しました。{languages["page_pairs"]}組の言語別ページ、両言語合計{languages["pdf_page_views_checked"]}件の資料ページ表示を検証しています。翻訳値・ページ対応・言語ボタン・内部リンク・原文復元・見える説明文の翻訳漏れについて、{languages["assertions"]:,}件の検証が成功しました。実ブラウザーでの描画と訳文の専門家による校閲は未実施です。','',
    '言語検証データ：/migration/qa-languages.json']

out=ROOT/'reports';out.mkdir(parents=True,exist_ok=True)
report=out/'IDFC_Migration_Report.md';report.write_text('\n'.join(lines)+'\n')
dest=ROOT/'site/migration';dest.mkdir(exist_ok=True)
for fn in ['inventory.json','url-map.json','qa.json','qa-ui.json','qa-languages.json']:
    shutil.copy2(ROOT/'reports'/fn,dest/fn)
(dest/'image-ledger.json').write_text(json.dumps(INV['image_ledger'],ensure_ascii=False,indent=2))
(dest/'link-ledger.json').write_text(json.dumps(INV['link_ledger'],ensure_ascii=False,indent=2))
print(json.dumps({'report':str(report),'bytes':report.stat().st_size,'logical_images':len(ASSETS),'body_paragraphs':source_p,'headings':source_heads},ensure_ascii=False))
