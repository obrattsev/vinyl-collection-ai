import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleSheetsRepository, SHEETS_COLUMNS } from '../server/google-sheets-collection.mjs';
import { createWishlistRepository, WISHLIST_COLUMNS } from '../server/google-sheets-wishlist.mjs';
import { recordRevision } from '../src/collection-record.mjs';
import { wishlistRevision } from '../src/wishlist-record.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
for (const wishlist of [false,true]) test(`${wishlist} Sheets update targets current UUID row, typed cells only, preserves extras and rejects stale data`,async()=>{
  const source=wishlist?wish:record; const mapping=wishlist?WISHLIST_COLUMNS:SHEETS_COLUMNS;
  const headers=Object.keys(mapping).reverse(); headers.splice(3,0,'Unknown');
  const row=headers.map(h=>h==='Unknown'?'=preserved':source[mapping[h]]);
  let values=[headers,[],[],[...row]]; let writes=0;
  const auth={getClient:async()=>({request:async options=>{
    if(options.url.includes('/values/'))return {data:{values:structuredClone(values)}};
    if(options.method==='GET')return {data:{sheets:[{properties:{title:'Test',sheetId:2}}]}};
    writes++; assert.equal(options.retry,false);
    for(const {updateCells:update} of options.data.requests){
      assert.equal(update.fields,'userEnteredValue'); assert.equal(update.range.startRowIndex,3);
      const col=update.range.startColumnIndex; assert.notEqual(headers[col],'ID');assert.notEqual(headers[col],'Unknown');
      const cell=update.rows[0].values[0].userEnteredValue;
      assert.ok(!cell||!Object.hasOwn(cell,'formulaValue')); values[3][col]=cell?.stringValue??cell?.numberValue??null;
    }
    return {data:{}};
  }})};
  const repo=(wishlist?createWishlistRepository:createGoogleSheetsRepository)({spreadsheetId:'test',sheetName:'Test',auth});
  const revision=wishlist?wishlistRevision:recordRevision; const expected=await revision(source);
  const changed={...source,note:'=literal',additionalGenre:null,...(!wishlist?{purchasePrice:0}: {storeUrl:null})};
  await repo.updateRecord(changed,expected); assert.equal(writes,1);
  assert.equal(values[3][headers.indexOf('Unknown')],'=preserved'); assert.equal(values[3][headers.indexOf('ID')],source.id);
  assert.deepEqual((await repo.getRecords())[0],changed);
  await assert.rejects(repo.updateRecord(source,expected),{status:409,message:'RECORD_CHANGED'});
  values=[headers]; await assert.rejects(repo.updateRecord(source,expected),{status:404});assert.equal(writes,1);
});
