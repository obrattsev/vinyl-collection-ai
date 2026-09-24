import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeUI, response, deferred } from './fixtures/prototype-dom.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { publicRecords } from '../src/public-record.mjs';
import { recordRevision } from '../src/collection-record.mjs';
import { wishlistRevision } from '../src/wishlist-record.mjs';
import { sortRecords, recordsCsv, inputDate, displayDate } from '../prototype/record-presentation.mjs';
import { isCalendarDate } from '../src/collection-record.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
const current = ui => plain(ui.run('displayedRecords'));

test('presentation sorting is stable, immutable, numeric, normalized, with null last in both directions', () => {
  const records = [
    { artist: ' B ', albumYear: '2001', recordYear: null },
    { artist: 'a', albumYear: '2010', recordYear: '2000' },
    { artist: ' A ', albumYear: '1990', recordYear: '0010' },
    { artist: 'a', albumYear: '1990', recordYear: '0002' }
  ];
  const original = structuredClone(records);
  assert.deepEqual(sortRecords(records), [records[2], records[3], records[1], records[0]]);
  assert.deepEqual(sortRecords(records, { field: 'recordYear', direction: 'desc' }), [records[1], records[2], records[3], records[0]]);
  assert.deepEqual(sortRecords(records, { field: 'recordYear', direction: 'asc' }), [records[3], records[2], records[1], records[0]]);
  assert.deepEqual(records, original);
  assert.deepEqual(sortRecords([{artist:'a  b',albumYear:'2000'}, {artist:'A B',albumYear:'1990'}]).map(r=>r.albumYear), ['1990','2000']);
});
test('date conversion leaves validation in ISO model, preserves null, leap dates and no timezone parsing', () => {
  assert.equal(inputDate('29-02-2024'), '2024-02-29'); assert.equal(displayDate('2024-02-29'), '29-02-2024');
  assert.equal(inputDate(''), null); assert.equal(displayDate(null), '');
  for (const value of ['29-02-2023', '31-04-2026', '01-01-20', '2026-01-01']) assert.equal(isCalendarDate(inputDate(value)), false);
});
test('CSV BOM, semicolon, quotes, newlines, zero/null, explicit columns and formula protection', () => {
  const csv = recordsCsv([{ album: 'Тест;"А"\nБ', note: '  =HYPERLINK("x")', purchasePrice: 0, id: 'never' }], [['album','Альбом'],['note','Примечание'],['purchasePrice','Цена']]);
  assert.equal(csv, '\uFEFF"Альбом";"Примечание";"Цена"\r\n"Тест;""А""\nБ";"\'  =HYPERLINK(""x"")";"0"\r\n');
  for (const value of ['=1', '+1', '-1', '@SUM(1)', '\t=1', '\rX', '\nX', ' \u0000=1']) {
    assert.ok(recordsCsv([{note:value}], [['note','Текст']]).includes('"\''));
  }
  assert.ok(!csv.includes('never'));
  assert.equal(recordsCsv([{note:null}], [['note','Текст']]), '\uFEFF"Текст"\r\n""\r\n');
});
for (const wishlist of [false,true]) {
  const source = wishlist ? wish : record;
  const revision = wishlist ? wishlistRevision : recordRevision;
  test(`${wishlist} UI edit full preview, nullable values, legacy genres, UUID/If-Match and active search`, async () => {
    let stored = { ...source, genre: 'Legacy genre' }; let sent;
    const ui = await prototypeUI(async (url, options = {}) => {
      if (options.method === 'PUT') { sent = { url, ...options }; stored = { ...JSON.parse(options.body), id: stored.id }; return response(stored); }
      return response(url === '/api/collection' && wishlist ? [] : [stored]);
    }, { wishlist });
    ui.searchInput('album').value = source.album;
    await ui.get('#search-form').fire('submit');
    await ui.get('#sort-albumYear').fire('click'); await ui.get('#sort-albumYear').fire('click');
    await ui.run(`openEdit(${JSON.stringify(stored)})`);
    assert.equal(ui.input('genre').value, 'Legacy genre');
    if (!wishlist) assert.equal(ui.input('purchaseDate').value, '03-09-2026');
    ui.fill({ album: 'No longer matches', note: null, ...(wishlist ? { storeUrl: null } : { purchasePrice: 0, purchaseDate: '29-02-2024', purchaseStore: null }) });
    await ui.get('#record-form').fire('submit');
    assert.equal(ui.get('#confirm-record').hidden, false);
    assert.ok(ui.get('#record-preview').children[0].children.some(e => e.className === 'changed-value'));
    const before = { ...stored };
    await ui.get('#confirm-record').fire('click');
    assert.equal(sent.method, 'PUT'); assert.ok(sent.url.endsWith(source.id));
    assert.equal(sent.headers['If-Match'], await revision(before)); assert.equal(sent.headers['X-CSRF-Token'], 'test-csrf');
    assert.equal(Object.hasOwn(JSON.parse(sent.body), 'id'), false);
    assert.equal(stored.genre, 'Legacy genre'); assert.equal(stored.note, null);
    if (!wishlist) { assert.equal(stored.purchasePrice, 0); assert.equal(stored.purchaseDate, '2024-02-29'); }
    assert.deepEqual(current(ui), []); assert.equal(ui.run('activeSort.direction'), 'desc');
    await ui.get('#add-record').fire('click');
    assert.ok(!ui.input('genre').children.some(option => option.value === 'Legacy genre'));
  });
  test(`${wishlist} RECORD_CHANGED keeps input and requires explicit review plus fresh preview`, async () => {
    let stored = structuredClone(source); let attempts = 0;
    const ui = await prototypeUI(async (url, options = {}) => {
      if (options.method === 'PUT') {
        attempts++;
        if (attempts === 1) { stored = { ...stored, label:'Changed externally' }; return {ok:false,json:async()=>({error:'RECORD_CHANGED',record:stored})}; }
        assert.equal(options.headers['If-Match'], await revision(stored));
        stored = { ...JSON.parse(options.body), id: stored.id }; return response(stored);
      }
      return response(wishlist && url === '/api/collection' ? [] : [stored]);
    }, {wishlist});
    await ui.run(`openEdit(${JSON.stringify(source)})`); ui.fill({note:'My draft'});
    await ui.get('#record-form').fire('submit'); await ui.get('#confirm-record').fire('click');
    assert.equal(ui.input('note').value,'My draft'); assert.equal(ui.input('label').value,source.label);
    assert.equal(ui.get('#edit-current').hidden,false); assert.equal(ui.get('#confirm-record').hidden,true);
    await ui.get('#confirm-record').fire('click'); assert.equal(attempts,1);
    await ui.get('#review-current').fire('click');
    assert.equal(ui.get('#confirm-record').hidden,true);
    ui.fill({label:stored.label}); await ui.get('#record-form').fire('submit'); await ui.get('#confirm-record').fire('click');
    assert.equal(attempts,2); assert.equal(stored.note,'My draft'); assert.equal(stored.label,'Changed externally');
  });
  test(`${wishlist} edit cancellation and uncertain write never retry; refresh unlocks`, async () => {
    let writes=0;
    const ui=await prototypeUI(async(url,options={})=> {
      if(options.method==='PUT'){writes++;return {ok:false,json:async()=>({error:'RESULT_UNCONFIRMED'})};}
      return response(wishlist && url==='/api/collection'?[]:[source]);
    },{wishlist});
    await ui.run(`openEdit(${JSON.stringify(source)})`); ui.fill({note:'cancel'}); await ui.get('#cancel-record').fire('click'); assert.equal(writes,0);
    await ui.run(`openEdit(${JSON.stringify(source)})`); ui.fill({note:'new'}); await ui.get('#record-form').fire('submit'); await ui.get('#confirm-record').fire('click');
    assert.equal(ui.get('#add-record').disabled,true); await ui.get('#confirm-record').fire('click'); assert.equal(writes,1);
    await ui.get('#cancel-record').fire('click'); await ui.get('#load-collection').fire('click'); assert.equal(ui.get('#add-record').disabled,false);
  });
  for (const owner of [false,true]) test(`${wishlist}/${owner} sort/search/download use only visible rows and columns; reset clears`,async()=>{
    const data=[{...source,artist:'Z',album:'B'},{...source,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',artist:'A',album:'A'}];
    const ui=await prototypeUI(async()=>response(owner?data:publicRecords(data)),{wishlist,owner});
    await ui.get('#load-collection').fire('click'); assert.deepEqual(current(ui).map(r=>r.artist),['A','Z']);
    await ui.get('#sort-artist').fire('click'); await ui.get('#sort-artist').fire('click'); assert.deepEqual(current(ui).map(r=>r.artist),['Z','A']);
    ui.searchInput('artist').value='A'; await ui.get('#search-form').fire('submit'); assert.deepEqual(current(ui).map(r=>r.artist),['A']);
    await ui.get('#download-records').fire('click');
    const csv=await (await fetch(ui.downloads[0])).text();
    assert.ok(csv.includes('"A"')); assert.ok(!csv.includes('"Z"')); assert.ok(!csv.includes(source.id));
    assert.equal(csv.includes('"Ссылка"'),wishlist&&owner); assert.ok(!csv.includes('Цена')); assert.ok(!csv.includes(source.purchaseStore??'Тестовый магазин'));
    await ui.get('#load-collection').fire('click'); assert.equal(ui.run('activeSort.direction'),'desc');
    await ui.get('#search-form').fire('reset'); assert.equal(ui.run('activeSort'),null); assert.equal(ui.get('#download-records').disabled,true);
  });
}
test('late owner results cannot restore export after logout or clear; empty/error disable export', async()=>{
  const old=deferred(); let reads=0;
  const ui=await prototypeUI(async()=>++reads===1?old.promise:response([]));
  const pending=ui.run('showCollection()'); ui.run("applySession({role:'guest'})"); old.resolve(response([record])); await pending;
  assert.deepEqual(current(ui),[]); assert.equal(ui.get('#download-records').disabled,true);
  await ui.get('#load-collection').fire('click'); assert.equal(ui.get('#download-records').disabled,true);
});
test('both new genres are shared by searches and add/edit controls without artist changes',async()=>{
  for(const wishlist of [false,true]){
    const ui=await prototypeUI(async()=>response([]),{wishlist});
    for(const field of ['genre','additionalGenre']) for(const value of ['New Age','Various']) assert.ok(ui.input(field).children.some(o=>o.value===value));
    for(const value of ['New Age','Various']) assert.ok(ui.get('#search-genre').children.some(o=>o.value===value));
  }
});

test('edit preserves untouched multiline text and existing price precision without auto-merging conflicts', async () => {
  const source = { ...record, note: 'Line 1\nLine 2', purchasePrice: 1.234 };
  const ui = await prototypeUI(async () => response([source]));
  await ui.run(`openEdit(${JSON.stringify(source)})`);
  assert.equal(ui.input('note').value, 'Line 1Line 2');
  ui.fill({ album: 'Edited' });
  await ui.get('#record-form').fire('submit');
  assert.equal(ui.get('#confirm-record').hidden, false);
  assert.equal(ui.run('draft.note'), source.note); assert.equal(ui.run('draft.purchasePrice'), 1.234);
  ui.run(`showEditConflict(${JSON.stringify({ ...source, note: 'External', purchasePrice: 9 })})`);
  await ui.get('#review-current').fire('click');
  assert.equal(ui.run('readDraft().note'), source.note); assert.equal(ui.run('readDraft().purchasePrice'), 1.234);
});
test('edit PUT and an older GET cannot restore stale results or CSV', async () => {
  let stored = { ...record }; const delayed = deferred(); let delayNext = false;
  const ui = await prototypeUI(async (url, options = {}) => {
    if (options.method === 'PUT') { stored = { ...JSON.parse(options.body), id: record.id }; return response(stored); }
    if (delayNext) { delayNext = false; return delayed.promise; }
    return response([stored]);
  });
  await ui.run(`openEdit(${JSON.stringify(record)})`); ui.fill({ note: 'New' });
  await ui.get('#record-form').fire('submit');
  delayNext = true; const old = ui.run('showCollection()');
  await ui.get('#confirm-record').fire('click');
  delayed.resolve(response([record])); await old;
  assert.equal(current(ui)[0].note, 'New');
});

test('base order groups artists before chronology, normalizes names, and stably places empty years last within each group', () => {
  const records = [
    { artist: 'Pink Floyd', albumYear: '1967', album: 'P67' },
    { artist: 'David Bowie', albumYear: '', album: 'D empty' },
    { artist: ' david   BOWIE ', albumYear: '1971', album: 'D71' },
    { artist: 'Pink Floyd', albumYear: null, album: 'P empty' },
    { artist: 'David Bowie', albumYear: '1969', album: 'D69 first' },
    { artist: 'David Bowie', albumYear: '1969', album: 'D69 second' },
    { artist: 'David Bowie', albumYear: '1970', album: 'D70' },
    { artist: ' pink  floyd ', albumYear: '1971', album: 'P71' },
    { artist: 'Pink Floyd', albumYear: '1969', album: 'P69' },
    { artist: 'Pink Floyd', albumYear: '1970', album: 'P70' }
  ];
  const before = structuredClone(records);
  assert.deepEqual(sortRecords(records).map(r => r.album), ['D69 first', 'D69 second', 'D70', 'D71', 'D empty', 'P67', 'P69', 'P70', 'P71', 'P empty']);
  assert.deepEqual(records, before);
});
for (const wishlist of [false, true]) for (const owner of [false, true]) {
  test(`${wishlist}/${owner} full list and filtered results group Bowie then Floyd; clearing manual sort restores grouped chronology`, async () => {
    const source = wishlist ? wish : record;
    const entries = [['Pink Floyd','1967'],['David Bowie','1971'],['Pink Floyd','1971'],['David Bowie','1969'],['Pink Floyd','1969'],['David Bowie','1970'],['Pink Floyd','1970']];
    const data = entries.map(([artist, albumYear], index) => ({ ...source, artist, albumYear, album: `${artist} ${albumYear}`, genre: 'Jazz', id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
    data.push({ ...source, artist:'Other', albumYear:'1950', genre:'Rock', additionalGenre:null, id:'00000000-0000-4000-8000-000000000008' });
    const ui = await prototypeUI(async () => response(owner ? data : publicRecords(data)), { wishlist, owner });
    const grouped = ['David Bowie 1969','David Bowie 1970','David Bowie 1971','Pink Floyd 1967','Pink Floyd 1969','Pink Floyd 1970','Pink Floyd 1971'];
    await ui.get('#load-collection').fire('click');
    assert.deepEqual(current(ui).filter(r => r.genre === 'Jazz').map(r => r.album), grouped);
    ui.searchInput('genre').value = 'Jazz'; await ui.get('#search-form').fire('submit');
    assert.deepEqual(current(ui).map(r => r.album), grouped);
    await ui.get('#sort-albumYear').fire('click');
    assert.equal(current(ui)[0].album, 'Pink Floyd 1967');
    await ui.get('#load-collection').fire('click');
    assert.equal(current(ui).length, 8); assert.equal(current(ui)[0].artist, 'Other');
    await ui.get('#search-form').fire('reset');
    ui.searchInput('genre').value = 'Jazz'; await ui.get('#search-form').fire('submit');
    assert.deepEqual(current(ui).map(r => r.album), grouped);
  });
}
test('both full-list buttons use the agreed labels and retain their existing control identity', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const [file, label] of [['index.html', 'Показать всю коллекцию'], ['wishlist.html', 'Показать весь wish-list']]) {
    const html = await readFile(new URL(`../prototype/${file}`, import.meta.url), 'utf8');
    const button = html.match(/<button id="load-collection"[^>]*>([\s\S]*?)<\/button>/)[1];
    assert.ok(button.endsWith(label));
  }
});
