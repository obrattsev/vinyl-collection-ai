import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prototypeUI, response } from './fixtures/prototype-dom.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { publicRecords } from '../src/public-record.mjs';
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
const rows = ui => ui.get('#records').children[0].children;
const detail = async ui => { await ui.get('#mobile-records').querySelectorAll('button')[0].fire('click'); return ui.get('#detail-content'); };
const url = 'https://example.com/album?value=' + 'a'.repeat(1500);
const note = 'Полное примечание; "кавычки"\n' + 'Очень длинный текст '.repeat(80);

test('3C wishlist compact links use original URL and safe attributes; edit preserves full value', async () => {
  const source = { ...wish, storeUrl: url, note };
  const ui = await prototypeUI(async (path) => response(path === '/api/collection' ? [] : [source]), { wishlist: true, compact: true });
  await ui.get('#load-collection').fire('click');
  const cell = rows(ui)[0].children[9]; const link = cell.children[0].children[0];
  assert.equal(link.tagName, 'A'); assert.equal(link.textContent, 'Открыть в магазине ↗');
  assert.equal(link.href, url); assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
  assert.ok(!text(cell).includes(url));
  const content = await detail(ui); const mobileLink = content.children[0].children[19].children[0];
  assert.equal(mobileLink.textContent, 'Открыть ↗'); assert.equal(mobileLink.href, url); assert.equal(mobileLink.rel, 'noopener noreferrer');
  assert.ok(!text(content).includes(url)); assert.ok(text(content).includes(note));
  await ui.get('#detail-actions').children[0].fire('click'); assert.equal(ui.input('storeUrl').value, url);
  assert.equal(ui.input('note').value, note); assert.equal(ui.input('note').tagName, 'TEXTAREA');
});
test('3C only parsed HTTP(S) values become active links; arbitrary strings and unsafe schemes stay text', async () => {
  const ui = await prototypeUI(async () => response([]), { wishlist: true, compact: true });
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'ftp://example.com', 'not a url', '//example.com', null, 'http://']) {
    // Test defensive presentation independently of the model rejecting malformed records.
    ui.run(`renderRecords([{ ...${JSON.stringify(wish)}, storeUrl: ${JSON.stringify(value)} }])`);
    const cell = rows(ui)[0].children[9]; assert.equal(cell.children[0].children.length, 0);
    const content = await detail(ui); assert.equal(content.children[0].children[19].children.length, 0);
    await ui.get('#close-detail').fire('click');
  }
  for (const value of ['http://example.com', 'https://example.com']) {
    ui.run(`renderRecords([{ ...${JSON.stringify(wish)}, storeUrl: ${JSON.stringify(value)} }])`);
    assert.equal(rows(ui)[0].children[9].children[0].children[0].href, value);
  }
});
for (const wishlist of [false, true]) for (const owner of [false, true]) test(`3C ${wishlist}/${owner}: note is bounded only in table; private fields follow role, CSV uses raw sorted records on both viewports`, async () => {
  const source = wishlist ? wish : record;
  const data = [{ ...source, artist: 'Zebra', note, ...(wishlist ? { storeUrl: url } : { purchasePrice: 0, purchaseStore: 'Private shop' }) },
    { ...source, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', artist: 'Alpha', note: 'Short' }];
  const ui = await prototypeUI(async () => response(owner ? data : publicRecords(data)), { wishlist, owner, compact: true });
  await ui.get('#load-collection').fire('click');
  await ui.get('#sort-artist').fire('click'); await ui.get('#sort-artist').fire('click');
  const row = rows(ui)[0]; assert.equal(row.children[8].children[0].className, 'table-note'); assert.equal(row.children[8].children[0].textContent, note);
  if (!wishlist) {
    assert.equal(row.children.length, owner ? 13 : 9);
    assert.equal(ui.get('#heading-purchasePrice').hidden, !owner);
    if (owner) { assert.equal(row.children[9].textContent, '03.09.2026'); assert.equal(row.children[10].textContent, 'Private shop'); assert.equal(row.children[11].textContent, 0); }
  }
  const content = await detail(ui); assert.ok(text(content).includes(note));
  assert.equal(text(content).includes('Цена покупки'), owner && !wishlist);
  assert.equal(text(content).includes('Private shop'), owner && !wishlist);
  await ui.get('#close-detail').fire('click');
  await ui.get('#download-records').fire('click'); const mobile = await (await fetch(ui.downloads.at(-1))).text();
  ui.resize(false); await ui.get('#download-records').fire('click'); const desktop = await (await fetch(ui.downloads.at(-1))).text();
  assert.equal(mobile, desktop); assert.ok(mobile.indexOf('Zebra') < mobile.indexOf('Alpha'));
  assert.ok(mobile.includes(note.replaceAll('"', '""'))); assert.equal(mobile.includes(url), owner && wishlist);
  assert.ok(!mobile.includes('Открыть')); assert.ok(!mobile.includes('Цена покупки')); assert.ok(!mobile.includes('Private shop'));
  assert.equal(mobile.split('\r\n')[0].split(';').length, owner && wishlist ? 10 : 9);
  ui.searchInput('artist').value = 'Alpha'; await ui.get('#search-form').fire('submit');
  await ui.get('#download-records').fire('click'); const filtered = await (await fetch(ui.downloads.at(-1))).text();
  assert.ok(filtered.includes('Alpha')); assert.ok(!filtered.includes('Zebra'));
});
test('3C note clipping is scoped to desktop cells and unsortable headings remain plain text', async () => {
  const css = await readFile(new URL('../prototype/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.table-note, \.table-store-link \{[^}]*max-width: 16rem;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(css, /th \{ vertical-align: middle; \}/);
  for (const file of ['index.html', 'wishlist.html']) {
    const html = await readFile(new URL(`../prototype/${file}`, import.meta.url), 'utf8');
    for (const heading of html.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)) {
      if (/Примечание|Ссылка|Дата покупки|Магазин покупки|Цена покупки|Действия/.test(heading[1])) assert.ok(!heading[1].includes('<button'));
    }
  }
});
test('3C owner purchase values distinguish zero/null in desktop and detail; logout clears private view', async () => {
  let source = { ...record, purchasePrice: 0 };
  const ui = await prototypeUI(async () => response([source]), { compact: true });
  for (const price of [0, null]) {
    source = { ...source, purchasePrice: price };
    await ui.get('#load-collection').fire('click');
    assert.equal(rows(ui)[0].children[11].textContent, price ?? '');
    const content = await detail(ui); assert.equal(content.children[0].children[23].textContent, price ?? '');
    await ui.get('#close-detail').fire('click');
  }
  ui.run("applySession({ role: 'guest' })");
  for (const field of ['purchaseDate', 'purchaseStore', 'purchasePrice']) assert.equal(ui.get(`#heading-${field}`).hidden, true);
  assert.equal(ui.get('#records').children.length, 0); assert.equal(ui.get('#detail-content').children.length, 0);
});
