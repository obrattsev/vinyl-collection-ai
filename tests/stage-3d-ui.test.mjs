import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prototypeUI, response, deferred } from './fixtures/prototype-dom.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { publicRecords } from '../src/public-record.mjs';
import { recordRevision } from '../src/collection-record.mjs';
import { wishlistRevision } from '../src/wishlist-record.mjs';
const coverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const all = node => [node, ...node.children.flatMap(all)];
const find = (node, className) => all(node).find(child => child.className === className);
const recordButton = ui => find(ui.get('#mobile-records'), 'compact-record');
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
// FileReader is a browser API; this harness tests its completed callback, not decoding.
globalThis.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,dGVzdA=='; this.onload(); } };
for (const wishlist of [false, true]) for (const owner of [false, true]) for (const hasCover of [false, true]) {
  test(`3D UI ${wishlist}/${owner}/${hasCover}: cover/star siblings, no blank guest placeholder or nested interactive controls`, async () => {
    const source = { ...(wishlist ? wish : record), coverId: hasCover ? coverId : null };
    const ui = await prototypeUI(async () => response(owner ? [source] : publicRecords([source])), { wishlist, owner, compact: true });
    await ui.get('#load-collection').fire('click');
    const row = ui.get('#records').children[0].children[0];
    assert.equal(row.children[0].className, 'quick-cell');
    assert.equal(row.children[1].textContent, source.artist);
    assert.equal(row.children[2].children[0].textContent, source.album);
    assert.equal(row.children[2].children.length, 1);
    assert.equal(row.children[0].hidden, wishlist && !owner && !hasCover);
    assert.equal(ui.get('#quick-heading').hidden, wishlist && !owner && !hasCover);
    const quick = row.children[0].children[0];
    assert.deepEqual(quick ? quick.children.map(node => node.className) : [],
      [...(!wishlist ? ['favorite-note'] : []), ...(owner || hasCover ? ['cover-control'] : [])]);
    for (const root of [ui.get('#records'), ui.get('#mobile-records')]) {
      const cover = find(root, 'cover-control');
      assert.equal(Boolean(cover), owner || hasCover);
      if (cover) assert.match(cover.attributes['aria-label'], hasCover ? owner ? /Управление/ : /Просмотреть/ : /Добавить обложку/);
      const star = find(root, 'favorite-note'); assert.equal(Boolean(star), !wishlist);
      if (star) {
        assert.equal(star.tagName, owner ? 'BUTTON' : 'SPAN'); assert.equal(star.textContent, '♪');
        assert.equal(star.attributes['data-active'], String(source.favorite));
        assert.match(star.attributes['aria-label'], /избранном|избранное/);
      }
      for (const button of all(root).filter(node => ['BUTTON', 'A'].includes(node.tagName))) {
        assert.equal(button.children.flatMap(all).some(node => ['BUTTON', 'A', 'INPUT'].includes(node.tagName)), false);
      }
    }
    await recordButton(ui).fire('click');
    assert.equal(all(ui.get('#detail-content')).some(node => node.tagName === 'IMG'), hasCover);
    if (hasCover || owner) {
      await ui.get('#close-detail').fire('click');
      await find(ui.get('#mobile-records'), 'cover-control').fire('click');
      assert.equal(ui.get('#cover-dialog').open, true);
      assert.equal(ui.get('#cover-owner-controls').hidden, !owner);
      assert.equal(ui.get('#save-cover').hidden, !owner);
    }
  });
}
for (const wishlist of [false, true]) test(`3D ${wishlist}: add/replace/delete use specialized versioned writes, close only on success, no GET`, async () => {
  let current = { ...(wishlist ? wish : record) }; const writes = []; let reads = 0;
  const ui = await prototypeUI(async (url, options = {}) => {
    if (!options.method) { reads++; return response([current]); }
    writes.push({ url, ...options });
    assert.equal(options.headers['If-Match'], await (wishlist ? wishlistRevision : recordRevision)(current));
    assert.equal(options.headers['X-CSRF-Token'], 'test-csrf');
    current = { ...current, coverId: options.method === 'DELETE' ? null : current.coverId ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : coverId };
    return response(current);
  }, { wishlist, compact: true });
  await ui.get('#load-collection').fire('click');
  ui.get('#mobile-sort-field').value = 'artist'; await ui.get('#mobile-sort-field').fire('change');
  for (const method of ['PUT', 'PUT', 'DELETE']) {
    await find(ui.get('#mobile-records'), 'cover-control').fire('click');
    if (method === 'PUT') {
      ui.get('#cover-file').files = [{ type: 'image/png', size: 100 }]; await ui.get('#cover-file').fire('change');
      assert.equal(ui.get('#save-cover').disabled, false);
      await ui.get('#save-cover').fire('click');
    } else {
      const count = writes.length;
      await ui.get('#confirm-remove-cover').fire('click'); assert.equal(writes.length, count);
      await ui.get('#remove-cover').fire('click'); assert.equal(writes.length, count);
      await ui.get('#cancel-remove-cover').fire('click'); assert.equal(writes.length, count);
      await ui.get('#remove-cover').fire('click'); await ui.get('#confirm-remove-cover').fire('click');
    }
    assert.equal(ui.get('#cover-dialog').open, false); assert.equal(ui.run('displayedRecords[0].coverId'), current.coverId);
    assert.equal(writes.at(-1).method, method); assert.match(writes.at(-1).url, /\/cover$/);
    assert.equal(reads, 1); assert.equal(ui.run('activeSort.field'), 'artist'); await tick();
    assert.equal(ui.activeElement(), find(ui.get('#mobile-records'), 'cover-control'));
  }
});
test('cover preview cancel has no write; invalid file cannot save; busy blocks double submit and close', async () => {
  const pending = deferred(); let writes = 0;
  const ui = await prototypeUI(async (url, options = {}) => options.method ? (writes++, pending.promise) : response([record]));
  await ui.get('#load-collection').fire('click'); await find(ui.get('#records'), 'cover-control').fire('click');
  ui.get('#cover-file').files = [{ type: 'image/heic', size: 100 }]; await ui.get('#cover-file').fire('change');
  assert.equal(ui.get('#save-cover').disabled, true); assert.match(ui.get('#cover-error').textContent, /HEIC/);
  await ui.get('#close-cover').fire('click'); assert.equal(writes, 0);
  await find(ui.get('#records'), 'cover-control').fire('click');
  ui.get('#cover-file').files = [{ type: 'image/png', size: 100 }]; await ui.get('#cover-file').fire('change');
  const send = ui.get('#save-cover').fire('click'); await ui.get('#save-cover').fire('click');
  await ui.get('#close-cover').fire('click'); assert.equal(ui.get('#cover-dialog').open, true);
  pending.resolve(response({ ...record, coverId })); await send; assert.equal(writes, 1); assert.equal(ui.get('#cover-dialog').open, false);
});
for (const error of ['RECORD_CHANGED', 'RESULT_UNCONFIRMED']) test(`cover ${error} preserves dialog, requires explicit refresh and never retries`, async () => {
  let writes = 0;
  const ui = await prototypeUI(async (url, options = {}) => options.method ? (writes++, { ok: false, status: 500, json: async () => ({ error }) }) : response([{ ...record, coverId }]));
  await ui.get('#load-collection').fire('click'); await find(ui.get('#records'), 'cover-control').fire('click');
  await ui.get('#remove-cover').fire('click'); await ui.get('#confirm-remove-cover').fire('click');
  assert.equal(ui.get('#cover-dialog').open, true); assert.equal(ui.run('needsRefresh'), true);
  assert.equal(ui.run('displayedRecords[0].coverId'), coverId); await ui.get('#confirm-remove-cover').fire('click');
  assert.equal(writes, 1); assert.ok(ui.get('#cover-error').textContent);
});
for (const owner of [false, true]) test(`favorite filter + CSV ${owner}: public readonly state; no additional columns; base sort unchanged`, async () => {
  let data = [{ ...record, favorite: true }, { ...record, id: coverId, album: 'Other', favorite: false }];
  let writes = 0, reads = 0;
  const ui = await prototypeUI(async (url, options = {}) => {
    if (options.method) { writes++; assert.equal(options.method, 'PATCH'); assert.match(url, /\/favorite$/); data[0] = { ...data[0], ...JSON.parse(options.body) }; return response(data[0]); }
    reads++; return response(owner ? data : publicRecords(data));
  }, { owner });
  await ui.get('#load-collection').fire('click');
  ui.get('#favorite-only').checked = true; await ui.get('#favorite-only').fire('change');
  assert.equal(ui.run('displayedRecords.length'), 1);
  await ui.get('#download-records').fire('click');
  const csv = await (await fetch(ui.downloads.at(-1))).text();
  assert.equal(csv.split('\r\n')[0].split(';').length, 9); assert.ok(!csv.includes('Other'));
  assert.ok(!/coverId|favorite|Обложка|Избранное/.test(csv));
  if (owner) {
    await find(ui.get('#records'), 'favorite-note').fire('click');
    assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(ui.run('displayedRecords.length'), 0);
    assert.equal(ui.get('#favorite-only').checked, true); assert.equal(ui.get('#download-records').hidden, true);
  } else { await find(ui.get('#records'), 'favorite-note').fire('click'); assert.equal(writes, 0); }
});
test('metadata payload fields exclude cover/favorite; optional Add file has no metadata name; guest direct handlers cannot mutate', async () => {
  let writes = 0;
  const ui = await prototypeUI(async () => { writes++; return response([]); }, { owner: false });
  await ui.run(`toggleFavorite(${JSON.stringify(record)})`); assert.equal(writes, 0);
  assert.equal(ui.input('coverId'), undefined); assert.equal(ui.input('favorite'), undefined);
  for (const file of ['index.html', 'wishlist.html']) {
    const html = await readFile(new URL(`../prototype/${file}`, import.meta.url), 'utf8');
    const form = html.match(/<form id="record-form"[\s\S]*?<\/form>/)[0];
    assert.ok(!/name="(?:coverId|favorite)"/.test(form));
    assert.match(form, /id="add-cover-file" type="file"/);
    assert.doesNotMatch(form.match(/<input id="add-cover-file"[^>]*>/)[0], /\bname=/);
  }
});

for (const compact of [false, true]) test(`3D quick controls keyboard focus after favorite update and cover cancel (${compact})`, async () => {
  let current = { ...record };
  const ui = await prototypeUI(async (url, options = {}) => {
    if (options.method) { current = { ...current, ...JSON.parse(options.body) }; return response(current); }
    return response([current]);
  }, { compact });
  await ui.get('#load-collection').fire('click');
  const root = ui.get(compact ? '#mobile-records' : '#records');
  const favorite = find(root, 'favorite-note'); favorite.focus(); await favorite.fire('click');
  const changed = find(root, 'favorite-note');
  assert.equal(ui.activeElement(), changed); assert.equal(changed.attributes['aria-pressed'], 'true');
  assert.equal(changed.attributes['data-active'], 'true');
  const cover = find(root, 'cover-control'); cover.focus(); await cover.fire('click');
  assert.equal(ui.activeElement(), ui.get('#close-cover'));
  let prevented = false; await ui.get('#cover-dialog').fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false); // Native dialog performs close on uncancelled Escape.
  ui.get('#cover-dialog').close(); await tick(); assert.equal(ui.activeElement(), cover);
});
test('3D presentation column is unsortable; long album names do not relocate controls or enter CSV', async () => {
  const data = [{ ...record, album: 'Z'.repeat(200) }, { ...record, id: coverId, album: 'A', favorite: true }];
  const ui = await prototypeUI(async () => response(data));
  await ui.get('#load-collection').fire('click'); await ui.get('#sort-album').fire('click');
  assert.equal(ui.run('displayedRecords[0].album'), 'A');
  for (const row of ui.get('#records').children[0].children) {
    assert.equal(row.children[0].className, 'quick-cell');
    assert.deepEqual(row.children[0].children[0].children.map(n => n.className), ['favorite-note', 'cover-control']);
    assert.equal(row.children[2].children.length, 1);
    assert.equal(row.children.at(-1).children[0].className, 'row-actions');
  }
  await ui.get('#download-records').fire('click');
  const csv = await (await fetch(ui.downloads.at(-1))).text();
  assert.equal(csv.split('\r\n')[0].split(';').length, 9);
  assert.ok(csv.includes('Z'.repeat(200))); assert.ok(!csv.includes('♪'));
  for (const file of ['index.html', 'wishlist.html']) {
    const html = await readFile(new URL(`../prototype/${file}`, import.meta.url), 'utf8');
    const head = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)[1];
    assert.match(head, /^\s*<th scope="col" id="quick-heading" class="quick-cell"><span class="visually-hidden">/);
    assert.ok(!head.split('</th>')[0].includes('<button'));
    assert.match(html, /id="close-detail"[^>]*aria-label="Закрыть">×<\/button>/);
    const dialog = html.match(/<dialog id="cover-dialog"[\s\S]*?<\/dialog>/)[0];
    assert.match(dialog, /class="cover-header"[\s\S]*id="close-cover"[^>]*aria-label="Закрыть">×/);
    assert.equal((dialog.match(/id="close-cover"/g) || []).length, 1);
    assert.ok(dialog.indexOf('id="remove-cover"') < dialog.indexOf('id="save-cover"'));
  }
  const css = await readFile(new URL('../prototype/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.quick-cell \{ width: 1%; min-width: 0;/);
  assert.match(css, /\.record-quick-controls \{[^}]*width: max-content;/);
  assert.match(css, /#save-cover \{ margin-left: auto;/);
  assert.ok(!css.includes('td:nth-child(2)'));
});


test('favorite visual size matches cover without shrinking hit area or changing active layout', async () => {
  const css = await readFile(new URL('../prototype/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.favorite-note::before \{[^}]*width: 36px; height: 36px;/);
  assert.match(css, /\.cover-control img \{ width: 36px; height: 36px;/);
  assert.match(css, /\.cover-control, button\.favorite-note \{[^}]*width: 44px; height: 44px;/);
  assert.match(css, /\.compact-item \.favorite-note, \.compact-item \.favorite-note::before \{ width: 48px; height: 48px;/);
  assert.match(css, /#close-report, #close-cover, #close-detail \{[^}]*width: 44px; height: 44px;/);
  for (const rule of css.matchAll(/\.favorite-note\[data-active="true"\](?:::before)? \{([^}]+)\}/g)) {
    assert.doesNotMatch(rule[1], /width|height|padding|margin|border:/);
  }
});
