import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeUI, response, deferred } from './fixtures/prototype-dom.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { publicRecords } from '../src/public-record.mjs';
const buttons = ui => ui.get('#mobile-records').querySelectorAll('button');
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
for (const wishlist of [false, true]) for (const owner of [false, true]) {
  test(`3B ${wishlist}/${owner}: compact detail fields, shared sorting and viewport-independent CSV without resize GET`, async () => {
    const source = wishlist ? wish : record;
    const data = [{ ...source, artist: 'Z', note: 'long\ntext' }, { ...source, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', artist: 'A' }];
    let reads = 0;
    const ui = await prototypeUI(async () => { reads++; return response(owner ? data : publicRecords(data)); }, { wishlist, owner, compact: true });
    await ui.get('#load-collection').fire('click');
    assert.equal(buttons(ui).length, 2); assert.equal(buttons(ui)[0].children.length, 3);
    assert.equal(buttons(ui)[0].children[0].textContent, 'A');
    assert.equal(buttons(ui)[0].children[2].textContent, `${source.albumYear} · ${source.genre}`);
    assert.equal(buttons(ui)[0].children[2].className, 'compact-metadata');
    await buttons(ui)[0].fire('click');
    assert.equal(ui.get('#detail-dialog').open, true);
    const detail = text(ui.get('#detail-content'));
    assert.ok(!detail.includes(data[1].id)); assert.equal(ui.get('#detail-content').children[0].children.length, (owner ? wishlist ? 10 : 12 : 9) * 2);
    assert.equal(ui.get('#detail-actions').children.length, owner ? wishlist ? 3 : 2 : 0);
    if (!wishlist) assert.equal(detail.includes('Дата покупки'), owner);
    await ui.get('#close-detail').fire('click'); await tick(); assert.equal(ui.activeElement(), buttons(ui)[0]);
    ui.get('#mobile-sort-field').value = 'artist'; await ui.get('#mobile-sort-field').fire('change');
    await ui.get('#mobile-sort-direction').fire('click'); assert.equal(buttons(ui)[0].children[0].textContent, 'Z');
    assert.equal(ui.get('#sort-heading-artist').attributes['aria-sort'], 'descending');
    await ui.get('#download-records').fire('click'); const mobileCsv = await (await fetch(ui.downloads.at(-1))).text();
    ui.resize(false); await ui.get('#download-records').fire('click'); const desktopCsv = await (await fetch(ui.downloads.at(-1))).text();
    assert.equal(desktopCsv, mobileCsv); assert.equal(reads, 1);
    await ui.get('#sort-albumYear').fire('click'); assert.equal(ui.get('#mobile-sort-field').value, 'albumYear');
    ui.resize(true); ui.get('#mobile-sort-field').value = ''; await ui.get('#mobile-sort-field').fire('change');
    assert.equal(ui.run('activeSort'), null); assert.equal(ui.get('#mobile-sort-direction').disabled, true);
    assert.equal(buttons(ui)[0].children[0].textContent, 'A'); assert.equal(reads, 1);
  });
}
for (const wishlist of [false, true]) test(`3B ${wishlist}: detail handoff reuses CRUD, cancel focus, successful edit/delete refresh without reopening`, async () => {
  let source = { ...(wishlist ? wish : record) }; let exists = true; const writes = [];
  const ui = await prototypeUI(async (url, options = {}) => {
    if (options.method) {
      writes.push(options.method);
      if (options.method === 'PUT') source = { ...JSON.parse(options.body), id: source.id };
      if (options.method === 'DELETE') exists = false;
      return response(source);
    }
    return response(wishlist && url === '/api/collection' ? [] : exists ? [source] : []);
  }, { wishlist, compact: true });
  await ui.get('#load-collection').fire('click'); await buttons(ui)[0].fire('click');
  await ui.get('#detail-actions').children[0].fire('click');
  assert.equal(ui.get('#detail-dialog').open, false); assert.equal(ui.get('#record-dialog').open, true);
  await ui.get('#cancel-record').fire('click'); await tick(); assert.equal(ui.activeElement(), buttons(ui)[0]); assert.deepEqual(writes, []);
  await buttons(ui)[0].fire('click'); await ui.get('#detail-actions').children[0].fire('click');
  ui.fill({ note: 'Changed from mobile' }); await ui.get('#record-form').fire('submit'); await ui.get('#confirm-record').fire('click');
  assert.deepEqual(writes, ['PUT']); assert.equal(ui.get('#detail-dialog').open, false); assert.equal(ui.run('displayedRecords[0].note'), 'Changed from mobile');
  await buttons(ui)[0].fire('click'); await ui.get('#detail-actions').children[1].fire('click');
  assert.equal(ui.get('#delete-dialog').open, true); assert.equal(ui.get('#detail-dialog').open, false);
  await ui.get('#cancel-delete').fire('click'); await tick(); assert.equal(ui.activeElement(), buttons(ui)[0]);
  await buttons(ui)[0].fire('click'); await ui.get('#detail-actions').children[1].fire('click'); await ui.get('#confirm-delete').fire('click');
  assert.deepEqual(writes, ['PUT', 'DELETE']); assert.equal(buttons(ui).length, 0); assert.equal(ui.activeElement(), ui.get('#status'));
});
test('3B wishlist transfer action opens existing transfer flow without nested modal, cancel returns focus', async () => {
  const ui = await prototypeUI(async () => response([wish]), { wishlist: true, compact: true });
  await ui.get('#load-collection').fire('click'); await buttons(ui)[0].fire('click'); await ui.get('#detail-actions').children[2].fire('click');
  assert.equal(ui.get('#detail-dialog').open, false); assert.equal(ui.run('transferSource.id'), wish.id); assert.equal(ui.get('#record-dialog').open, true);
  await ui.get('#cancel-record').fire('click'); await tick(); assert.equal(ui.activeElement(), buttons(ui)[0]);
});
test('3B logout clears owner detail/list and stale GET cannot repopulate either', async () => {
  const delayed = deferred(); let calls = 0;
  const ui = await prototypeUI(async () => ++calls === 1 ? response([record]) : delayed.promise, { compact: true });
  await ui.get('#load-collection').fire('click'); await buttons(ui)[0].fire('click');
  ui.run("applySession({ role: 'guest' })");
  assert.equal(ui.get('#detail-dialog').open, false); assert.equal(ui.get('#detail-content').children.length, 0); assert.equal(buttons(ui).length, 0);
  const pending = ui.run('showCollection()'); ui.run('resetResults()'); delayed.resolve(response(publicRecords([record]))); await pending;
  assert.equal(buttons(ui).length, 0);
});
test('3B resize closes detail without resetting search/sort or requesting records', async () => {
  let reads = 0; const ui = await prototypeUI(async () => { reads++; return response([record]); }, { compact: true });
  ui.searchInput('artist').value = record.artist; await ui.get('#search-form').fire('submit');
  await ui.get('#sort-artist').fire('click'); await buttons(ui)[0].fire('click'); ui.resize(false); await tick();
  assert.equal(ui.get('#detail-dialog').open, false); assert.equal(ui.activeElement(), ui.get('#table-container'));
  assert.equal(ui.run('lastCriteria.artist'), record.artist); assert.equal(ui.run('activeSort.field'), 'artist'); assert.equal(reads, 1);
});
for (const wishlist of [false, true]) for (const owner of [false, true]) test(`3B report ${wishlist}/${owner} sends exactly text/section, prevents double submit and clears only verified success`, async () => {
  const wait = deferred(); const calls = [];
  const ui = await prototypeUI(async (url, options) => { calls.push({ url, options }); return wait.promise; }, { wishlist, owner });
  await ui.get('#open-report').fire('click'); assert.equal(ui.get('#report-dialog').open, true);
  ui.get('#report-text').value = '😀'.repeat(2000); await ui.get('#report-text').fire('input');
  assert.equal(ui.get('#report-counter').textContent, '2000 / 2000'); assert.equal(ui.get('#send-report').disabled, false);
  const submit = ui.get('#report-form').fire('submit'); await ui.get('#report-form').fire('submit'); await ui.get('#close-report').fire('click');
  assert.equal(calls.length, 1); assert.equal(ui.get('#report-dialog').open, true);
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: '😀'.repeat(2000), section: wishlist ? 'wishlist' : 'collection' });
  assert.deepEqual(Object.keys(calls[0].options.headers), ['Content-Type']);
  wait.resolve({ status: 201, json: async () => ({ id: record.id }) }); await submit;
  assert.equal(ui.get('#report-text').value, ''); assert.equal(ui.get('#report-dialog').open, false);
  assert.equal(ui.get('#report-success').textContent, 'Сообщение отправлено');
});
test('3B report keeps draft for errors/uncertainty/cancel, shows retry and refuses oversized text', async () => {
  let mode = 'rate'; let calls = 0;
  const ui = await prototypeUI(async () => {
    calls++;
    if (mode === 'network') throw Error('offline');
    return { status: mode === 'rate' ? 429 : mode === 'malformed' ? 201 : 503,
      headers: { get: () => '900' }, json: async () => mode === 'malformed' ? {} : ({ error: mode === 'unconfigured' ? 'REPORT_NOT_CONFIGURED' : 'RESULT_UNCONFIRMED' }) };
  }, { owner: false });
  await ui.get('#open-report').fire('click'); ui.get('#report-text').value = 'Draft';
  for (mode of ['rate', 'network', 'malformed', 'unconfigured', 'uncertain']) {
    await ui.get('#report-form').fire('submit'); assert.equal(ui.get('#report-text').value, 'Draft'); assert.equal(ui.get('#report-dialog').open, true);
    if (mode === 'rate') assert.match(ui.get('#report-status').textContent, /900/);
  }
  await ui.get('#close-report').fire('click'); await ui.get('#open-report').fire('click'); assert.equal(ui.get('#report-text').value, 'Draft');
  ui.get('#report-text').value = '😀'.repeat(2001); await ui.get('#report-text').fire('input'); await ui.get('#report-form').fire('submit');
  assert.equal(ui.get('#send-report').disabled, true); assert.equal(calls, 5);
});

test('3B resize transfers keyboard focus between visible result presentations without fetching', async () => {
  let reads = 0; const ui = await prototypeUI(async () => { reads++; return response([record]); }, { compact: true });
  await ui.get('#load-collection').fire('click'); buttons(ui)[0].focus(); ui.resize(false);
  assert.equal(ui.activeElement(), ui.get('#table-container'));
  ui.resize(true); assert.equal(ui.activeElement(), ui.get('#mobile-sort-field')); assert.equal(reads, 1);
});
test('3B report cannot open over an existing CRUD dialog or detail', async () => {
  const ui = await prototypeUI(async () => response([record]), { compact: true });
  await ui.get('#load-collection').fire('click'); await buttons(ui)[0].fire('click');
  await ui.get('#open-report').fire('click'); assert.equal(ui.get('#report-dialog').open, false);
  await ui.get('#detail-actions').children[0].fire('click');
  await ui.get('#open-report').fire('click'); assert.equal(ui.get('#report-dialog').open, false);
});

test('3B report clear resets draft/error/counter without closing; close preserves draft', async () => {
  const ui = await prototypeUI(async () => { throw Error('offline'); }, { owner: false });
  await ui.get('#open-report').fire('click'); ui.get('#report-text').value = 'Draft';
  await ui.get('#report-form').fire('submit'); assert.ok(ui.get('#report-status').textContent);
  await ui.get('#clear-report').fire('click');
  assert.equal(ui.get('#report-dialog').open, true); assert.equal(ui.get('#report-text').value, '');
  assert.equal(ui.get('#report-status').textContent, ''); assert.equal(ui.get('#report-counter').textContent, '0 / 2000');
  assert.equal(ui.get('#send-report').disabled, true); assert.equal(ui.activeElement(), ui.get('#report-text'));
  ui.get('#report-text').value = 'Keep me'; await ui.get('#close-report').fire('click');
  assert.equal(ui.get('#report-dialog').open, false);
  await ui.get('#open-report').fire('click'); assert.equal(ui.get('#report-text').value, 'Keep me');
});
test('3B report sending blocks clearing, close and Escape without losing text', async () => {
  const wait = deferred(); const ui = await prototypeUI(async () => wait.promise, { owner: false });
  await ui.get('#open-report').fire('click'); ui.get('#report-text').value = 'Sending';
  const task = ui.get('#report-form').fire('submit');
  await ui.get('#clear-report').fire('click'); await ui.get('#close-report').fire('click');
  let prevented = false; await ui.get('#report-dialog').fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(ui.get('#report-dialog').open, true); assert.equal(ui.get('#report-text').value, 'Sending');
  wait.resolve({ status: 500, json: async () => ({ error: 'RESULT_UNCONFIRMED' }) }); await task;
  prevented = false; await ui.get('#report-dialog').fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false); assert.equal(ui.get('#clear-report').disabled, false);
});
test('3B accepted markup keeps sort controls grouped, helper exact, close labelled and shared detail sizing', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['index.html', 'wishlist.html']) {
    const html = await readFile(new URL(`../prototype/${file}`, import.meta.url), 'utf8');
    assert.match(html, /class="mobile-sort-controls"><select id="mobile-sort-field"><\/select><button id="mobile-sort-direction"/);
    assert.match(html, /id="report-help" class="notice">Не указывайте пароли и личные данные<\/p>/);
    assert.match(html, /id="close-report"[^>]*aria-label="Закрыть">×/);
    assert.match(html, /id="clear-report"[^>]*>Очистить/);
    assert.match(html, /id="report-success"[^>]*role="status"/);
  }
  const css = await readFile(new URL('../prototype/styles.css', import.meta.url), 'utf8');
  assert.match(css, /#close-detail, \.detail-actions button \{ height: auto; min-height: 44px; padding: 12px; \}/);
});

test('3B success status expires and reopening report cancels the previous status timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = await prototypeUI(async () => ({ status: 201, json: async () => ({ id: record.id }) }), { owner: false });
  await ui.get('#open-report').fire('click'); ui.get('#report-text').value = 'Sent'; await ui.get('#report-form').fire('submit');
  t.mock.timers.tick(4999); assert.equal(ui.get('#report-success').textContent, 'Сообщение отправлено');
  t.mock.timers.tick(1); assert.equal(ui.get('#report-success').textContent, '');
  await ui.get('#open-report').fire('click'); ui.get('#report-text').value = 'Again'; await ui.get('#report-form').fire('submit');
  await ui.get('#open-report').fire('click'); assert.equal(ui.get('#report-success').textContent, '');
  ui.get('#report-text').value = 'New draft'; t.mock.timers.tick(5000);
  assert.equal(ui.get('#report-text').value, 'New draft'); assert.equal(ui.get('#report-dialog').open, true);
});
