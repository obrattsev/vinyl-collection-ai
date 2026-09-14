const button = document.querySelector('#load-collection');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const container = document.querySelector('#table-container');
const rows = document.querySelector('#records');
const fields = ['artist', 'album', 'genre', 'label', 'albumYear', 'recordYear', 'editionType'];

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Загрузка коллекции…';
  error.hidden = true;
  error.textContent = '';
  container.hidden = true;
  rows.replaceChildren();

  try {
    const response = await fetch('data/collection.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось прочитать файл коллекции.');
    const records = await response.json();
    if (!Array.isArray(records) || records.some(record =>
      record === null || typeof record !== 'object' || Array.isArray(record) ||
      fields.some(field => record[field] != null && !['string', 'number'].includes(typeof record[field]))
    )) throw new Error('Некорректный формат данных.');

    if (records.length === 0) {
      status.textContent = 'Коллекция пуста';
      return;
    }

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
    status.textContent = `Записей в коллекции: ${records.length}`;
  } catch {
    status.textContent = '';
    error.textContent = 'Ошибка загрузки данных. Не удалось загрузить коллекцию.';
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});
