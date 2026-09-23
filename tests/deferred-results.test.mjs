import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeUI, response, deferred } from './fixtures/prototype-dom.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { publicRecords } from '../src/public-record.mjs';

for (const wishlist of [false, true]) {
  for (const owner of [false, true]) test(`${wishlist ? 'wishlist' : 'collection'} ${owner ? 'owner' : 'guest'}: opening and session checks never fetch records`, async () => {
    const calls = [];
    const ui = await prototypeUI(async url => {
      calls.push(url); assert.equal(url, '/api/auth/session');
      return response(owner ? {role:'owner',csrfToken:'token'} : {role:'guest'});
    }, {wishlist, owner:false});
    await ui.start(); await ui.run('checkSession()');
    assert.deepEqual(calls, ['/api/auth/session','/api/auth/session']);
    assert.equal(ui.get('#table-container').hidden, true);
    assert.equal(ui.get('#status').textContent, 'Здесь появятся результаты поиска.');
  });
  test(`${wishlist ? 'wishlist' : 'collection'}: find/show fetch fresh data; clear empties criteria/results without fetching`, async () => {
    const endpoint = wishlist ? '/api/wishlist' : '/api/collection';
    const source = wishlist ? wish : record; const calls = [];
    const ui = await prototypeUI(async url => { calls.push(url); return response(publicRecords([source])); }, {wishlist, owner:false});
    ui.searchInput('artist').value = source.artist;
    await ui.get('#search-form').fire('submit');
    assert.deepEqual(calls,[endpoint]); assert.equal(ui.get('#status').textContent,'Показано записей: 1');
    ui.get('#search-form').reset();
    assert.equal(ui.searchInput('artist').value,'');
    assert.equal(ui.get('#records').children.length,0); assert.equal(ui.get('#table-container').hidden,true);
    assert.equal(ui.get('#status').textContent,'Здесь появятся результаты поиска.');
    assert.deepEqual(calls,[endpoint]);
    await ui.get('#load-collection').fire('click'); assert.deepEqual(calls,[endpoint,endpoint]);
    assert.equal(ui.get('#status').textContent,'Показано записей: 1');
  });
  test(`${wishlist ? 'wishlist' : 'collection'}: clear discards late successes and errors without clearing recovery lock`, async () => {
    for (const fail of [false,true]) {
      const pending = deferred(); let calls=0;
      const ui = await prototypeUI(async () => { calls++; return pending.promise; }, {wishlist});
      ui.run('needsRefresh = true; needsBothRefresh = true');
      const read=ui.run('showCollection()'); ui.get('#search-form').reset();
      if (fail) pending.reject(Error('late')); else pending.resolve(response([wishlist ? wish : record]));
      await read;
      assert.equal(calls,1); assert.equal(ui.get('#table-container').hidden,true);
      assert.equal(ui.get('#error').hidden,true); assert.equal(ui.get('#records').children.length,0);
      assert.equal(ui.get('#status').textContent,'Здесь появятся результаты поиска.');
      assert.equal(ui.run('needsRefresh && needsBothRefresh'),true);
    }
  });
}
test('login/logout in initial state only call auth endpoints', async () => {
  const calls=[];
  const ui=await prototypeUI(async url => {
    calls.push(url);
    return response(url.endsWith('/login') ? {role:'owner',csrfToken:'new'} : {role:'guest'});
  }, {owner:false});
  await ui.start(); ui.get('#owner-password').value='test-only';
  await ui.get('#login-form').fire('submit'); await ui.get('#owner-logout').fire('click');
  assert.deepEqual(calls,['/api/auth/session','/api/auth/login','/api/auth/logout']);
  assert.equal(ui.get('#table-container').hidden,true);
});
