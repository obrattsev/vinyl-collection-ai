import { GENRES } from '../src/genres.mjs';
import { bindInputConstraint, formatDateInput, formatPriceInput } from './input-controls.mjs';
import { validateDraft, recordRevision, draftFieldErrors } from '../src/collection-record.mjs';
import { searchCollection, validateSearchCriteria, checkAddition } from '../src/collection-rules.mjs';

const button = document.querySelector('#load-collection');
const form = document.querySelector('#search-form');
const controls = document.querySelector('#search-controls');
const criteriaError = document.querySelector('#criteria-error');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const container = document.querySelector('#table-container');
const rows = document.querySelector('#records');
const fields = ['artist', 'album', 'genre', 'additionalGenre', 'label', 'albumYear', 'recordYear', 'editionType'];
let loading = false;
let loadVersion = 0;
let needsRefresh = false;

form.addEventListener('reset', () => {
  criteriaError.hidden = true;
  criteriaError.textContent = '';
});

form.addEventListener('submit', event => {
  event.preventDefault();
  if (loading) return;
  const criteria = Object.fromEntries(new FormData(form));
  criteriaError.hidden = true;
  try {
    validateSearchCriteria(criteria);
  } catch (validationError) {
    criteriaError.textContent = validationError.message;
    criteriaError.hidden = false;
    return;
  }
  showCollection(criteria);
});

button.addEventListener('click', () => showCollection());

async function showCollection(criteria = {}) {
  const version = ++loadVersion;
  loading = true;
  button.disabled = true;
  controls.disabled = true;
  criteriaError.hidden = true;
  status.textContent = 'Загрузка коллекции…';
  error.hidden = true;
  error.textContent = '';
  container.hidden = true;
  rows.replaceChildren();

  try {
    const response = await fetch('/api/collection', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить коллекцию.');
    const records = await response.json();
    if (version !== loadVersion) return;
    if (!Array.isArray(records) || records.some(record =>
      record === null || typeof record !== 'object' || Array.isArray(record) ||
      fields.some(field => record[field] != null && !['string', 'number'].includes(typeof record[field]))
    )) throw new Error('Некорректный формат данных.');

    const results = searchCollection(records, criteria);
    needsRefresh = false;
    document.querySelector('#add-record').disabled = false;
    if (records.length === 0) {
      status.textContent = 'Коллекция пуста';
      return;
    }
    if (results.length === 0) {
      status.textContent = 'По поисковому запросу пластинок не найдено';
      return;
    }
    renderRecords(results);
    status.textContent = `Показано записей: ${results.length}`;
  } catch {
    if (version !== loadVersion) return;
    status.textContent = '';
    error.textContent = 'Ошибка загрузки данных. Не удалось загрузить коллекцию.';
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
    for (const field of fields) {
      const cell = document.createElement('td');
      cell.textContent = record[field] ?? '';
      row.append(cell);
    }
    const action = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = 'Удалить';
    remove.setAttribute('aria-label', `Удалить: ${record.artist} — ${record.album}`);
    remove.addEventListener('click', () => openDelete(record));
    action.append(remove); row.append(action);
    fragment.append(row);
  }
  rows.append(fragment);
  container.hidden = false;
}

const labels = { artist:'Исполнитель', album:'Альбом', genre:'Жанр', additionalGenre:'Дополнительный жанр', label:'Лейбл', albumYear:'Год альбома', recordYear:'Год пластинки', editionType:'Тип издания', note:'Примечание', purchaseDate:'Дата покупки', purchaseStore:'Магазин покупки', purchasePrice:'Цена покупки (руб.)' };
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
for (const [name, title] of Object.entries(labels)) {
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
    if (name.endsWith('Year')) { input.inputMode = 'numeric'; input.placeholder = 'YYYY'; }
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
  if (name === 'purchaseDate') bindInputConstraint(input, formatDateInput);
  if (name === 'purchasePrice') bindInputConstraint(input, formatPriceInput);

}
function readDraft() {
  const input = Object.fromEntries(new FormData(recordForm));
  for (const key of Object.keys(input)) if (!input[key].trim()) input[key] = null;
  if (input.purchasePrice !== null) {
    const price = formatPriceInput(input.purchasePrice);
    input.purchasePrice = price === null ? NaN : Number(price);
  }
  return input;
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
  const errors = draftFieldErrors(readDraft());
  renderFieldErrors(errors);
  if (!Object.keys(errors).length) recordError.textContent = '';
}
recordForm.addEventListener('input', updateFieldErrors);
recordForm.addEventListener('change', updateFieldErrors);
recordForm.addEventListener('reset', () => { showFieldErrors = false; renderFieldErrors(); });

function displayRecord(target, record) {
  const list = document.createElement('dl');
  for (const [field, title] of Object.entries(labels)) {
    const term = document.createElement('dt'); term.textContent = title;
    const value = document.createElement('dd'); value.textContent = record[field] ?? '';
    list.append(term, value);
  }
  target.replaceChildren(list);
}
async function loadRecords() {
  const response = await fetch('/api/collection', {cache:'no-store'});
  if (!response.ok) throw new Error('load');
  return response.json();
}
function editDraft() {
  draft = null; recordFields.hidden = false; preview.hidden = true;
  confirmButton.hidden = editButton.hidden = true; previewButton.hidden = false;
}
document.querySelector('#add-record').addEventListener('click', async () => {
  if (needsRefresh || writing) return;
  const run = ++dialogRun;
  recordForm.reset(); editDraft(); recordError.textContent = ''; dialog.showModal();
  try {
    const records = await loadRecords();
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
  previewButton.disabled = false;
  draft = null;
  recordForm.reset();
});
recordForm.addEventListener('submit', async event => {
  event.preventDefault(); if (writing || checking || needsRefresh) return;
  recordError.textContent = ''; editDraft();
  const input = readDraft();
  showFieldErrors = true;
  renderFieldErrors(draftFieldErrors(input));
  try { validateDraft(input); } catch {
    recordError.textContent = 'Проверьте заполнение обязательных полей, формат даты и цены.';
    for (const [field, message] of fieldMessages) {
      if (!message.hidden) { formInputs.get(field).focus(); break; }
    }
    return;
  }
  const run = dialogRun;
  checking = true; previewButton.disabled = true;
  try {
    const records = await loadRecords();
    if (run !== dialogRun || !dialog.open) return;
    const { duplicates } = checkAddition(input, 'collection', records);
    if (duplicates.length) { recordError.textContent = 'Потенциальный дубль. Уточните признаки издания.'; preview.replaceChildren(); for (const record of duplicates) { const block = document.createElement('div'); displayRecord(block, record); preview.append(block); } preview.hidden = false; return; }
    draft = input; displayRecord(preview, draft); preview.hidden = false; recordFields.hidden = true;
    previewButton.hidden = true; confirmButton.hidden = editButton.hidden = false;
  } catch {
    if (run === dialogRun && dialog.open) recordError.textContent = 'Не удалось проверить коллекцию. Добавление не выполнено.';
  } finally {
    if (run === dialogRun) { checking = false; previewButton.disabled = false; }
  }
});
function requireRefresh() {
  // A read started before the uncertain write cannot unlock further mutations.
  loadVersion++;
  loading = false;
  button.disabled = controls.disabled = false;
  status.textContent = 'Обновите коллекцию перед дальнейшими изменениями.';
  needsRefresh = true;
  document.querySelector('#add-record').disabled = true;
  for (const button of rows.querySelectorAll('button')) button.disabled = true;
}
function messageFor(code) {
  return ({ INVALID_RECORD:'Проверьте заполненные поля.', POTENTIAL_DUPLICATE:'Потенциальный дубль. Уточните признаки издания.', RECORD_CHANGED:'Запись изменилась. Показаны актуальные данные; подтвердите удаление заново.', NOT_FOUND:'Запись не найдена.', RESULT_UNCONFIRMED:'Результат операции не подтверждён. Обновите коллекцию перед дальнейшими действиями.' })[code] || 'Не удалось выполнить операцию. Обновите коллекцию перед дальнейшими действиями.';
}
async function writeRequest(url, options) {
  let response;
  try { response = await fetch(url, options); } catch { throw {error:'RESULT_UNCONFIRMED'}; }
  let body;
  try { body = await response.json(); } catch { throw {error:'RESULT_UNCONFIRMED'}; }
  if (!response.ok) throw body;
  return body;
}
confirmButton.addEventListener('click', async () => {
  if (writing || !draft) return;
  writing = true; confirmButton.disabled = editButton.disabled = true;
  try {
    const created = await writeRequest('/api/collection', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(draft)});
    dialog.close(); operationStatus.textContent = `Добавлено: ${created.artist} — ${created.album}`;
    await showCollection();
  } catch (error) {
    recordError.textContent = messageFor(error.error);
    draft = null; confirmButton.hidden = true;
    if (error.error === 'RESULT_UNCONFIRMED') { requireRefresh(); editButton.hidden = true; }
    if (error.records) { preview.replaceChildren(); for (const record of error.records) { const block = document.createElement('div'); displayRecord(block, record); preview.append(block); } }
  } finally { writing = false; confirmButton.disabled = editButton.disabled = false; }
});
const deleteDialog = document.querySelector('#delete-dialog');
const deletePreview = document.querySelector('#delete-preview');
const deleteError = document.querySelector('#delete-error');
const confirmDelete = document.querySelector('#confirm-delete');
let selected = null;
function openDelete(record) { if (needsRefresh || writing) return; selected = record; displayRecord(deletePreview, record); deleteError.textContent = ''; confirmDelete.disabled = false; deleteDialog.showModal(); }
document.querySelector('#cancel-delete').addEventListener('click', () => { if (!writing) deleteDialog.close(); });
deleteDialog.addEventListener('cancel', event => { if (writing) event.preventDefault(); });
deleteDialog.addEventListener('close', () => { selected = null; });
confirmDelete.addEventListener('click', async () => {
  if (writing || !selected) return;
  writing = true; confirmDelete.disabled = true;
  try {
    const deleted = await writeRequest(`/api/collection/${selected.id}`, {method:'DELETE', headers:{'If-Match':await recordRevision(selected)}});
    deleteDialog.close(); operationStatus.textContent = `Удалено: ${deleted.artist} — ${deleted.album}`;
    await showCollection();
  } catch (error) {
    deleteError.textContent = messageFor(error.error);
    if (error.error === 'RESULT_UNCONFIRMED') requireRefresh();
    if (error.error === 'RECORD_CHANGED' && error.record) { selected = error.record; displayRecord(deletePreview, selected); confirmDelete.disabled = false; }
  } finally { writing = false; }
});
