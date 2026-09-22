import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeUI, response, deferred } from './fixtures/prototype-dom.mjs';
import { wish, wishDraft, purchase } from './fixtures/wishlist.mjs';
import { record } from './fixtures/collection.mjs';
const uiFor = fetch => prototypeUI(fetch, { wishlist: true });
async function addPreview(ui, draft = wishDraft) {
  await ui.get('#add-record').fire('click'); ui.fill(draft); await ui.get('#record-form').fire('submit');
}
test('wishlist GET distinguishes empty, no matches and source failure; clear is read-only', async () => {
  let records = []; let fail = false; let calls = 0;
  const ui = await uiFor(async () => { calls++; if (fail) throw Error('source'); return response(records); });
  await ui.run('showCollection()'); assert.equal(ui.get('#status').textContent, 'Wish-list пуст');
  records = [wish]; await ui.run(`showCollection({album: 'missing'})`);
  assert.match(ui.get('#status').textContent, /По поисковому запросу/);
  const count = calls; await ui.get('#search-form').fire('reset'); assert.equal(calls, count);
  fail = true; await ui.run('showCollection()'); assert.equal(ui.get('#error').hidden, false); assert.equal(ui.get('#status').textContent, '');
});
test('wishlist form includes URL feedback, shared genres and warnings for a different owned edition', async () => {
  const ui = await uiFor(async url => response(url === '/api/collection' ? [record] : []));
  await addPreview(ui, { ...wishDraft, storeUrl: 'invalid' });
  assert.equal(ui.input('storeUrl').attributes['aria-invalid'], 'true');
  assert.equal(ui.input('purchasePrice').disabled, true);
  ui.fill({ ...wishDraft, label: 'Different edition' }); await ui.get('#record-form').fire('submit');
  assert.match(ui.get('#record-error').textContent, /Этот альбом уже есть/);
  assert.equal(ui.get('#confirm-record').hidden, false);
  assert.equal(ui.input('genre').tagName, 'SELECT');
});
test('wishlist confirmed duplicate blocks confirmation; cancellation makes no write', async () => {
  const methods = [];
  const ui = await uiFor(async (url, options = {}) => { methods.push(options.method ?? 'GET'); return response(url === '/api/collection' ? [record] : []); });
  await addPreview(ui);
  assert.match(ui.get('#record-error').textContent, /Подтверждённый дубль/);
  assert.equal(ui.get('#confirm-record').hidden, true);
  await ui.get('#cancel-record').fire('click'); assert.equal(methods.includes('POST'), false);
  ui.run(`openDelete(${JSON.stringify(wish)})`); await ui.get('#cancel-delete').fire('click'); assert.equal(methods.includes('DELETE'), false);
});
test('late wishlist GET cannot overwrite POST/DELETE refreshes', async () => {
  for (const method of ['POST', 'DELETE']) {
    const old = deferred(); let first = true; let mutated = false;
    const ui = await uiFor(async (url, options = {}) => {
      if (url === '/api/collection') return response([]);
      if (options.method === method) { mutated = true; return response(wish); }
      if (first) { first = false; return old.promise; }
      return response(method === 'POST' && mutated ? [wish] : []);
    });
    const loading = ui.run('showCollection()');
    if (method === 'POST') { await addPreview(ui); await ui.get('#confirm-record').fire('click'); }
    else { ui.run(`openDelete(${JSON.stringify(wish)})`); await ui.get('#confirm-delete').fire('click'); }
    old.resolve(response(method === 'POST' ? [] : [wish])); await loading;
    assert.equal(ui.get('#status').textContent, method === 'POST' ? 'Показано записей: 1' : 'Wish-list пуст');
  }
});
test('transfer UI sends one server operation and refreshes both lists despite a late wishlist GET', async () => {
  const old = deferred(); let first = true; let moved = false; const mutations = [];
  const ui = await uiFor(async (url, options = {}) => {
    if (options.method === 'POST') { mutations.push({ url, ...options }); moved = true; return response({ status: 'complete', collectionRecord: record, wishlistId: wish.id }); }
    if (url === '/api/collection') return response(moved ? [record] : []);
    if (first) { first = false; return old.promise; }
    return response(moved ? [] : [wish]);
  });
  const loading = ui.run('showCollection()');
  await ui.run(`openTransfer(${JSON.stringify(wish)})`); ui.fill(purchase); await ui.get('#record-form').fire('submit');
  await ui.get('#confirm-record').fire('click');
  old.resolve(response([wish])); await loading;
  assert.equal(mutations.length, 1); assert.equal(mutations[0].url, `/api/wishlist/${wish.id}/transfer`);
  assert.deepEqual(JSON.parse(mutations[0].body), purchase);
  assert.equal(ui.get('#status').textContent, 'Wish-list пуст'); assert.equal(ui.get('#add-record').disabled, false);
  assert.match(ui.get('#operation-status').textContent, /Перенесено/);
});
test('partial transfer remains visible and retry selects existing record without creating another', async () => {
  let owned = false; const mutations = [];
  const ui = await uiFor(async (url, options = {}) => {
    if (options.method === 'POST') { mutations.push(JSON.parse(options.body)); owned = true; return response({ status: 'partial', collectionRecord: record, wishlistId: wish.id }); }
    return response(url === '/api/collection' ? (owned ? [record] : []) : [wish]);
  });
  await ui.run(`openTransfer(${JSON.stringify(wish)})`); ui.fill(purchase); await ui.get('#record-form').fire('submit'); await ui.get('#confirm-record').fire('click');
  assert.match(ui.get('#operation-status').textContent, /Частичный успех/); assert.equal(ui.get('#status').textContent, 'Показано записей: 1');
  await ui.run(`openTransfer(${JSON.stringify(wish)})`); await ui.get('#record-form').fire('submit');
  const choose = ui.get('#record-preview').children[0].children.at(-1); await choose.fire('click');
  assert.match(ui.get('#confirm-record').textContent, /Подтвердить удаление/);
  await ui.get('#confirm-record').fire('click');
  assert.deepEqual(Object.keys(mutations[1]).sort(), ['collectionId', 'collectionRevision']);
  assert.equal(mutations[1].collectionId, record.id);
});
test('uncertain transfer automatically refreshes both sources; an old GET cannot replace the result', async () => {
  const old = deferred(); let first = true;
  const ui = await uiFor(async (url, options = {}) => {
    if (options.method === 'POST') throw Error('network');
    if (url === '/api/collection') return response([]);
    if (first) { first = false; return old.promise; }
    return response([wish]);
  });
  const pending = ui.run('showCollection()');
  await ui.run(`openTransfer(${JSON.stringify(wish)})`); ui.fill(purchase); await ui.get('#record-form').fire('submit'); await ui.get('#confirm-record').fire('click');
  old.resolve(response([wish])); await pending;
  assert.equal(ui.get('#add-record').disabled, false);
  assert.equal(ui.get('#status').textContent, 'Показано записей: 1');
  assert.match(ui.get('#operation-status').textContent, /Результат переноса не подтверждён/);
});
test('cancelled async preview cannot reopen or disable the next form', async () => {
  const wait = deferred(); let delayed = false;
  const ui = await uiFor(async () => delayed ? wait.promise : response([]));
  await ui.get('#add-record').fire('click'); ui.fill(wishDraft); delayed = true;
  const preview = ui.get('#record-form').fire('submit');
  await ui.get('#cancel-record').fire('click'); delayed = false;
  await ui.get('#add-record').fire('click');
  wait.resolve(response([])); await preview;
  assert.equal(ui.get('#record-fields').disabled, false); assert.equal(ui.get('#confirm-record').hidden, true);
});
test('an old collection refresh cannot unlock or replace the state after a wishlist mutation', async () => {
  const old = deferred(); let collectionCalls = 0;
  const ui = await uiFor(async url => {
    if (url === '/api/collection' && ++collectionCalls === 1) return old.promise;
    return response([]);
  });
  const pending = ui.run('refreshBoth()');
  await new Promise(resolve => setImmediate(resolve));
  ui.run('invalidateReads(); requireRefresh()');
  old.resolve(response([record])); await pending;
  assert.equal(ui.get('#add-record').disabled, true);
  assert.equal(ui.get('#records').children.length, 0);
  await ui.run('refreshBoth()'); assert.equal(ui.get('#add-record').disabled, false);
});
test('failed refresh of either list leaves partial-transfer recovery locked', async () => {
  for (const failing of ['/api/wishlist', '/api/collection']) {
    const ui = await uiFor(async url => { if (url === failing) throw Error('offline'); return response([]); });
    await ui.run('refreshBoth()'); assert.equal(ui.get('#add-record').disabled, true);
  }
});

test('partial transfer preserves actual wishlist and its success message if collection refresh fails; ordinary search recovers', async () => {
  let moved = false, offline = false; const reads = [];
  const ui = await uiFor(async (url, options = {}) => {
    if (options.method === 'POST') { moved = offline = true; return response({status:'partial',collectionRecord:record,wishlistId:wish.id}); }
    reads.push(url);
    if (url === '/api/collection') { if (offline) throw Error('offline'); return response(moved ? [record] : []); }
    return response([wish]);
  });
  await ui.run(`openTransfer(${JSON.stringify(wish)})`); ui.fill(purchase); await ui.get('#record-form').fire('submit'); await ui.get('#confirm-record').fire('click');
  assert.match(ui.get('#operation-status').textContent,/Частичный успех.*подтверждена в коллекции/);
  assert.equal(ui.get('#status').textContent,'Показано записей: 1');
  assert.match(ui.get('#error').textContent,/не удалось проверить основную коллекцию/);
  assert.equal(ui.get('#add-record').disabled,true);
  assert.ok(ui.get('#records').querySelectorAll('button').every(button => button.disabled));
  offline = false; reads.length = 0; await ui.run('showCollection()');
  assert.deepEqual(reads,['/api/wishlist','/api/collection']);
  assert.equal(ui.get('#add-record').disabled,false);
  assert.ok(ui.get('#records').querySelectorAll('button').every(button => !button.disabled));
});
