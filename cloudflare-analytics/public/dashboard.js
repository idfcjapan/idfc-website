// Shows the editor's analytics view as a page, reading this Worker's member-only API.
(async () => {
  'use strict';
  const request = async (url, options = {}) => {
    const response = await fetch('/api/' + url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '閲覧数を読み込めませんでした。');
    return data;
  };
  const dialog = document.getElementById('analytics-dialog');
  // The view expects a modal dialog; here it stays open as the page itself.
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.addEventListener('cancel', event => event.preventDefault());
  const analytics = window.IDFCAnalytics.create({ request, isAuthenticated: () => true });
  try {
    const { pages } = await request('pages');
    analytics.open({ pages, path: '' });
  } catch (error) {
    dialog.setAttribute('open', '');
    document.getElementById('analytics-status').textContent = '';
    document.getElementById('analytics-error-text').textContent = error.message;
    document.getElementById('analytics-error').hidden = false;
  }
})();
