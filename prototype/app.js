import { searchCollection, validateSearchCriteria } from '../src/collection-rules.mjs';

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
  if (loading) return;
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
    if (!Array.isArray(records) || records.some(record =>
      record === null || typeof record !== 'object' || Array.isArray(record) ||
      fields.some(field => record[field] != null && !['string', 'number'].includes(typeof record[field]))
    )) throw new Error('Некорректный формат данных.');

    const results = searchCollection(records, criteria);
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
    status.textContent = '';
    error.textContent = 'Ошибка загрузки данных. Не удалось загрузить коллекцию.';
    error.hidden = false;
  } finally {
    loading = false;
    button.disabled = false;
    controls.disabled = false;
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
    fragment.append(row);
  }
  rows.append(fragment);
  container.hidden = false;
}
