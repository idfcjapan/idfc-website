// Keep the public publication and editor service aligned on one set of URLs.
export const PUBLIC_SITE_URL = 'https://idfc-japan-myanmar.hannaowo.chatgpt.site/';

// The GitHub copy remains accessible, but the requested Sites address is the
// preferred publication. Keep route parsing explicit because GitHub has a prefix.
const publicationBases = [PUBLIC_SITE_URL, 'https://idfcjapan.github.io/idfc-website/'].map(value => new URL(value));

const yearAliases = new Set([
  '/idfc2027/活動/',
  '/idfc2027/実行委員/',
  '/idfc2027/資料/',
]);

export function canonicalPath(value) {
  const path = decodeURIComponent(value || '/');
  if (!path.startsWith('/') || /[?#]/.test(path)) throw new Error('Expected a page route.');
  const english = path.startsWith('/en/');
  const route = english ? path.slice(3) : path;
  return yearAliases.has(route) ? (english ? '/en' : '') + '/idfc2027/' : path;
}

export function publicPageURL(path, baseURL = PUBLIC_SITE_URL) {
  const base = new URL(baseURL);
  if (!base.pathname.endsWith('/') || base.search || base.hash) throw new Error('Public URL must end in a slash.');
  return base.href + canonicalPath(path).slice(1).split('/').map(encodeURIComponent).join('/');
}

export function publicationRoute(value) {
  const url = new URL(value);
  const base = publicationBases.find(base => url.origin === base.origin && url.pathname.startsWith(base.pathname));
  if (!base || url.search || url.hash) throw new Error('Unexpected publication URL: ' + value);
  return decodeURIComponent('/' + url.pathname.slice(base.pathname.length));
}

export function normalizePublicSitemap(xml) {
  const locations = new Set();
  const text = xml.replace(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g, (entry, value) => {
    const route = publicationRoute(value);
    if (canonicalPath(route) !== route) return '';
    const canonical = publicPageURL(route);
    if (locations.has(canonical)) return '';
    locations.add(canonical);
    return entry.replace('<loc>' + value + '</loc>', '<loc>' + canonical + '</loc>');
  });
  if (!locations.size) throw new Error('Public sitemap has no canonical pages.');
  return { text, count: locations.size };
}

function attribute(tag, name) {
  return tag.match(new RegExp('\\b' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i'))?.[2];
}

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
    if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
    const code = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

function replaceAttribute(tag, name, value) {
  if (attribute(tag, name) === undefined) throw new Error('Missing ' + name + ' in SEO metadata.');
  return tag.replace(new RegExp('(\\b' + name + '\\s*=\\s*)(["\'])([\\s\\S]*?)\\2', 'i'), (_, prefix, quote) => {
    const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll(quote, quote === '"' ? '&quot;' : '&#39;');
    return prefix + quote + escaped + quote;
  });
}

const descriptions = {
  '/about-idfc/': {
    ja: 'IDFC（日本ミャンマー学生会議）は、日本とミャンマーの若者が社会課題について議論し、文化交流を通じて相互理解を深める学生団体です。団体の理念と活動を紹介します。',
    en: 'Learn about IDFC, a student organization connecting young people from Japan and Myanmar through discussions of social issues, cultural exchange and mutual understanding.',
  },
  '/新規スポンサー様募集/': {
    ja: 'IDFC（日本ミャンマー学生会議）の活動を支える企業スポンサー・個人サポーターを募集しています。資金援助や物品による協賛など、ご支援に関する情報とお問い合わせ先をご案内します。',
    en: 'Support IDFC and student exchange between Japan and Myanmar. Find information for corporate sponsors and individual supporters, including financial and in-kind support and how to contact us.',
  },
  '/お問合せ/': {
    ja: 'IDFC（日本ミャンマー学生会議）へのお問い合わせはこちら。活動・参加・協賛などのご相談に関する連絡先と、日本側・ミャンマー側のメール、公式SNSをご案内します。',
    en: 'Contact IDFC, the Japan–Myanmar student conference, about activities, participation or support. Find email contacts for the Japan and Myanmar teams and our official social media accounts.',
  },
};

export function pageDescription(route, { existing = '', og = '', title = '' } = {}) {
  if (existing.trim()) return existing;
  const canonical = canonicalPath(route), english = canonical.startsWith('/en/');
  const basePath = english ? canonical.slice(3) : canonical;
  if (descriptions[basePath]) return descriptions[basePath][english ? 'en' : 'ja'];
  const clean = value => decodeEntities(value).replace(/<[^>]*>/g, ' ').replace(/\\[nr]/g, ' ').replace(/\s+/g, ' ').trim();
  let value = clean(og);
  if (!value) value = clean(title) + (english ? '. Official IDFC Japan–Myanmar student conference website.' : '。日本とミャンマーの学生交流に取り組むIDFCの公式サイトです。');
  const limit = english ? 220 : 150, characters = Array.from(value);
  if (characters.length <= limit) return value;
  const clipped = characters.slice(0, limit - 1).join('');
  const sentenceEnd = Math.max(clipped.lastIndexOf('。'), clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
  if (sentenceEnd >= limit * 0.55) return clipped.slice(0, sentenceEnd + 1);
  const wordEnd = english ? clipped.lastIndexOf(' ') : -1;
  return (wordEnd >= limit * 0.7 ? clipped.slice(0, wordEnd) : clipped).trimEnd() + '…';
}

// Only change the document head. Member-managed main/header/footer fragments
// remain byte-for-byte intact and are applied independently by the Worker.
export function normalizePublicPage(html, route) {
  const basePath = route.startsWith('/en/') ? route.slice(3) : route;
  let canonicals = 0, ogURLs = 0, descriptionCount = 0;
  const languages = new Set();
  const normalized = html.replace(/(<head\b[^>]*>)([\s\S]*?)(<\/head>)/i, (_, opening, head, closing) => {
    const tags = [...head.matchAll(/<(?:link|meta)\b[^>]*>/gi)].map(match => match[0]);
    const existing = tags.find(tag => attribute(tag, 'name') === 'description');
    const og = tags.find(tag => attribute(tag, 'property') === 'og:description');
    const description = pageDescription(route, {
      existing: decodeEntities(attribute(existing || '', 'content') || ''),
      og: attribute(og || '', 'content') || '',
      title: head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '',
    });
    let rewritten = head.replace(/<(?:link|meta)\b[^>]*>/gi, tag => {
      if (/^<link\b/i.test(tag) && attribute(tag, 'rel') === 'canonical') {
        canonicals++;
        return replaceAttribute(tag, 'href', publicPageURL(route));
      }
      if (/^<meta\b/i.test(tag) && attribute(tag, 'property') === 'og:url') {
        ogURLs++;
        return replaceAttribute(tag, 'content', publicPageURL(route));
      }
      if (/^<meta\b/i.test(tag) && attribute(tag, 'name') === 'description') {
        descriptionCount++;
        return attribute(tag, 'content')?.trim() ? tag : replaceAttribute(tag, 'content', description);
      }
      if (/^<link\b/i.test(tag) && attribute(tag, 'rel') === 'alternate' && attribute(tag, 'hreflang')) {
        const language = attribute(tag, 'hreflang');
        if (!['ja', 'en', 'x-default'].includes(language)) throw new Error('Unexpected hreflang: ' + language);
        languages.add(language);
        return replaceAttribute(tag, 'href', publicPageURL((language === 'en' ? '/en' : '') + basePath));
      }
      return tag;
    });
    if (!descriptionCount) rewritten += '<meta name="description" content="' + description.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') + '">';
    rewritten = rewritten.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (whole, start, text, end) => {
      if (attribute(start, 'type') !== 'application/ld+json' || attribute(start, 'id') !== 'idfc-organization') return whole;
      const organization = JSON.parse(text);
      organization['@id'] = PUBLIC_SITE_URL + '#organization';
      organization.url = PUBLIC_SITE_URL;
      organization.logo = PUBLIC_SITE_URL + 'assets/images/idfc-logo.svg';
      return start + JSON.stringify(organization).replaceAll('<', '\\u003c') + end;
    });
    return opening + rewritten + closing;
  });
  if (canonicals !== 1 || ogURLs !== 1 || languages.size !== 3 || descriptionCount > 1) throw new Error('Incomplete public SEO metadata: ' + route);
  return normalized;
}
