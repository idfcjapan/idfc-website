// Refresh only the Japan-side roster and its chapter contents links.
// The bilingual source records the primary source used for every member.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const site = path.join(root, 'site');
const roster = JSON.parse(await readFile(path.join(root, 'source/idfc2027/japan-members.json'), 'utf8'));
const stylesheet = await readFile(path.join(site, 'assets/css/site.css'));
const styleVersion = createHash('sha256').update(stylesheet).digest('hex').slice(0, 12);
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const routes = ['idfc2027', 'idfc2027/活動', 'idfc2027/実行委員', 'idfc2027/資料'];
const sectionPattern = /<section\b[^>]*id="japan-team-2027"[^>]*>[\s\S]*?<\/section>/g;
const contentsPattern = /(<a\b[^>]*href="#japan-team-2027"[^>]*>[\s\S]*?<\/a><ol class="toc-members">)[\s\S]*?(<\/ol>)/g;

if (roster.members.length !== 18 || new Set(roster.members.map(member => member.id)).size !== 18) throw new Error('Expected 18 distinct Japan-side members.');
if (new Set(roster.members.map(member => member.ja.university)).size !== 16) throw new Error('Expected 16 universities in the current roster.');
for (const member of roster.members) {
  if (!/^[a-z][a-z-]*$/.test(member.id)) throw new Error('Invalid member anchor.');
  for (const language of ['ja', 'en']) {
    for (const key of ['name', 'university', 'role', 'quirk', 'reason']) if (!member[language]?.[key]?.trim()) throw new Error('Missing bilingual member field: ' + member.id + '/' + language + '/' + key);
  }
  if (!['instagram', 'facebook', 'brochure'].includes(member.source.type) || !member.source.url) throw new Error('Missing member source: ' + member.id);
  if (!member.portrait.src.startsWith('/assets/idfc2027/')) throw new Error('Unexpected portrait location: ' + member.id);
  await readFile(path.join(site, member.portrait.src.slice(1)));
}

function card(member, language) {
  const english = language === 'en';
  const content = member[language];
  const photo = member.portrait;
  const sourceURL = member.source.type === 'brochure' && english ? '/en' + member.source.url : member.source.url;
  const sourceLabel = member.source.type === 'brochure'
    ? (english ? '2027 brochure, p.' : '2027パンフレット p.') + member.source.page + ' →'
    : member.source.type === 'instagram' ? (english ? 'Official Instagram introduction ↗' : '公式Instagramの紹介 ↗')
      : (english ? 'Official Facebook introduction ↗' : '公式Facebookの紹介 ↗');
  const external = member.source.type !== 'brochure' ? ' target="_blank" rel="noopener noreferrer"' : '';
  const funFactLabel = english ? 'A little about me: ' : 'ひとこと：';
  const reasonLabel = english ? 'Why I joined: ' : '参加のきっかけ：';
  return `<article class="member-card" id="member-${member.id}"><figure class="document-photo${photo.presentation === 'instagram-portrait' ? ' member-photo--instagram' : ''}"><img src="${esc(photo.src)}" alt="${esc(content.name)}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"></figure><p class="member-role">${esc(content.role)}</p><h4>${esc(content.name)}</h4><p class="member-affiliation">${esc(content.university)}</p><ul>${member.mbti ? `<li>MBTI：${esc(member.mbti)}</li>` : ''}<li>${esc(funFactLabel + content.quirk)}</li><li>${esc(reasonLabel + content.reason)}</li></ul><a class="member-source" href="${esc(sourceURL)}"${external}>${esc(sourceLabel)}</a></article>`;
}

const pending = [];
const updateDay = new Date(roster.updatedDate + 'T12:00:00Z');
const updatedEnglish = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(updateDay);
const updatedJapanese = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(updateDay);
for (const language of ['ja', 'en']) {
  const english = language === 'en';
  const section = `<section class="update-section" id="japan-team-2027"><h3>${english ? 'Committee Profiles' : '実行委員紹介'}</h3><p class="source-note">${esc(roster.introduction[language])}</p><p class="source-note"><time datetime="${roster.updatedDate}">${english ? 'Updated ' + updatedEnglish : updatedJapanese + '更新'}</time></p><div class="member-grid">${roster.members.map(member => card(member, language)).join('')}</div></section>`;
  const contents = roster.members.map(member => `<li><a href="#member-${member.id}" data-toc-link>${esc(member[language].name)}</a></li>`).join('');
  for (const route of routes) {
    const file = path.join(site, english ? 'en' : '', route, 'index.html');
    const original = await readFile(file, 'utf8');
    if ([...original.matchAll(sectionPattern)].length !== 1 || [...original.matchAll(contentsPattern)].length !== 1) throw new Error('Expected one roster and one contents list in ' + file);
    const result = original.replace(sectionPattern, section).replace(contentsPattern, (_, opening, closing) => opening + contents + closing)
      .replace(/href="(\/assets\/css\/site\.css)(?:\?[^"<>]*)?"/, (_, href) => `href="${href}?v=${styleVersion}"`);
    // Everything outside these two explicit regions and the stylesheet version
    // must remain byte-for-byte intact, including saved milestones and menus.
    const unchanged = html => html.replace(sectionPattern, '__JAPAN_ROSTER__').replace(contentsPattern, '__JAPAN_CONTENTS__').replace(/href="\/assets\/css\/site\.css(?:\?[^"<>]*)?"/, '__SITE_CSS__');
    if (unchanged(original) !== unchanged(result)) throw new Error('Unexpected change outside Japan-side member scope: ' + file);
    if (result !== original) pending.push([file, result]);
  }
}
for (const [file, text] of pending) await writeFile(file, text);
console.log(JSON.stringify({ members: roster.members.length, universities: 16, pagesUpdated: pending.length, stylesheetVersion: styleVersion, sources: { instagram: roster.members.filter(member => member.source.type === 'instagram').length, facebook: roster.members.filter(member => member.source.type === 'facebook').length, brochure: roster.members.filter(member => member.source.type === 'brochure').length } }));
