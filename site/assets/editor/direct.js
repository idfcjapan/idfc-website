(() => {
  const $ = id => document.getElementById(id);
  const hint = $('browser-ai-hint');
  const availability = $('direct-availability');
  const syncAvailability = () => {
    availability.hidden = !hint.hidden;
  };
  new MutationObserver(syncAvailability).observe(hint, {attributes: true, attributeFilter: ['hidden']});
  syncAvailability();
  function prepare() {
    const request = $('direct-request').value.trim();
    if (!request) {
      $('direct-status').textContent = '変えたいことを入力してください。横のチャットに直接書いても大丈夫です。';
      $('direct-request').focus();
      return;
    }
    const path = $('page-select').value;
    const scope = $('scope').value;
    const scopeLabel = $('scope').selectedOptions[0].textContent;
    $('direct-prompt').value = [
      '次のIDFC編集画面を、あなたの内蔵ブラウザーで開いてください。すでに開いている場合はその画面を使ってください。',
      location.origin + location.pathname + location.search,
      'ログインが必要なら私に操作を渡してください。',
      '編集対象：ページ ' + path + '／日本語・英語の両方／場所 ' + scopeLabel + '（' + scope + '）。',
      '言語・ページ・場所を選び、現在の編集内容を直接読み取って、次の依頼を反映した編集案をプレビューへ表示してください。',
      '依頼：' + request,
      '日本語・英語のHTMLを両方読み取り、両言語をセットで修正してプレビューしてください。片方だけの修正にしないでください。文章はそれぞれ自然な表現にし、情報・写真・構成をそろえてください。',
      '既存の情報・写真・リンクを保持し、事実を推測して追加しないでください。対象ページと場所が一致することを確認してから変更してください。',
      'WebMCPのツール（idfc_read_editing_page・idfc_preview_ai_edit）が使えない場合は、ページ内のJavaScriptで window.IDFCEditor.read() を呼んで日英の内容を読み、window.IDFCEditor.preview(htmlJa, htmlEn, {expectedPath, expectedScope, expectedRevision, expectedContentVersion}) でプレビューしてください（値はread()の結果のpath・scope・revision・contentVersion）。',
      'ファイルの書き出しやアップロードは不要です。公開せず、プレビューまでで止めてください。公開は私が「保存して公開」を押して行います。'
    ].join('\n');
    $('direct-prompt-area').hidden = false;
    $('direct-status').textContent = '依頼文を用意しました。横のチャットに送ってください。';
  }
  $('direct-prepare').addEventListener('click', prepare);
  for (const id of ['language', 'page-select', 'scope', 'direct-request']) {
    $(id).addEventListener(id === 'direct-request' ? 'input' : 'change', () => {
      $('direct-prompt-area').hidden = true;
      $('direct-prompt').value = '';
      $('direct-status').textContent = '';
    });
  }
  $('direct-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('direct-prompt').value);
      $('direct-status').textContent = 'コピーしました。横のチャットへ貼り付けて送ってください。';
    } catch {
      $('direct-prompt').focus();
      $('direct-prompt').select();
      $('direct-status').textContent = '依頼文を選択しました。コピーして横のチャットへ送ってください。';
    }
  });
})();
