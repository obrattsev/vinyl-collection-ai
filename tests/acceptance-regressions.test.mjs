import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAddition } from '../src/collection-rules.mjs';
const original={artist:'Pink Floyd',album:'More',albumYear:'1971',genre:'Rock',label:null,recordYear:null,editionType:null};
const reissue={...original,recordYear:'1986',editionType:'Переиздание'};
test('acceptance: unknown Pink Floyd More pressing permits the 1986 reissue',()=>assert.equal(checkAddition(reissue,'collection',[original]).blocked,false));
test('acceptance: reversed completeness permits addition',()=>assert.equal(checkAddition(original,'collection',[reissue]).blocked,false));

test('unknown edition evidence warns symmetrically across both lists; only confirmed editions block', () => {
  for (const [candidate, existing] of [[original,reissue], [reissue,original], [original,original]]) {
    const own = checkAddition(candidate, 'collection', [existing]);
    assert.equal(own.blocked, false); assert.deepEqual(own.warnings, [existing]);
    assert.equal(checkAddition(candidate, 'wishlist', [], [existing]).blocked, false);
    const cross = checkAddition(candidate, 'wishlist', [existing]);
    assert.equal(cross.blocked, false); assert.deepEqual(cross.ownedAlbums, [existing]);
  }
  const complete = {...reissue, label:'Example Records'};
  for (const field of ['label','recordYear','editionType']) {
    assert.equal(checkAddition({...complete,[field]:null}, 'collection', [complete]).blocked, false);
    assert.equal(checkAddition(complete, 'collection', [{...complete,[field]:null}]).blocked, false);
  }
  for (const target of ['collection', 'wishlist']) {
    assert.equal(checkAddition({...complete,artist:' PINK   FLOYD ',label:' example records '},target,[complete],[complete]).blocked,true);
  }
});
