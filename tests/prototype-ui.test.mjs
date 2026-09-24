import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeUI, response, deferred } from './fixtures/prototype-dom.mjs';
import { record } from './fixtures/collection.mjs';
import { GENRES } from '../src/genres.mjs';

async function prepareAddition(ui) {
  await ui.get('#add-record').fire('click');
  const { id, ...draft } = record;
  ui.fill({ ...draft, purchaseDate: '03-09-2026' });
  await ui.get('#record-form').fire('submit');
  assert.equal(ui.get('#confirm-record').hidden, false);
}

test('POST before an older GET forces a fresh GET; the late old response cannot hide the new row', async () => {
  const old = deferred(); const calls = [];
  const ui = await prototypeUI(async (url, options = {}) => {
    calls.push(options.method ?? 'GET');
    if (calls.length === 1) return old.promise;
    if (options.method === 'POST') return response(record);
    return response(calls.includes('POST') ? [record] : []);
  });
  const loading = ui.run('showCollection()');
  await prepareAddition(ui);
  await ui.get('#confirm-record').fire('click');
  assert.deepEqual(calls, ['GET', 'GET', 'GET', 'POST', 'GET']);
  old.resolve(response([])); await loading;
  assert.equal(ui.get('#status').textContent, 'Показано записей: 1');
  assert.equal(ui.get('#table-container').hidden, false);
  assert.match(ui.get('#operation-status').textContent, /^Добавлено:/);
});

test('DELETE before an older GET forces a fresh GET; a late response cannot resurrect a deleted row', async () => {
  const old = deferred(); const calls = [];
  const ui = await prototypeUI(async (url, options = {}) => {
    calls.push(options.method ?? 'GET');
    if (calls.length === 1) return old.promise;
    return response(options.method === 'DELETE' ? record : []);
  });
  ui.run(`openDelete(${JSON.stringify(record)})`);
  const loading = ui.run('showCollection()');
  await ui.get('#confirm-delete').fire('click');
  assert.deepEqual(calls, ['GET', 'DELETE', 'GET']);
  old.resolve(response([record])); await loading;
  assert.equal(ui.get('#status').textContent, 'Коллекция пуста');
  assert.equal(ui.get('#table-container').hidden, true);
  assert.match(ui.get('#operation-status').textContent, /^Удалено:/);
});

test('a stale GET failure cannot replace the successful refresh with a load error', async () => {
  const old = deferred(); let calls = 0;
  const ui = await prototypeUI(async () => ++calls === 1 ? old.promise : response([record]));
  const pending = ui.run('showCollection()'); await ui.run('showCollection()');
  old.reject(new Error('late network failure')); await pending;
  assert.equal(ui.get('#error').hidden, true);
  assert.equal(ui.get('#status').textContent, 'Показано записей: 1');
  assert.equal(ui.get('#load-collection').disabled, false);
});

test('a read started before an uncertain POST cannot unlock further changes', async () => {
  const old = deferred(); let calls = 0;
  const ui = await prototypeUI(async (url, options = {}) => {
    if (++calls === 1) return old.promise;
    if (options.method === 'POST') return { ok: false, json: async () => ({ error: 'RESULT_UNCONFIRMED' }) };
    return response([]);
  });
  const pending = ui.run('showCollection()'); await prepareAddition(ui);
  await ui.get('#confirm-record').fire('click');
  old.resolve(response([])); await pending;
  assert.equal(ui.get('#add-record').disabled, true);
  assert.equal(ui.get('#load-collection').disabled, false);
  assert.match(ui.get('#status').textContent, /Обновите коллекцию/);
  await ui.run('showCollection()');
  assert.equal(ui.get('#add-record').disabled, false);
});

test('empty and invalid fields receive accessible field feedback and clear after correction', async () => {
  const ui = await prototypeUI(async () => response([]));
  await ui.get('#add-record').fire('click');
  await ui.get('#record-form').fire('submit');
  assert.equal(ui.get('#record-error').textContent, 'Проверьте заполнение обязательных полей, формат даты и цены.');
  for (const name of ['artist', 'album', 'albumYear']) {
    assert.equal(ui.input(name).attributes['aria-invalid'], 'true');
    assert.equal(ui.input(name).attributes['aria-describedby'], `error-${name}`);
    assert.equal(ui.get(`#error-${name}`).hidden, false);
  }
  ui.fill({ artist: 'New', album: 'New', albumYear: '2026', purchaseDate: '30-02-2026', purchasePrice: '-1', genre: 'Jazz', additionalGenre: 'Jazz' });
  await ui.get('#record-form').fire('input');
  for (const field of ['purchaseDate', 'purchasePrice', 'genre', 'additionalGenre']) assert.equal(ui.input(field).attributes['aria-invalid'], 'true');
  assert.equal(ui.input('artist').attributes['aria-invalid'], 'false');
  ui.fill({ purchaseDate: '29-02-2024', purchasePrice: '12.50', additionalGenre: 'Blues' });
  await ui.get('#record-form').fire('change');
  for (const field of ['purchaseDate', 'purchasePrice', 'genre', 'additionalGenre']) assert.equal(ui.input(field).attributes['aria-invalid'], 'false');
  assert.equal(ui.get('#record-error').textContent, '');
});

test('both optional genre selectors use exactly the shared closed catalog', async () => {
  const ui = await prototypeUI(async () => response([]));
  assert.equal(GENRES.length, 31); assert.equal(new Set(GENRES).size, 31);
  for (const field of ['genre', 'additionalGenre']) {
    const input = ui.input(field);
    assert.equal(input.tagName, 'SELECT');
    assert.deepEqual(input.children.map(option => option.value), ['', ...GENRES]);
    assert.ok(!input.required);
  }
});

test('both searches bind the four-digit year constraint, share the genre catalog and clear without fetching', async () => {
  for (const wishlist of [false,true]) {
    let calls = 0;
    const ui = await prototypeUI(async () => { calls++; return response([]); }, {wishlist});
    const year = ui.searchInput('albumYear');
    year.value = '1979'; await year.fire('input');
    for (const invalid of ['19790','19x9','1e03']) { year.value = invalid; await year.fire('input'); assert.equal(year.value,'1979'); }
    year.setSelectionRange(0,4);
    await year.fire('paste',{clipboardData:{getData:()=> '20001'}}); assert.equal(year.value,'1979');
    await year.fire('paste',{clipboardData:{getData:()=> '1986'}}); assert.equal(year.value,'1986');
    assert.deepEqual(ui.get('#search-genre').children.map(option => option.value), ['',...GENRES]);
    const before = calls; ui.get('#search-form').reset(); assert.equal(year.value,''); assert.equal(calls,before);
    year.value = 'bad'; await year.fire('input'); assert.equal(year.value,'');
  }
});
