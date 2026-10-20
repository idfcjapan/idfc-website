(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const number = value => Number(value).toLocaleString('ja-JP');
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const shortDate = date => date.slice(5).replace('-', '/');
  const longDate = date => date.replaceAll('-', '/');
  const canonical = path => {
    try { path = decodeURIComponent(path); } catch { /* Keep a valid encoded path. */ }
    if (path.startsWith('/en/')) path = path.slice(3);
    return /^\/idfc2027\/(活動|実行委員|資料)\/$/.test(path) ? '/idfc2027/' : path;
  };
  const title = page => page.title?.replace(/\s*[-|]\s*IDFC.*$/, '') || page.path;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function svgElement(tag, attributes, text) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  window.IDFCAnalytics = { create({request, isAuthenticated}) {
    const dialog = $('analytics-dialog');
    const state = {days:30, path:'', data:null, sequence:0, controller:null, svg:null, active:null};
    function stop() {
      state.sequence++;
      state.controller?.abort();
      state.controller = null;
    }
    function close({clear=false}={}) {
      stop();
      if (dialog.open) dialog.close();
      if (clear) {
        state.data = null;
        state.svg = null;
        $('analytics-results').hidden = true;
        $('analytics-error').hidden = true;
        $('analytics-chart').replaceChildren();
        $('analytics-page-rows').replaceChildren();
        $('analytics-daily-rows').replaceChildren();
      }
    }
    function pagesOptions(pages, preferred) {
      const options = [new Option('全ページ', '')], seen = new Set();
      for (const page of pages) {
        const path = canonical(page.path);
        if (seen.has(path) || page.path.startsWith('/en/') || canonical(page.path) !== page.path) continue;
        seen.add(path);
        options.push(new Option(title(page), path));
      }
      $('analytics-page').replaceChildren(...options);
      state.path = seen.has(canonical(preferred)) ? canonical(preferred) : '';
      $('analytics-page').value = state.path;
    }
    function measured(day) {
      return Boolean(state.data.collectionStartedDate && day.date >= state.data.collectionStartedDate);
    }
    function dayLabel(day) {
      const partial = state.data.partialDates?.includes(day.date) || day.date === state.data.period.to;
      return longDate(day.date) + '：' + (measured(day) ? number(day.views) + ' PV' + (partial ? '（途中経過）' : '') : '未計測');
    }
    function selectDay(index) {
      if (!state.data) return;
      const day = state.data.daily[index];
      if (!day) return;
      $('analytics-day').value = index;
      $('analytics-day').setAttribute('aria-valuetext', dayLabel(day));
      $('analytics-day-readout').textContent = dayLabel(day);
      if (state.svg && state.active) {
        const {x, y} = state.active.points[index];
        state.active.guide.setAttribute('x1', x);
        state.active.guide.setAttribute('x2', x);
        state.active.guide.setAttribute('visibility', measured(day) ? 'visible' : 'hidden');
        state.active.dot.setAttribute('cx', x);
        state.active.dot.setAttribute('cy', y);
        state.active.dot.setAttribute('visibility', measured(day) ? 'visible' : 'hidden');
      }
    }
    function chart(data) {
      const daily = data.daily, left = 54, right = 936, top = 20, bottom = 218;
      const svg = svgElement('svg', {viewBox:'0 0 960 264', role:'img', 'aria-labelledby':'analytics-svg-title analytics-svg-description'});
      svg.append(svgElement('title', {id:'analytics-svg-title'}, '日ごとの閲覧数の線グラフ'));
      svg.append(svgElement('desc', {id:'analytics-svg-description'}, longDate(data.period.from) + 'から' + longDate(data.period.to) + 'の閲覧数。日別の数値は、下の日付選択または日別表でも確認できます。計測開始前は線を表示しません。'));
      const peak = Math.max(0, ...daily.filter(measured).map(day => day.views));
      const raw = Math.max(1, peak / 4), magnitude = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= raw);
      const ceiling = step * 4;
      for (let tick = 0; tick <= 4; tick++) {
        const y = bottom - (bottom - top) * tick / 4;
        svg.append(svgElement('line', {x1:left, x2:right, y1:y, y2:y, class:'analytics-grid'}));
        svg.append(svgElement('text', {x:left - 12, y:y + 4, 'text-anchor':'end', class:'analytics-axis'}, number(step * tick)));
      }
      const points = daily.map((day, index) => ({
        x:left + index * (right - left) / Math.max(1, daily.length - 1),
        y:bottom - day.views / ceiling * (bottom - top)
      }));
      const labelIndexes = new Set([0, Math.round((daily.length - 1) / 4), Math.round((daily.length - 1) / 2), Math.round((daily.length - 1) * 3 / 4), daily.length - 1]);
      for (const index of labelIndexes) svg.append(svgElement('text', {x:points[index].x, y:249, 'text-anchor':'middle', class:'analytics-axis'}, shortDate(daily[index].date)));
      const visiblePoints = points.filter((_, index) => measured(daily[index]));
      if (visiblePoints.length) {
        const line = visiblePoints.map(point => point.x + ',' + point.y).join(' ');
        svg.append(svgElement('polyline', {points:line, class:'analytics-line', fill:'none', 'stroke-linejoin':'round', 'stroke-linecap':'round'}));
        if (visiblePoints.length <= 30) for (const point of visiblePoints) svg.append(svgElement('circle', {cx:point.x, cy:point.y, r:3.5, class:'analytics-point'}));
      }
      const guide = svgElement('line', {x1:right, x2:right, y1:top, y2:bottom, class:'analytics-guide'});
      const dot = svgElement('circle', {cx:right, cy:bottom, r:6, class:'analytics-active-point'});
      svg.append(guide, dot);
      svg.addEventListener('pointermove', event => {
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        const position = (event.clientX - rect.left) * 960 / rect.width;
        selectDay(Math.max(0, Math.min(daily.length - 1, Math.round((position - left) / (right - left) * (daily.length - 1)))));
      });
      $('analytics-chart').replaceChildren(svg);
      state.svg = svg;
      state.active = {guide, dot, points};
      $('analytics-day').max = daily.length - 1;
      selectDay(daily.length - 1);
    }
    function rows(data) {
      const daily = data.daily.map(day => {
        const row = element('tr'), heading = element('th', longDate(day.date));
        heading.scope = 'row';
        if (data.partialDates?.includes(day.date) || day.date === data.period.to) heading.append(element('span', ' 途中経過', 'analytics-partial'));
        row.append(heading, element('td', measured(day) ? number(day.views) + ' PV' : '未計測'));
        return row;
      });
      $('analytics-daily-rows').replaceChildren(...daily);
      const pages = [...data.pages].sort((a, b) => b.total - a.total || title(a).localeCompare(title(b), 'ja'));
      $('analytics-page-rows').replaceChildren(...pages.map(page => {
        const button = element('button', undefined, 'analytics-page-row');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(page.path === state.path));
        const name = element('span', title(page), 'analytics-page-title');
        const views = element('span', undefined, 'analytics-page-count');
        views.append(element('strong', number(page.total)), document.createTextNode(' PV'));
        button.append(name, views);
        button.addEventListener('click', () => {
          state.path = page.path;
          $('analytics-page').value = page.path;
          $('analytics-page').focus();
          load();
        });
        return button;
      }));
    }
    function render(data) {
      if (!Array.isArray(data.daily) || (state.days === 'all' ? data.daily.length < 1 : data.daily.length !== state.days) || data.days !== state.days || !Array.isArray(data.pages) || !count(data.total) || !count(data.allTimeTotal) || !data.daily.every(day => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && count(day.views)) || !data.pages.every(page => typeof page.path === 'string' && count(page.total)) || !data.period?.from || !data.period?.to) throw new Error('閲覧数のデータを読み取れませんでした。もう一度お試しください。');
      state.data = data;
      $('analytics-total').textContent = number(data.total);
      $('analytics-all-time').textContent = number(data.allTimeTotal);
      $('analytics-date-range').textContent = longDate(data.period.from) + ' – ' + longDate(data.period.to);
      $('analytics-start-date').textContent = data.collectionStartedDate ? longDate(data.collectionStartedDate) + ' から（日本時間）' : '最初の閲覧から計測が始まります';
      $('analytics-total-label').textContent = (state.path ? 'この掲載' : '全ページ') + (state.days === 'all' ? 'の閲覧数（計測開始から）' : '・過去30日の閲覧数');
      $('analytics-all-time-card').hidden = state.days === 'all';
      $('analytics-list-period').textContent = (state.days === 'all' ? '計測開始から' : '過去30日') + ' · PV';
      $('analytics-empty').hidden = data.total > 0;
      $('analytics-empty').textContent = !data.collectionStartedDate ? 'まだ計測データがありません。計測を有効にした後、公開ページが閲覧されると、ここに線グラフが表示されます。' : 'この期間の閲覧はまだありません。閲覧されると、線グラフに反映されます。';
      chart(data);
      rows(data);
      $('analytics-results').hidden = false;
      $('analytics-status').textContent = '';
    }
    async function load() {
      if (!isAuthenticated() || !dialog.open) return;
      stop();
      const sequence = state.sequence, controller = new AbortController();
      state.controller = controller;
      $('analytics-results').hidden = true;
      $('analytics-error').hidden = true;
      $('analytics-status').textContent = '閲覧数を読み込み中…';
      $('analytics-results').setAttribute('aria-busy', 'true');
      for (const button of document.querySelectorAll('[data-analytics-days]')) button.setAttribute('aria-pressed', String(button.dataset.analyticsDays === String(state.days)));
      const parameters = new URLSearchParams({days:String(state.days)});
      if (state.path) parameters.set('path', state.path);
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const data = await request('analytics?' + parameters, {signal:controller.signal});
        if (sequence !== state.sequence || !dialog.open || !isAuthenticated()) return;
        render(data);
      } catch (error) {
        if (sequence !== state.sequence || !dialog.open || !isAuthenticated()) return;
        $('analytics-status').textContent = '';
        $('analytics-error-text').textContent = error.name === 'AbortError' ? '読み込みに時間がかかっています。通信状況を確認して、もう一度お試しください。' : (error.message || '閲覧数を読み込めませんでした。');
        $('analytics-error').hidden = false;
      } finally {
        clearTimeout(timeout);
        if (sequence === state.sequence) {
          state.controller = null;
          $('analytics-results').setAttribute('aria-busy', 'false');
        }
      }
    }
    function open({pages, path}) {
      if (!isAuthenticated()) return;
      pagesOptions(pages, path);
      if (!dialog.open) dialog.showModal();
      load();
    }
    $('analytics-close').addEventListener('click', () => close());
    dialog.addEventListener('close', stop);
    $('analytics-page').addEventListener('change', () => {state.path = $('analytics-page').value; load();});
    $('analytics-day').addEventListener('input', () => selectDay(Number($('analytics-day').value)));
    $('analytics-retry').addEventListener('click', load);
    for (const button of document.querySelectorAll('[data-analytics-days]')) button.addEventListener('click', () => {state.days = button.dataset.analyticsDays === 'all' ? 'all' : 30; load();});
    return {open, close};
  }};
})();
