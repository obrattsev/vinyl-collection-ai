import { PUBLIC_FIELDS, validatePublicRecords } from '../src/public-record.mjs';
import { validateCollection } from '../src/collection-record.mjs';
import { validateWishlist, validateWishlistDraft, wishlistFieldErrors, wishlistRevision } from '../src/wishlist-record.mjs';
import { searchWishlist, validateWishlistCriteria } from '../src/wishlist-rules.mjs';
import { GENRES } from '../src/genres.mjs';
import { bindInputConstraint, formatDateInput, formatPriceInput, formatYearInput } from './input-controls.mjs';
import { validateDraft, recordRevision, draftFieldErrors } from '../src/collection-record.mjs';
import { searchCollection, validateSearchCriteria, checkAddition, isPotentialDuplicate } from '../src/collection-rules.mjs';

const isWishlist = document.body?.dataset.section === 'wishlist';
const endpoint = isWishlist ? '/api/wishlist' : '/api/collection';
const readCriteria = () => Object.fromEntries(new FormData(form));
const validateCriteria = isWishlist ? validateWishlistCriteria : validateSearchCriteria;
const validateRecords = isWishlist ? validateWishlist : validateCollection;
const searchRecords = isWishlist ? searchWishlist : searchCollection;
const revisionFor = isWishlist ? wishlistRevision : recordRevision;
const button = document.querySelector('#load-collection');
const form = document.querySelector('#search-form');
const controls = document.querySelector('#search-controls');
bindInputConstraint(document.querySelector('#search-year'), formatYearInput);
const searchGenre = document.querySelector('#search-genre');
for (const genre of ['', ...GENRES]) {
  const option = document.createElement('option');
  option.value = genre; option.textContent = genre || 'Любой жанр'; searchGenre.append(option);
}
const criteriaError = document.querySelector('#criteria-error');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const container = document.querySelector('#table-container');
const rows = document.querySelector('#records');
let owner = false;
let csrfToken = null;
let authBusy = false;
let authVersion = 0;
let sessionCheckVersion = 0;
const fields = [...PUBLIC_FIELDS];
let loading = false;
let loadVersion = 0;
let needsRefresh = false;
let needsBothRefresh = false;

function resetResults() {
  // Invalidates in-flight reads without clearing write-recovery requirements.
  loadVersion++;
  loading = false;
  button.disabled = controls.disabled = writing;
  rows.replaceChildren(); container.hidden = true;
  criteriaError.hidden = error.hidden = true;
  criteriaError.textContent = error.textContent = '';
  status.textContent = 'Здесь появятся результаты поиска.';
}
form.addEventListener('reset', resetResults);

form.addEventListener('submit', event => {
  event.preventDefault();
  if (loading || writing) return;
  const criteria = readCriteria();
  criteriaError.hidden = true;
  try {
    validateCriteria(criteria);
  } catch (validationError) {
    criteriaError.textContent = validationError.message;
    criteriaError.hidden = false;
    return;
  }
  return showCollection(criteria);
});

button.addEventListener('click', () => { if (!writing) return showCollection(); });

async function showCollection(criteria = {}) {
  const version = ++loadVersion;
  loading = true;
  button.disabled = true;
  controls.disabled = true;
  criteriaError.hidden = true;
  status.textContent = isWishlist ? 'Загрузка wish-list…' : 'Загрузка коллекции…';
  error.hidden = true;
  error.textContent = '';
  container.hidden = true;
  rows.replaceChildren();

  try {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) { const body = await response.json(); throw new Error(body.error); }
    const records = await response.json();
    if (version !== loadVersion) return;
    if (response.headers?.get('X-Access-Role') === 'guest' && owner) { applySession({ role: 'guest' }); await showCollection(criteria); return; }
    (owner ? validateRecords : validatePublicRecords)(records);
    const results = searchRecords(records, criteria);
    needsRefresh = owner && needsBothRefresh;
    document.querySelector('#add-record').disabled = needsRefresh;
    if (records.length === 0) {
      status.textContent = isWishlist ? 'Wish-list пуст' : 'Коллекция пуста';
    } else if (results.length === 0) {
      status.textContent = isWishlist ? 'По поисковому запросу записей в wish-list не найдено' : 'По поисковому запросу пластинок не найдено';
    } else {
      renderRecords(results);
      status.textContent = `Показано записей: ${results.length}`;
    }
    if (owner && needsBothRefresh) {
      try {
        await loadRecords('/api/collection');
      } catch {
        if (version !== loadVersion) return;
        error.textContent = 'Wish-list обновлён, но не удалось проверить основную коллекцию. Повторите поиск или показ всего wish-list.';
        error.hidden = false;
        return false;
      }
      if (version !== loadVersion) return;
      needsBothRefresh = needsRefresh = false;
      document.querySelector('#add-record').disabled = false;
      for (const button of rows.querySelectorAll('button')) button.disabled = false;
    }
    return true;
  } catch (cause) {
    if (version !== loadVersion) return;
    status.textContent = '';
    error.textContent = cause.message === 'WISHLIST_NOT_CONFIGURED' ? 'Wish-list ещё не подключён. Настройте отдельный Google Sheets-документ на сервере.' : isWishlist ? 'Ошибка загрузки данных. Не удалось загрузить wish-list.' : 'Ошибка загрузки данных. Не удалось загрузить коллекцию.';
    error.hidden = false;
  } finally {
    if (version === loadVersion) {
      loading = false;
      button.disabled = false;
      controls.disabled = false;
    }
  }
}

function renderRecords(records) {
  const fragment = document.createDocumentFragment();
  for (const record of records) {
    const row = document.createElement('tr');
    for (const field of [...fields, ...(owner && isWishlist ? ['storeUrl'] : [])]) {
      const cell = document.createElement('td');
      cell.textContent = record[field] ?? '';
      row.append(cell);
    }
    if (!owner) { fragment.append(row); continue; }
    const action = document.createElement('td');
    const actions = document.createElement('div'); actions.className = 'row-actions';
    const remove = document.createElement('button'); remove.className = 'button-secondary';
    remove.type = 'button'; remove.textContent = 'Удалить'; remove.disabled = needsRefresh;
    remove.setAttribute('aria-label', `Удалить: ${record.artist} — ${record.album}`);
    remove.addEventListener('click', () => openDelete(record));
    actions.append(remove);
    if (isWishlist) {
      const transfer = document.createElement('button'); transfer.disabled = needsRefresh; transfer.type = 'button'; transfer.textContent = 'Добавить в коллекцию';
      transfer.setAttribute('aria-label', `Перенести в коллекцию: ${record.artist} — ${record.album}`);
      transfer.addEventListener('click', () => openTransfer(record)); actions.append(transfer);
    }
    action.append(actions);
    row.append(action);
    fragment.append(row);
  }
  rows.append(fragment);
  container.hidden = false;
}

const collectionLabels = { artist:'Исполнитель', album:'Альбом', genre:'Жанр', additionalGenre:'Дополнительный жанр', label:'Лейбл', albumYear:'Год альбома', recordYear:'Год пластинки', editionType:'Тип издания', note:'Примечание', purchaseDate:'Дата покупки', purchaseStore:'Магазин покупки', purchasePrice:'Цена покупки (руб.)' };
const wishlistLabels = Object.fromEntries(Object.entries(collectionLabels).filter(([field]) => !field.startsWith('purchase')));
wishlistLabels.storeUrl = 'Ссылка на онлайн-магазин';
const labels = isWishlist ? wishlistLabels : collectionLabels;
const purchaseFields = ['purchaseDate', 'purchaseStore', 'purchasePrice'];
let transferSource = null;
let transferTarget = null;
let activeLabels = labels;
const validateActiveDraft = value => transferSource || !isWishlist ? validateDraft(value) : validateWishlistDraft(value);
const activeErrors = value => transferSource || !isWishlist ? draftFieldErrors(value) : wishlistFieldErrors(value);
const dialog = document.querySelector('#record-dialog');
const recordForm = document.querySelector('#record-form');
const recordFields = document.querySelector('#record-fields');
const recordError = document.querySelector('#record-error');
const preview = document.querySelector('#record-preview');
const previewButton = document.querySelector('#preview-record');
const confirmButton = document.querySelector('#confirm-record');
const editButton = document.querySelector('#edit-draft');
const operationStatus = document.querySelector('#operation-status');
let draft = null;
let writing = false;
let checking = false;
let dialogRun = 0;
let showFieldErrors = false;
const formInputs = new Map();
const fieldMessages = new Map();
for (const [name, title] of Object.entries(isWishlist ? { ...labels, ...Object.fromEntries(purchaseFields.map(field => [field, collectionLabels[field]])) } : labels)) {
  const label = document.createElement('label'); label.textContent = title + (['artist','album','albumYear'].includes(name) ? ' *' : '');
  const choices = name === 'editionType' ? ['Оригинал', 'Переиздание']
    : ['genre', 'additionalGenre'].includes(name) ? GENRES : null;
  const input = document.createElement(choices ? 'select' : 'input');
  input.name = name;
  input.id = `record-${name}`;
  formInputs.set(name, input);
  if (choices) {
    for (const value of ['', ...choices]) { const option = document.createElement('option'); option.value = value; option.textContent = value || 'Неизвестно'; input.append(option); }
  } else {
    input.type = 'text';
    if (name.endsWith('Year')) { input.inputMode = 'numeric'; input.placeholder = 'YYYY'; input.maxLength = 4; }
    if (name === 'purchaseDate') {
      input.placeholder = 'YYYY-MM-DD'; input.inputMode = 'numeric'; input.maxLength = 10;
    }
    if (name === 'purchasePrice') { input.inputMode = 'decimal'; input.placeholder = '0 — бесплатно'; }
  }
  if (['artist','album','albumYear'].includes(name)) input.required = true;
  if (['artist','album','label'].includes(name)) {
    const list = document.createElement('datalist'); list.id = `suggest-${name}`;
    input.setAttribute('list', list.id); label.append(list);
  }
  const message = document.createElement('span');
  message.id = `error-${name}`; message.className = 'field-error'; message.hidden = true;
  input.setAttribute('aria-describedby', message.id);
  fieldMessages.set(name, message);
  label.append(input, message); recordFields.append(label);
  if (isWishlist && purchaseFields.includes(name)) { label.hidden = true; input.disabled = true; }
  input.fieldContainer = label;
  if (name === 'purchaseDate') bindInputConstraint(input, formatDateInput);
  if (name === 'purchasePrice') bindInputConstraint(input, formatPriceInput);

}
function readDraft() {
  const input = Object.fromEntries(Object.keys(activeLabels).map(key => [key, formInputs.get(key).value.trim() ? formInputs.get(key).value : null]));
  if (Object.hasOwn(input, 'purchasePrice') && input.purchasePrice !== null) {
    const price = formatPriceInput(input.purchasePrice);
    input.purchasePrice = price === null ? NaN : Number(price);
  }
  if (transferSource) {
    const { id, storeUrl, ...common } = transferSource;
    return { ...common, ...input };
  }
  return input;
}
function setFormMode(source = null) {
  transferSource = source; transferTarget = null;
  activeLabels = source ? Object.fromEntries(purchaseFields.map(field => [field, collectionLabels[field]])) : labels;
  for (const [name, input] of formInputs) {
    input.disabled = !Object.hasOwn(activeLabels, name);
    input.fieldContainer.hidden = input.disabled;
  }
  document.querySelector('#dialog-title').textContent = source ? 'Перенос wish-list → коллекция' : isWishlist ? 'Добавление в wish-list' : 'Добавление в основную коллекцию';
  confirmButton.textContent = source ? 'Подтвердить перенос' : 'Подтвердить добавление';
  const sourcePreview = document.querySelector('#transfer-source');
  sourcePreview.hidden = !source;
  if (source) displayRecord(sourcePreview, source, wishlistLabels);
}
function renderFieldErrors(errors = {}) {
  for (const [field, input] of formInputs) {
    const message = errors[field] ?? '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    fieldMessages.get(field).textContent = message;
    fieldMessages.get(field).hidden = !message;
  }
}
function updateFieldErrors() {
  if (!showFieldErrors) return;
  const errors = activeErrors(readDraft());
  renderFieldErrors(errors);
  if (!Object.keys(errors).length) recordError.textContent = '';
}
recordForm.addEventListener('input', updateFieldErrors);
recordForm.addEventListener('change', updateFieldErrors);
recordForm.addEventListener('reset', () => { showFieldErrors = false; renderFieldErrors(); });

function displayRecord(target, record, displayLabels = labels) {
  const list = document.createElement('dl');
  for (const [field, title] of Object.entries(displayLabels)) {
    const term = document.createElement('dt'); term.textContent = title;
    const value = document.createElement('dd'); value.textContent = record[field] ?? '';
    list.append(term, value);
  }
  target.replaceChildren(list);
}
async function loadRecords(url = endpoint) {
  const version = authVersion;
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw new Error('load');
  const records = await response.json();
  if (version !== authVersion) throw new Error('STALE_READ');
  if (!owner || response.headers?.get('X-Access-Role') === 'guest') { applySession({ role: 'guest' }); throw new Error('AUTH_REQUIRED'); }
  (url === '/api/wishlist' ? validateWishlist : validateCollection)(records);
  return records;
}
async function additionRecords() {
  if (!isWishlist) return { collection: await loadRecords(), wishlist: [] };
  const [collection, wishlist] = await Promise.all([loadRecords('/api/collection'), loadRecords()]);
  return { collection, wishlist };
}
function editDraft() {
  confirmButton.textContent = transferSource ? 'Подтвердить перенос' : 'Подтвердить добавление';
  transferTarget = null; draft = null; recordFields.hidden = false; preview.hidden = true;
  confirmButton.hidden = editButton.hidden = true; previewButton.hidden = false;
}
document.querySelector('#add-record').addEventListener('click', async () => {
  if (!owner || authBusy || needsRefresh || writing) return;
  const run = ++dialogRun;
  setFormMode(); recordForm.reset(); editDraft(); recordError.textContent = ''; dialog.showModal();
  try {
    const { collection, wishlist } = await additionRecords();
    const records = [...collection, ...wishlist];
    if (run !== dialogRun || !dialog.open) return;
    for (const field of ['artist','album','label']) {
      const list = document.querySelector(`#suggest-${field}`); list.replaceChildren();
      for (const value of new Set(records.map(r => r[field]).filter(Boolean))) { const option = document.createElement('option'); option.value = value; list.append(option); }
    }
  } catch {
    if (run === dialogRun && dialog.open) recordError.textContent = 'Не удалось загрузить подсказки. Перед добавлением коллекция будет проверена повторно.';
  }
});
editButton.addEventListener('click', editDraft);
document.querySelector('#cancel-record').addEventListener('click', () => { if (!writing) dialog.close(); });
dialog.addEventListener('cancel', event => { if (writing) event.preventDefault(); });
dialog.addEventListener('close', () => {
  dialogRun++;
  checking = false;
  previewButton.disabled = false; recordFields.disabled = false;
  draft = null;
  recordForm.reset();
  setFormMode();
});
recordForm.addEventListener('submit', async event => {
  event.preventDefault(); if (!owner || authBusy || writing || checking || needsRefresh) return;
  recordError.textContent = ''; editDraft();
  const input = readDraft();
  showFieldErrors = true;
  renderFieldErrors(activeErrors(input));
  try { validateActiveDraft(input); } catch {
    recordError.textContent = isWishlist && !transferSource ? 'Проверьте обязательные поля, годы, жанры и ссылку на магазин.' : 'Проверьте заполнение обязательных полей, формат даты и цены.';
    for (const [field, message] of fieldMessages) {
      if (!message.hidden) { formInputs.get(field).focus(); break; }
    }
    return;
  }
  const run = dialogRun;
  checking = true; previewButton.disabled = true; recordFields.disabled = true;
  try {
    const { collection, wishlist } = await additionRecords();
    if (run !== dialogRun || !dialog.open) return;
    const result = checkAddition(input, transferSource ? 'collection' : isWishlist ? 'wishlist' : 'collection', collection, wishlist);
    if (transferSource) {
      result.duplicates = collection.filter(record => isPotentialDuplicate(input, record));
      result.blocked = result.duplicates.length > 0;
    }
    if (result.blocked) {
      recordError.textContent = transferSource ? 'В коллекции уже есть возможное совпадение. Новая запись не создана. Проверьте найденную запись перед завершением удаления из wish-list.' : 'Подтверждённый дубль издания. Проверьте найденные записи.';
      showDuplicates([...result.duplicates, ...result.ownedDuplicates]);
      return;
    }
    draft = input; displayRecord(preview, draft, transferSource ? collectionLabels : labels); preview.hidden = false; recordFields.hidden = true;
    if (result.warnings.length) {
      recordError.textContent = 'Возможный дубль: признаки издания известны не полностью. Проверьте найденные записи; добавление можно подтвердить.';
      for (const record of result.warnings) { const block = document.createElement('div'); displayRecord(block, record); preview.append(block); }
    }
    if (result.ownedAlbums.length) {
      recordError.textContent += ' Этот альбом уже есть в коллекции. Совпадение издания не подтверждено; добавление в wish-list можно подтвердить.';
      for (const record of result.ownedAlbums) { const block = document.createElement('div'); displayRecord(block, record, collectionLabels); preview.append(block); }
    }
    previewButton.hidden = true; confirmButton.hidden = editButton.hidden = false;
  } catch {
    if (run === dialogRun && dialog.open) recordError.textContent = 'Не удалось проверить коллекцию. Добавление не выполнено.';
  } finally {
    if (run === dialogRun) { checking = false; previewButton.disabled = false; recordFields.disabled = false; }
  }
});
function requireRefresh() {
  if (isWishlist && transferSource) needsBothRefresh = true;
  // A read started before the uncertain write cannot unlock further mutations.
  loadVersion++;
  loading = false;
  button.disabled = controls.disabled = false;
  status.textContent = isWishlist ? 'Не удалось подтвердить актуальность данных. Повторите поиск или показ всего wish-list.' : 'Обновите коллекцию перед дальнейшими изменениями.';
  needsRefresh = true;
  document.querySelector('#add-record').disabled = true;
  for (const button of rows.querySelectorAll('button')) button.disabled = true;
}
function messageFor(code) {
  if (isWishlist && code === 'RESULT_UNCONFIRMED') return 'Результат операции не подтверждён. Повторите поиск или показ всего wish-list для проверки актуальных данных.';
  return ({ INVALID_RECORD:'Проверьте заполненные поля.', POTENTIAL_DUPLICATE:'Найдено совпадение издания. Проверьте показанные записи.', RECORD_CHANGED:'Запись изменилась. Показаны актуальные данные; подтвердите удаление заново.', TRANSFER_TARGET_MISMATCH:'Выбранная запись больше не соответствует wish-list. Обновите данные.', NOT_FOUND:'Запись не найдена.', RESULT_UNCONFIRMED:'Результат операции не подтверждён. Обновите коллекцию перед дальнейшими действиями.' })[code] || 'Не удалось выполнить операцию. Обновите коллекцию перед дальнейшими действиями.';
}
async function writeRequest(url, options) {
  let response;
  try { response = await fetch(url, { ...options, headers: { ...options.headers, 'X-CSRF-Token': csrfToken } }); } catch { throw {error:'RESULT_UNCONFIRMED'}; }
  let body;
  try { body = await response.json(); } catch { throw {error:'RESULT_UNCONFIRMED'}; }
  if (response.status === 401 || response.status === 403) {
    applySession({ role: 'guest' });
    authStatus.textContent = 'Войдите снова; действие не повторялось.';
  }
  if (!response.ok) throw body;
  return body;
}
confirmButton.addEventListener('click', async () => {
  if (!owner || authBusy || writing || (!draft && !transferTarget) || needsRefresh) return;
  writing = true; invalidateReads(); confirmButton.disabled = editButton.disabled = true;
  const source = transferSource;
  const target = transferTarget;
  try {
    if (source) {
      const body = target ? { collectionId: target.id, collectionRevision: await recordRevision(target) }
        : Object.fromEntries(purchaseFields.map(field => [field, draft[field]]));
      const result = await writeRequest(`/api/wishlist/${source.id}/transfer`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': await wishlistRevision(source) }, body: JSON.stringify(body) });
      dialog.close();
      operationStatus.textContent = result.status === 'partial'
        ? 'Частичный успех: запись подтверждена в коллекции. Удаление из wish-list не завершено или не подтверждено. Если исходник остался в обновлённом wish-list, повторите перенос и выберите существующую запись.'
        : `Перенесено в коллекцию: ${result.collectionRecord.artist} — ${result.collectionRecord.album}`;
      await refreshBoth();
    } else {
      const created = await writeRequest(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(draft)});
      dialog.close(); operationStatus.textContent = `Добавлено: ${created.artist} — ${created.album}`;
      await showCollection();
    }
  } catch (error) {
    recordError.textContent = messageFor(error.error);
    draft = null; confirmButton.hidden = true;
    if (error.error === 'RESULT_UNCONFIRMED') {
      requireRefresh(); editButton.hidden = true;
      if (source) {
        dialog.close(); operationStatus.textContent = 'Результат переноса не подтверждён. Проверьте актуальный wish-list; повторный перенос сначала проверит коллекцию на совпадения.';
        await refreshBoth();
      }
    }
    if (error.records) { editDraft(); showDuplicates(error.records); }
    if (source && error.error === 'RECORD_CHANGED') {
      recordError.textContent = 'Исходная или выбранная запись изменилась. Данные будут обновлены. Подтвердите перенос заново из актуального wish-list.';
      requireRefresh(); editButton.hidden = true;
      dialog.close(); operationStatus.textContent = recordError.textContent; await refreshBoth();
    }
  } finally { writing = false; button.disabled = controls.disabled = false; confirmButton.disabled = editButton.disabled = false; }
});
const deleteDialog = document.querySelector('#delete-dialog');
const deletePreview = document.querySelector('#delete-preview');
const deleteError = document.querySelector('#delete-error');
const confirmDelete = document.querySelector('#confirm-delete');
let selected = null;
function openDelete(record) { if (!owner || authBusy || needsRefresh || writing) return; selected = record; displayRecord(deletePreview, record); deleteError.textContent = ''; confirmDelete.disabled = false; deleteDialog.showModal(); }
document.querySelector('#cancel-delete').addEventListener('click', () => { if (!writing) deleteDialog.close(); });
deleteDialog.addEventListener('cancel', event => { if (writing) event.preventDefault(); });
deleteDialog.addEventListener('close', () => { selected = null; });
confirmDelete.addEventListener('click', async () => {
  if (!owner || authBusy || writing || !selected || needsRefresh) return;
  writing = true; invalidateReads(); confirmDelete.disabled = true;
  try {
    const deleted = await writeRequest(`${endpoint}/${selected.id}`, {method:'DELETE', headers:{'If-Match':await revisionFor(selected)}});
    deleteDialog.close(); operationStatus.textContent = `Удалено: ${deleted.artist} — ${deleted.album}`;
    await showCollection();
  } catch (error) {
    deleteError.textContent = messageFor(error.error);
    if (error.error === 'RESULT_UNCONFIRMED') requireRefresh();
    if (error.error === 'RECORD_CHANGED' && error.record) { selected = error.record; displayRecord(deletePreview, selected); confirmDelete.disabled = false; }
  } finally { writing = false; button.disabled = controls.disabled = false; }
});

function invalidateReads() {
  loadVersion++;
  loading = false;
  button.disabled = controls.disabled = true;
}
async function openTransfer(record) {
  if (!owner || authBusy || needsRefresh || writing) return;
  ++dialogRun; recordForm.reset(); setFormMode(record); editDraft();
  recordError.textContent = ''; dialog.showModal();
}
function showDuplicates(records) {
  preview.replaceChildren(); preview.hidden = false;
  for (const record of records) {
    const block = document.createElement('div');
    displayRecord(block, record, Object.hasOwn(record, 'storeUrl') ? wishlistLabels : collectionLabels);
    if (transferSource && Object.hasOwn(record, 'purchaseDate')) {
      const choose = document.createElement('button'); choose.type = 'button';
      choose.textContent = 'Эта запись уже в коллекции — завершить удаление из wish-list';
      choose.addEventListener('click', () => {
        transferTarget = record; draft = null; recordFields.hidden = true;
        displayRecord(preview, record, collectionLabels);
        recordError.textContent = 'Будет удалена только показанная исходная запись wish-list. Выбранная запись коллекции не изменится. Проверьте обе записи и подтвердите.';
        previewButton.hidden = true; editButton.hidden = confirmButton.hidden = false;
        confirmButton.textContent = 'Подтвердить удаление из wish-list';
      });
      block.append(choose);
    }
    preview.append(block);
  }
}
async function refreshBoth() {
  needsBothRefresh = isWishlist;
  needsRefresh = true;
  document.querySelector('#add-record').disabled = true;
  return showCollection();
}


const loginDialog = document.querySelector('#login-dialog');
const loginForm = document.querySelector('#login-form');
const passwordInput = document.querySelector('#owner-password');
const loginError = document.querySelector('#login-error');
const authStatus = document.querySelector('#auth-status');
const loginButton = document.querySelector('#owner-login');
const logoutButton = document.querySelector('#owner-logout');

function applySession(session) {
  const nextOwner = session.role === 'owner' && typeof session.csrfToken === 'string';
  const nextToken = nextOwner ? session.csrfToken : null;
  if (owner !== nextOwner || csrfToken !== nextToken) {
    authVersion++; dialogRun++;
    resetResults();
    dialog.close(); deleteDialog.close();
    preview.replaceChildren(); deletePreview.replaceChildren();
    document.querySelector('#transfer-source').replaceChildren();
    for (const field of ['artist', 'album', 'label']) document.querySelector(`#suggest-${field}`).replaceChildren();
    recordForm.reset(); draft = selected = transferSource = transferTarget = null;
    operationStatus.textContent = recordError.textContent = deleteError.textContent = '';
  }
  owner = nextOwner; csrfToken = owner ? session.csrfToken : null;
  loginButton.hidden = owner; logoutButton.hidden = !owner;
  document.querySelector('#add-record').hidden = !owner;
  document.querySelector('#actions-heading').hidden = !owner;
  if (isWishlist) document.querySelector('#store-heading').hidden = !owner;
  authStatus.textContent = '';
}
async function checkSession() {
  const version = ++sessionCheckVersion;
  const authEpoch = authVersion;
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!response.ok) throw Error('session');
    const session = await response.json();
    if (version !== sessionCheckVersion || authEpoch !== authVersion || writing || authBusy) return;
    applySession(session);
  } catch {
    if (version !== sessionCheckVersion || authEpoch !== authVersion || writing || authBusy) return;
    applySession({ role: 'guest' });
    authStatus.textContent = 'Не удалось проверить вход. Попробуйте позже.';
  }
}
loginButton.addEventListener('click', () => {
  if (authBusy || writing) return;
  passwordInput.value = ''; loginError.textContent = ''; loginDialog.showModal(); passwordInput.focus();
});
document.querySelector('#cancel-login').addEventListener('click', () => { if (!authBusy) loginDialog.close(); });
loginDialog.addEventListener('cancel', event => { if (authBusy) event.preventDefault(); });
loginDialog.addEventListener('close', () => { passwordInput.value = ''; });
loginForm.addEventListener('submit', async event => {
  event.preventDefault(); if (authBusy || writing) return;
  authBusy = true; ++authVersion;
  document.querySelector('#submit-login').disabled = true;
  loginError.textContent = '';
  const body = JSON.stringify({ password: passwordInput.value }); passwordInput.value = '';
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!response.ok) {
      loginError.textContent = response.status === 429 ? 'Слишком много попыток. Попробуйте позже.' : response.status === 401 ? 'Неверный пароль.' : 'Вход не выполнен. Попробуйте позже.';
      return;
    }
    applySession(await response.json()); loginDialog.close();
  } catch { loginError.textContent = 'Не удалось связаться с сервером. Попробуйте ещё раз.'; }
  finally { authBusy = false; document.querySelector('#submit-login').disabled = false; }
});
logoutButton.addEventListener('click', async () => {
  if (authBusy || writing) return;
  authBusy = true; ++authVersion; logoutButton.disabled = true;
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
    if (!response.ok && response.status !== 401) throw Error('logout');
    applySession({ role: 'guest' });
  } catch { authStatus.textContent = 'Выход не подтверждён. Повторите выход.'; }
  finally { authBusy = false; logoutButton.disabled = false; }
});
document.addEventListener('DOMContentLoaded', async () => { resetResults(); await checkSession(); });
window.addEventListener('focus', () => { if (!authBusy && !writing) void checkSession(); });
