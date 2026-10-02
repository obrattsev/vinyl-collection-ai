import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { prototypeUI, response, deferred } from './fixtures/prototype-dom.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { publicRecords } from '../src/public-record.mjs';
const all = node => [node, ...node.children.flatMap(all)];
const content = ui => ui.get(ui.get('#streaming-dialog').open ? '#streaming-content' : '#detail-content');
const closeControl = ui => ui.get(ui.get('#streaming-dialog').open ? '#close-streaming' : '#close-detail');
const dialog = ui => ui.get(ui.get('#streaming-dialog').open ? '#streaming-dialog' : '#detail-dialog');
const find = (ui, text) => all(content(ui)).find(n => n.tagName === 'BUTTON' && n.textContent === text);
const frames = ui => [...all(ui.get('#streaming-content')), ...all(ui.get('#detail-content'))].filter(n => n.tagName === 'IFRAME');
const candidate = { artist: 'Кино', album: 'Группа крови', year: '1988', url: 'https://music.apple.com/ru/album/gruppa-krovi/1333010977' };
const result = { status: 'matched', storefront: 'ru', candidates: [candidate] };
const title = ui => all(ui.get('#records')).find(n => n.className === 'album-streaming-button');
const compactButton = ui => all(ui.get('#mobile-records')).find(n => n.className === 'compact-record');
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
for (const wishlist of [false, true]) for (const owner of [false, true]) for (const compact of [false, true]) {
  test(`3E presentation ${wishlist}/${owner}/${compact}: on-demand, one player, public-only lookup, fallback, teardown and focus`, async () => {
    const source = { ...(wishlist ? wish : record), artist: candidate.artist, album: candidate.album, albumYear: candidate.year }; const calls = [];
    const ui = await prototypeUI(async (url, options) => { calls.push({ url, options }); return response(options?.method ? result : owner ? [source] : publicRecords([source])); }, { wishlist, owner, compact });
    await ui.get('#load-collection').fire('click'); const trigger = compact ? compactButton(ui) : title(ui); trigger.focus(); await trigger.fire('click');
    assert.equal(dialog(ui).open, true); assert.equal(calls.length, 1); assert.equal(frames(ui).length, 0);
    assert.equal(title(ui).tagName, 'BUTTON'); assert.match(title(ui).attributes['aria-label'], /Прослушать альбом: Кино/);
    assert.equal(title(ui).attributes['aria-haspopup'], 'dialog');
    assert.equal(all(ui.get('#mobile-records')).some(n => n.textContent === 'Прослушать'), false);
    await find(ui, 'Прослушать').fire('click'); assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[1].options.body), { artist: candidate.artist, album: candidate.album, albumYear: candidate.year, storefront: 'ru' });
    assert.deepEqual(calls[1].options.headers, { 'Content-Type': 'application/json' });
    assert.equal(frames(ui).length, 1); assert.equal(frames(ui)[0].attributes.referrerpolicy, 'no-referrer');
    assert.equal(frames(ui)[0].src, candidate.url.replace('music.apple.com','embed.music.apple.com'));
    assert.doesNotMatch(frames(ui)[0].attributes.allow, /autoplay/);
    const link = all(content(ui)).find(n => n.tagName === 'A' && n.href === candidate.url);
    assert.equal(link.textContent, 'Открыть в Apple Music ↗'); assert.equal(link.rel, 'noopener noreferrer');
    for (const node of all(content(ui)).filter(n => ['BUTTON','A'].includes(n.tagName))) assert.equal(node.children.flatMap(all).some(n => ['BUTTON','A'].includes(n.tagName)), false);
    await closeControl(ui).fire('click'); assert.equal(frames(ui).length, 0); await tick(); assert.equal(ui.activeElement(), trigger);
    await trigger.fire('click'); assert.equal(frames(ui).length, 0); assert.equal(calls.length, 2); assert.ok(find(ui, 'Прослушать'));
  });
}
test('3E one click automatically searches RU then US; ambiguity still requires candidate selection', async () => {
  const requests = []; const us = { ...candidate, url: 'https://music.apple.com/us/album/gruppa-krovi/123' };
  const ui = await prototypeUI(async (_, options) => {
    if (!options?.method) return response([record]); const body = JSON.parse(options.body); requests.push(body);
    return response(body.storefront === 'ru' ? { status: 'not_found', storefront: 'ru', candidates: [] } : { status: 'ambiguous', storefront: 'us', candidates: [us, { ...us, year: '1990' }] });
  });
  await ui.get('#load-collection').fire('click'); await title(ui).fire('click'); await find(ui, 'Прослушать').fire('click');
  assert.deepEqual(requests.map(r => r.storefront), ['ru', 'us']);
  assert.equal(find(ui, 'Поискать в другом каталоге'), undefined);
  assert.equal(frames(ui).length, 0); await find(ui, 'Кино — Группа крови (1990)').fire('click'); assert.equal(frames(ui).length, 1);
  assert.match(frames(ui)[0].src, /\/us\//); assert.equal(find(ui, 'Поискать в другом каталоге'), undefined);
});
test('3E close aborts pending lookup; stale response never creates player on reopen; duplicate clicks coalesce in UI', async () => {
  const pending = deferred(); let count = 0, signal;
  const ui = await prototypeUI(async (_, options) => { if (!options?.method) return response([record]); count++; signal = options.signal; return pending.promise; });
  await ui.get('#load-collection').fire('click'); await title(ui).fire('click'); const button = find(ui, 'Прослушать');
  const request = button.fire('click'); await button.fire('click'); assert.equal(count, 1);
  await closeControl(ui).fire('click'); assert.equal(signal.aborted, true); await title(ui).fire('click');
  pending.resolve(response(result)); await request; assert.equal(frames(ui).length, 0); assert.ok(find(ui, 'Прослушать'));
});
for (const [error, text] of [['STREAMING_TIMEOUT','слишком много времени'], ['STREAMING_RATE_LIMITED','Слишком много запросов'], ['STREAMING_INVALID_RESPONSE','некорректный ответ'], ['STREAMING_UNAVAILABLE','временно недоступен'], ['INTERNAL_ERROR','ошибки приложения']]) {
  test(`3E ${error} is recoverable and never no-result`, async () => {
    const ui = await prototypeUI(async (_, opts) => opts?.method ? { ok: false, json: async () => ({ error }) } : response([record]));
    await ui.get('#load-collection').fire('click'); await title(ui).fire('click'); await find(ui, 'Прослушать').fire('click');
    assert.equal(frames(ui).length, 0); assert.ok(all(content(ui)).some(n => String(n.textContent).includes(text)));
    assert.ok(find(ui, 'Повторить поиск')); assert.equal(find(ui, 'Поискать в другом каталоге'), undefined); assert.equal(dialog(ui).open, true);
  });
}
test('3E corrupt/unsafe backend candidate cannot create iframe or external link', async () => {
  const ui = await prototypeUI(async (_, opts) => response(opts?.method ? { ...result, candidates: [{ ...candidate, url: 'https://evil.test/ru/album/123' }] } : [record]));
  await ui.get('#load-collection').fire('click'); await title(ui).fire('click'); await find(ui, 'Прослушать').fire('click');
  assert.equal(frames(ui).length, 0); assert.ok(find(ui, 'Повторить поиск'));
});

test('3E breakpoint resize destroys player and returns focus to the visible record', async () => {
  const ui = await prototypeUI(async (_, opts) => response(opts?.method ? result : [record]));
  await ui.get('#load-collection').fire('click'); await title(ui).fire('click'); await find(ui, 'Прослушать').fire('click');
  ui.resize(true); await tick(); assert.equal(ui.get('#detail-dialog').open, false); assert.equal(frames(ui).length, 0);
  assert.equal(ui.activeElement(), ui.get('#mobile-sort-field'));
});
for (const wishlist of [false, true]) test(`3E ${wishlist}: cover-management handoff removes player and metadata edit has no streaming fields`, async () => {
  const source = { ...(wishlist ? wish : record), coverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const ui = await prototypeUI(async (_, opts) => response(opts?.method ? result : [source]), { wishlist, compact: true });
  await ui.get('#load-collection').fire('click'); await compactButton(ui).fire('click'); await find(ui, 'Прослушать').fire('click');
  const replace = all(content(ui)).find(n => n.attributes['aria-label'] === 'Заменить обложку'); await replace.fire('click');
  assert.equal(ui.get('#detail-dialog').open, false); assert.equal(frames(ui).length, 0); assert.equal(ui.get('#cover-dialog').open, true);
  for (const field of ['appleId','appleUrl','streaming','storefront']) assert.equal(ui.input(field), undefined);
});

for (const wishlist of [false, true]) for (const owner of [false, true]) {
  test(`3E accepted desktop table ${wishlist}/${owner}: all columns, terminal row actions, compact streaming only`, async () => {
    const source = wishlist ? wish : record;
    const ui = await prototypeUI(async () => response(owner ? [source] : publicRecords([source])), { wishlist, owner });
    await ui.get('#load-collection').fire('click');
    const row = ui.get('#records').children[0].children[0];
    const text = node => all(node).map(n => String(n.textContent)).join(' ');
    const publicValues = [source.artist, source.album, source.genre, source.additionalGenre, source.label, source.albumYear, source.recordYear, source.editionType, source.note];
    assert.equal(ui.get('#table-container').hidden, false);
    assert.equal(row.children.length, owner ? wishlist ? 12 : 14 : 10);
    for (let i = 0; i < publicValues.length; i++) assert.ok(text(row.children[i + 1]).includes(publicValues[i]));
    const actions = all(row).find(n => n.className === 'row-actions');
    if (owner) {
      assert.equal(row.children.at(-1).children[0], actions);
      assert.deepEqual(actions.children.map(n => n.textContent), ['Удалить', 'Редактировать', ...(wishlist ? ['Добавить в коллекцию'] : [])]);
      if (wishlist) assert.equal(row.children[10].children[0].children[0].href, source.storeUrl);
      else { assert.match(text(row.children[10]), /03.09.2026/); assert.ok(text(row.children[11]).includes(source.purchaseStore)); assert.ok(text(row.children[12]).includes(String(source.purchasePrice))); }
    } else assert.equal(actions, undefined);
    const quick = row.children[0].children[0];
    assert.ok(!quick || quick.children.length <= 2);
    await title(ui).fire('click');
    assert.equal(ui.get('#streaming-dialog').open, true);
    assert.equal(ui.get('#detail-dialog').open, false);
    assert.equal(ui.get('#streaming-title').textContent, `${source.artist} — ${source.album}`);
    assert.equal(all(content(ui)).some(n => n.tagName === 'DL'), false);
    assert.equal(ui.get('#detail-actions').children.length, 0);
    for (const field of ['Жанр', 'Лейбл', 'Примечание', 'Магазин покупки', 'Ссылка']) assert.ok(!text(content(ui)).includes(field));
    assert.equal(all(content(ui)).some(n => n.className === 'favorite-note'), false);
    assert.equal(ui.get('#records').children[0].children[0], row);
    await closeControl(ui).fire('click');
    if (owner) { await actions.children.find(n => n.textContent === 'Удалить').fire('click'); assert.equal(ui.get('#delete-dialog').open, true); }
  });
  test(`3E accepted mobile detail ${wishlist}/${owner}: role-appropriate full metadata and existing actions`, async () => {
    const source = wishlist ? wish : record;
    const ui = await prototypeUI(async () => response(owner ? [source] : publicRecords([source])), { wishlist, owner, compact: true });
    await ui.get('#load-collection').fire('click'); await compactButton(ui).fire('click');
    const terms = ui.get('#detail-content').children[0].children.filter(n => n.tagName === 'DT').map(n => n.textContent);
    assert.equal(terms.length, owner ? wishlist ? 10 : 12 : 9);
    for (const term of ['Исполнитель', 'Альбом', 'Жанр', 'Лейбл', 'Примечание']) assert.ok(terms.includes(term));
    assert.equal(terms.includes('Ссылка'), owner && wishlist); assert.equal(terms.includes('Магазин покупки'), owner && !wishlist);
    assert.deepEqual(ui.get('#detail-actions').children.map(n => n.textContent), owner ? ['Редактировать', 'Удалить', ...(wishlist ? ['Добавить в коллекцию'] : [])] : []);
    assert.ok(find(ui, 'Прослушать')); assert.equal(frames(ui).length, 0);
  });
}
for (const outcome of ['matched', 'not_found', 'failure']) test(`3E automatic fallback ${outcome}: one click, terminal result, no storefront controls`, async () => {
  const calls = [];
  const ui = await prototypeUI(async (_, opts) => {
    if (!opts?.method) return response([record]);
    const region = JSON.parse(opts.body).storefront; calls.push(region);
    if (region === 'ru') return response({ status:'not_found', storefront:'ru', candidates:[] });
    if (outcome === 'failure') return { ok:false, json:async () => ({ error:'STREAMING_TIMEOUT' }) };
    return response({ status:outcome, storefront:'us', candidates:outcome === 'matched' ? [{ ...candidate, url:'https://music.apple.com/us/album/gruppa-krovi/123' }] : [] });
  });
  await ui.get('#load-collection').fire('click'); await title(ui).fire('click'); await find(ui, 'Прослушать').fire('click');
  assert.deepEqual(calls, ['ru','us']); assert.equal(find(ui, 'Поискать в другом каталоге'), undefined);
  assert.equal(frames(ui).length, outcome === 'matched' ? 1 : 0);
  assert.equal(all(content(ui)).some(n => n.textContent === 'Альбом не найден'), outcome === 'not_found');
  if (outcome === 'failure') assert.ok(find(ui,'Повторить поиск'));
});
test('3E close during RU prevents automatic US; RU ambiguity never falls through to another storefront', async () => {
  for (const close of [true,false]) {
    const wait = deferred(), calls = [];
    const ui = await prototypeUI(async (_, opts) => { if (!opts?.method) return response([record]); calls.push(JSON.parse(opts.body).storefront); return wait.promise; });
    await ui.get('#load-collection').fire('click'); await title(ui).fire('click'); const work = find(ui,'Прослушать').fire('click');
    if (close) await closeControl(ui).fire('click');
    wait.resolve(response({ ...result, status:close ? 'not_found' : 'ambiguous', candidates:close ? [] : [candidate] })); await work;
    assert.deepEqual(calls,['ru']); assert.equal(frames(ui).length,0);
  }
});
test('3E keeps accepted CSS table overflow and 1120px breakpoint; browser acceptance measures actual geometry', async () => {
  const css = await readFile(new URL('../prototype/styles.css', import.meta.url), 'utf8');
  assert.match(css,/\.table-container \{[^}]*max-width: 100%;[^}]*overflow-x: auto;/);
  assert.match(css,/@media \(max-width: 1120px\) \{\s*#table-container \{ display: none; \}\s*#mobile-results \{ display: block;/);
  assert.match(css,/\.row-actions button \{[^}]*flex-shrink: 0;[^}]*white-space: nowrap;/);
});

for (const wishlist of [false, true]) for (const owner of [false, true]) test(`3E independent Cover vs Album ${wishlist}/${owner}`, async () => {
  const source = { ...(wishlist ? wish : record), coverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const ui = await prototypeUI(async () => response(owner ? [source] : publicRecords([source])), { wishlist, owner });
  await ui.get('#load-collection').fire('click');
  const cover = all(ui.get('#records')).find(n => n.className === 'cover-control');
  await cover.fire('click');
  assert.equal(ui.get('#cover-dialog').open, true); assert.equal(ui.get('#streaming-dialog').open, false);
  assert.equal(ui.get('#cover-title').textContent, `Обложка: ${source.artist} — ${source.album}`);
  assert.equal(ui.get('#cover-owner-controls').hidden, !owner); assert.equal(frames(ui).length, 0);
  await ui.get('#close-cover').fire('click'); await title(ui).fire('click');
  assert.equal(ui.get('#cover-dialog').open, false); assert.equal(ui.get('#streaming-dialog').open, true);
  assert.equal(all(content(ui)).filter(n => n.tagName === 'BUTTON').length, 1);
  assert.ok(find(ui, 'Прослушать')); assert.equal(ui.get('#detail-actions').children.length, 0);
});
test('3E targeted table fixes: native scrollbar, same row action layout; no fixed row height', async () => {
  const css = await readFile(new URL('../prototype/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.table-container::-webkit-scrollbar \{ height: 14px;/);
  assert.match(css, /\.table-container::-webkit-scrollbar-thumb/);
  assert.doesNotMatch(css, /body\[data-section="wishlist"\] \.row-actions/);
  assert.doesNotMatch(css, /(?:tr|td)\s*\{[^}]*(?:min-height|height):/);
  assert.doesNotMatch(css, /#detail-content\s*>\s*dl|#detail-content:not/);
});
