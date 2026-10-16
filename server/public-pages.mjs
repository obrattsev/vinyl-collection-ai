// Canonical URLs never derive from the untrusted request Host header.
export const SITE_ORIGIN = 'https://vinyl-collection.ru';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function metadata(html, {title, description, path, index = false, image}) {
  const e = escapeHtml, url = SITE_ORIGIN + path;
  return html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${e(title)}</title>`).replace('</head>', () =>
    `<meta name="description" content="${e(description)}"><meta name="robots" content="${index ? 'index, follow' : 'noindex'}">` +
    `<link rel="canonical" href="${e(url)}"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">` +
    `<meta property="og:type" content="website"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(url)}">` +
    (image ? `<meta property="og:image" content="${e(SITE_ORIGIN + image)}">` : '') + '</head>');
}
// Input must already be the validated public projection, including for the owner.
export function catalogue(records) {
  const e = escapeHtml;
  const fields = [['genre','Жанр'],['additionalGenre','Дополнительный жанр'],['label','Лейбл'],['albumYear','Год альбома'],['recordYear','Год издания'],['editionType','Издание'],['note','Примечание'],['salePrice','Цена продажи']];
  return `<div id="public-catalogue" class="public-catalogue">${records.length ? records.map(record =>
    `<article><h2>${e(record.artist)} — ${e(record.album)}</h2>` +
    (record.cover ? `<img src="${e(record.cover.thumbnailUrl)}" alt="Обложка ${e(record.artist)} — ${e(record.album)}" width="120" height="120" loading="lazy">` : '') +
    `<dl>${fields.filter(([key]) => key !== 'salePrice' || Object.hasOwn(record,key)).map(([key,label]) => `<div><dt>${label}</dt><dd>${e(record[key] ?? '-')}</dd></div>`).join('')}</dl></article>`).join('') : '<p>Коллекция пуста</p>'}</div>`;
}
export function sitemap(logins) {
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    ['/', ...logins.map(login => `/${encodeURIComponent(login)}/collection`)].map(path => `<url><loc>${escapeHtml(SITE_ORIGIN + path)}</loc></url>`).join('') + '</urlset>';
}
export const robots = `User-agent: *
Disallow: /api/
Disallow: /auth
Disallow: /prototype
Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
