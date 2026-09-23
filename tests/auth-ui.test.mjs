import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeUI, response, deferred } from './fixtures/prototype-dom.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { publicRecords } from '../src/public-record.mjs';

for (const wishlist of [false, true]) test(`guest ${wishlist ? 'wishlist' : 'collection'} defers data GET and searches without UUID or mutation controls`, async () => {
  const calls = []; const source = wishlist ? wish : record;
  const ui = await prototypeUI(async url => { calls.push(url); return response(url === '/api/auth/session' ? { role: 'guest' } : publicRecords([source])); }, { owner: false, wishlist });
  await ui.start(); assert.equal(ui.get('#table-container').hidden, true);
  assert.deepEqual(calls, ['/api/auth/session']);
  assert.equal(ui.get('#add-record').hidden, true); assert.equal(ui.get('#actions-heading').hidden, true);
  assert.equal(ui.get('#auth-status').textContent, '');
  assert.equal(ui.get('#records').querySelectorAll('button').length, 0);
  await ui.run(`showCollection({artist:${JSON.stringify(source.artist)}})`);
  assert.equal(ui.get('#status').textContent, 'Показано записей: 1');
  const count = calls.length; await ui.get('#add-record').fire('click'); await ui.get('#confirm-delete').fire('click');
  assert.equal(calls.length, count);
});
test('login exposes owner controls, writes send CSRF; logout clears private state without loading data', async () => {
  let owner = false; const calls = [];
  const ui = await prototypeUI(async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url === '/api/auth/login') { owner = true; return response({ role: 'owner', csrfToken: 'new-token' }); }
    if (url === '/api/auth/logout') { owner = false; return response({ role: 'guest' }); }
    if (options.method === 'DELETE') return response(wish);
    return response(owner ? [wish] : publicRecords([wish]));
  }, { owner: false, wishlist: true });
  ui.get('#owner-password').value = 'test-password'; await ui.get('#login-form').fire('submit');
  assert.equal(ui.get('#owner-password').value, ''); assert.equal(ui.get('#add-record').hidden, false);
  assert.equal(ui.get('#store-heading').hidden, false);
  assert.equal(ui.get('#auth-status').textContent, '');
  ui.run(`openDelete(${JSON.stringify(wish)})`); await ui.get('#confirm-delete').fire('click');
  assert.equal(calls.find(x => x.method === 'DELETE').headers['X-CSRF-Token'], 'new-token');
  ui.run(`openDelete(${JSON.stringify(wish)})`);
  await ui.get('#owner-logout').fire('click');
  assert.equal(ui.get('#delete-dialog').open, false); assert.equal(ui.get('#delete-preview').children.length, 0);
  assert.equal(ui.get('#add-record').hidden, true); assert.equal(ui.get('#store-heading').hidden, true);
  assert.equal(ui.get('#auth-status').textContent, '');
  assert.equal(ui.run('csrfToken'), null); assert.equal(ui.run('selected'), null);
});
test('late owner GET cannot restore private rows after logout', async () => {
  const pending = deferred(); let first = true;
  const ui = await prototypeUI(async url => {
    if (url === '/api/auth/logout') return response({ role: 'guest' });
    if (first) { first = false; return pending.promise; }
    return response(publicRecords([record]));
  });
  const read = ui.run('showCollection()'); await ui.get('#owner-logout').fire('click');
  pending.resolve(response([record])); await read;
  assert.equal(ui.run('owner'), false); assert.equal(ui.get('#records').querySelectorAll('button').length, 0);
  assert.equal(ui.get('#error').hidden, true);
});
test('expired write closes owner UI and never retries the mutation', async () => {
  let writes = 0;
  const ui = await prototypeUI(async (url, options = {}) => {
    if (options.method === 'DELETE') { writes++; return { ok: false, status: 401, json: async () => ({ error: 'AUTH_REQUIRED' }) }; }
    return response(publicRecords([record]));
  });
  ui.run(`openDelete(${JSON.stringify(record)})`); await ui.get('#confirm-delete').fire('click');
  assert.equal(writes, 1); assert.equal(ui.run('owner'), false); assert.equal(ui.get('#delete-dialog').open, false);
  assert.match(ui.get('#auth-status').textContent, /Войдите снова/);
});
test('failed logout does not claim that session was revoked', async () => {
  const ui = await prototypeUI(async () => { throw Error('network'); });
  await ui.get('#owner-logout').fire('click'); assert.equal(ui.run('owner'), true);
  assert.match(ui.get('#auth-status').textContent, /Выход не подтверждён/);
});

test('rechecking an unchanged guest session does not erase the visible collection', async () => {
  const ui = await prototypeUI(async url => response(url === '/api/auth/session' ? { role: 'guest' } : publicRecords([record])), { owner: false });
  await ui.start(); await ui.run('showCollection()'); await ui.run('checkSession()');
  assert.equal(ui.get('#table-container').hidden, false);
  assert.equal(ui.get('#status').textContent, 'Показано записей: 1');
});
test('guest view is usable after leaving a partial-transfer owner state', async () => {
  const ui = await prototypeUI(async () => response(publicRecords([wish])), { wishlist: true });
  ui.run("needsBothRefresh = true; needsRefresh = true; applySession({role:'guest'})");
  await ui.run('showCollection()');
  assert.equal(ui.get('#error').hidden, true); assert.equal(ui.get('#table-container').hidden, false);
});
test('an old session check cannot undo a newer logout', async () => {
  const pending = deferred();
  const ui = await prototypeUI(async url => url === '/api/auth/session' ? pending.promise : response(url === '/api/auth/logout' ? {role:'guest'} : publicRecords([record])));
  const check = ui.run('checkSession()'); await ui.get('#owner-logout').fire('click');
  pending.resolve(response({role:'owner',csrfToken:'old'})); await check;
  assert.equal(ui.run('owner'), false);
});

test('unchanged session checks do not invalidate an in-flight owner form read', async () => {
  const pending = deferred();
  const ui = await prototypeUI(async url => url === '/api/auth/session'
    ? response({role:'owner',csrfToken:'test-csrf'}) : pending.promise);
  const read = ui.run('loadRecords()');
  await ui.run('checkSession()');
  pending.resolve(response([record]));
  assert.deepEqual(await read, [record]);
  assert.equal(ui.run('owner'), true);
});
