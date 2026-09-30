import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectDailyQuote, quoteCandidates } from '../src/daily-quote.mjs';
import { bindDailyQuote, renderQuote } from '../prototype/daily-quote-ui.mjs';
const quotes = ['a', 'b', 'c'].map(id => ({ id, artist: 'Вымышленный исполнитель', song: `Песня ${id}`, quote: `Тестовая строка ${id}`, section: 'both' }));
test('quotes are stable on refresh, depend on local calendar day and section, change at next day', () => {
  const day = new Date(2026, 8, 29, 0, 1);
  const first = selectDailyQuote(quotes, 'collection', day);
  assert.equal(selectDailyQuote([...quotes].reverse(), 'collection', new Date(2026, 8, 29, 23, 59)).id, first.id);
  assert.notEqual(selectDailyQuote(quotes, 'collection', new Date(2026, 8, 30)).id, first.id);
  assert.notEqual(selectDailyQuote(quotes, 'wishlist', day).id, first.id);
  for (let i = 0; i < 100; i++) assert.equal(selectDailyQuote(quotes, 'collection', day).id, first.id);
  const scoped = [{ ...quotes[0], section: 'collection' }, { ...quotes[1], section: 'wishlist' }];
  assert.equal(selectDailyQuote(scoped, 'collection', day).id, 'a'); assert.equal(selectDailyQuote(scoped, 'wishlist', day).id, 'b');
});
test('invalid/empty sources fall back to no quote; malformed entries ignored, 100 chars not a hard cap', () => {
  for (const source of [null, {}, [], [null, {}, { ...quotes[0], quote: '' }, { ...quotes[0], section: 'invalid' }]]) assert.equal(selectDailyQuote(source, 'collection'), null);
  assert.equal(selectDailyQuote(quotes, 'invalid'), null); assert.equal(selectDailyQuote(quotes, 'collection', new Date('invalid')), null);
  assert.equal(quoteCandidates([quotes[0], quotes[0]], 'collection').length, 1);
  assert.equal(selectDailyQuote([{ ...quotes[0], quote: 'Я'.repeat(150) }], 'collection').quote.length, 150);
});
test('visible quote updates at local midnight and source failure hides block without blocking app', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 8, 29, 23, 59, 59).getTime() });
  const root = { hidden: false, children: [], replaceChildren() { this.children = []; }, append(...nodes) { this.children.push(...nodes); } };
  const document = { querySelector: () => root, createElement: () => ({}), addEventListener() {} }, window = { addEventListener() {} };
  const stop = await bindDailyQuote({ document, window, fetch: async () => ({ ok: true, json: async () => quotes }), section: 'collection' });
  const first = root.children[0].textContent; t.mock.timers.tick(1000);
  assert.notEqual(root.children[0].textContent, first); assert.equal(root.hidden, false); stop();
  const stopFailure = await bindDailyQuote({ document, window, fetch: async () => { throw Error('offline'); }, section: 'collection' });
  assert.equal(root.hidden, true); assert.equal(root.children.length, 0); stopFailure();
});
test('both pages retain hidden accessible heading and compact quote', async () => {
  for (const file of ['index.html', 'wishlist.html']) {
    const html = await readFile(new URL(`../prototype/${file}`, import.meta.url), 'utf8');
    assert.match(html, /<h1 id="section-title" class="visually-hidden">/);
    assert.match(html, /aria-labelledby="section-title"/); assert.ok(!html.includes('Цитата дня'));
  }
});
test('owner catalog: ten valid stable IDs, both sections, verbatim content including newlines and masking', async () => {
  const catalog = JSON.parse(await readFile(new URL('../prototype/data/music-quotes.json', import.meta.url), 'utf8'));
  assert.equal(catalog.length, 10); assert.equal(new Set(catalog.map(q => q.id)).size, 10);
  for (const item of catalog) {
    assert.deepEqual(Object.keys(item).sort(), ['artist', 'id', 'quote', 'section', 'song']);
    assert.match(item.id, /^go-[a-z-]+$/); assert.equal(item.section, 'both');
  }
  // Fingerprint of the exact ten blocks supplied by the owner (not internet content).
  assert.equal(createHash('sha256').update(JSON.stringify(catalog)).digest('hex'), '94e22d02c71fc546a0ec9b67b4a11a509f3a63c811e6498945173da7a2c0ab45');
  const document = { createElement: tag => ({ tag }) };
  const root = { children: [], replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); } };
  for (const item of catalog) {
    renderQuote(document, root, item);
    assert.equal(root.children[0].textContent, item.quote);
    assert.equal(root.children[1].textContent, `${item.artist} — ${item.song}`);
  }
  for (const section of ['collection', 'wishlist']) {
    assert.equal(quoteCandidates(catalog, section).length, 10);
    const day = new Date(2026, 8, 30, 0, 1);
    const current = selectDailyQuote(catalog, section, day);
    assert.equal(selectDailyQuote(catalog, section, new Date(2026, 8, 30, 23, 59)).id, current.id);
    assert.notEqual(selectDailyQuote(catalog, section, new Date(2026, 9, 1)).id, current.id);
  }
  const css = await readFile(new URL('../prototype/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.daily-quote blockquote \{[^}]*white-space: pre-wrap;/);
  assert.ok(!css.includes('-webkit-line-clamp'));
  assert.match(css, /\.daily-quote \{[^}]*padding: 10px 14px;[^}]*border-radius: 8px;[^}]*background:/);
  assert.match(css, /@media \(max-width: 480px\) \{ \.daily-quote \{ padding: 9px 10px;/);
  const stand = await readFile(new URL('../scripts/local-acceptance.mjs', import.meta.url), 'utf8');
  assert.ok(!stand.includes('quoteSource')); // Same catalog endpoint as future production.
});
