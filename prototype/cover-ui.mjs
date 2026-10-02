import { coverPresentation } from '../src/cover-record.mjs';

// Shared by the existing Cover dialog and the optional initial Add field.
export function coverFileError(file) {
  return !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024
    ? 'Выберите JPEG, PNG или WebP до 10 MiB. HEIC/HEIF пока не поддерживается.' : '';
}

export function createAddCoverField({ document, isOpen, onChange }) {
  const get = id => document.querySelector(`#${id}`);
  const root = get('add-cover-field'), input = get('add-cover-file'), preview = get('add-cover-preview'), error = get('add-cover-error');
  const remove = get('clear-add-cover');
  let chosen = null, epoch = 0, pending = false;
  function clear() { epoch++; chosen = null; pending = false; input.value = ''; remove.hidden = true; preview.replaceChildren(); preview.hidden = true; error.textContent = ''; }
  input.addEventListener('change', () => {
    const run = ++epoch; chosen = null; pending = false; preview.replaceChildren(); preview.hidden = true; error.textContent = '';
    onChange();
    const file = input.files?.[0]; remove.hidden = !file; if (!file) return;
    error.textContent = coverFileError(file); if (error.textContent) return;
    pending = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (run !== epoch || !isOpen()) return;
      pending = false; chosen = file;
      const image = document.createElement('img'); image.src = reader.result; image.alt = 'Выбранная обложка';
      preview.append(image); preview.hidden = false;
    };
    reader.onerror = () => { if (run === epoch && isOpen()) { pending = false; error.textContent = 'Не удалось прочитать изображение.'; } };
    reader.readAsDataURL(file);
  });
  remove.addEventListener('click', () => { clear(); onChange(); });
  return {
    reset: clear,
    show(value) { root.hidden = !value; },
    disable(value) { input.disabled = remove.disabled = value; },
    get file() { return chosen; },
    validate() { return !pending && !error.textContent; },
    get pending() { return pending; }
  };
}

export const recordCover = record => record.cover ?? coverPresentation(record.coverId);
export function coverControl(document, record, owner, open, large = false) {
  const cover = recordCover(record);
  if (!cover && !owner) return null;
  const button = document.createElement('button'); button.type = 'button';
  button.className = large ? 'cover-control cover-large' : 'cover-control';
  const title = cover ? owner ? 'Управление обложкой' : 'Просмотреть обложку' : 'Добавить обложку';
  button.title = title; button.setAttribute('aria-label', `${title}: ${record.artist} — ${record.album}`);
  if (cover) {
    const image = document.createElement('img'); image.src = large ? cover.imageUrl : cover.thumbnailUrl;
    image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    image.addEventListener('error', () => { image.hidden = true; button.className = 'cover-control'; button.textContent = owner ? '+' : 'Обложка недоступна'; });
    button.append(image);
  } else button.textContent = '+';
  button.addEventListener('click', () => open(record, button));
  return button;
}

export function favoriteControl(document, record, owner, toggle) {
  if (typeof record.favorite !== 'boolean') return null;
  const node = document.createElement(owner ? 'button' : 'span');
  node.className = 'favorite-note'; node.textContent = '♪';
  node.setAttribute('data-active', String(record.favorite));
  const label = owner ? record.favorite ? 'Убрать из избранного' : 'Добавить в избранное' : record.favorite ? 'В избранном' : 'Не в избранном';
  node.setAttribute('aria-label', `${label}: ${record.artist} — ${record.album}`); node.title = label;
  if (owner) { node.type = 'button'; node.setAttribute('aria-pressed', String(record.favorite)); node.addEventListener('click', () => toggle(record)); }
  else node.setAttribute('role', 'img');
  return node;
}

export function createCoverDialog({ document, isOwner, canAct, mutate, onClose }) {
  const get = id => document.querySelector(`#${id}`);
  const dialog = get('cover-dialog'), file = get('cover-file'), preview = get('cover-preview'), error = get('cover-error');
  const save = get('save-cover'), remove = get('remove-cover'), confirm = get('confirm-remove-cover'), cancelRemove = get('cancel-remove-cover');
  let record = null, chosen = null, busy = false, readEpoch = 0;
  const resetDelete = () => { get('cover-delete-confirmation').hidden = true; };
  function image(url) {
    preview.replaceChildren(); preview.hidden = !url;
    if (url) { const node = document.createElement('img'); node.src = url; node.alt = 'Обложка пластинки'; preview.append(node); }
  }
  function controls() {
    file.disabled = save.disabled = remove.disabled = confirm.disabled = cancelRemove.disabled = get('close-cover').disabled = busy;
    if (!busy) save.disabled = !chosen || !canAct();
  }
  file.addEventListener('change', () => {
    const epoch = ++readEpoch; chosen = null; error.textContent = ''; resetDelete(); controls();
    const candidate = file.files?.[0];
    if (!candidate) { image(recordCover(record)?.imageUrl); return; }
    const invalid = coverFileError(candidate);
    if (invalid) { error.textContent = invalid; return; }
    const reader = new FileReader();
    reader.onload = () => { if (epoch !== readEpoch || !dialog.open) return; chosen = candidate; image(reader.result); controls(); };
    reader.onerror = () => { if (epoch === readEpoch) error.textContent = 'Не удалось прочитать изображение.'; };
    reader.readAsDataURL(candidate);
  });
  async function send(deleting) {
    if (busy || !record || !canAct() || (!deleting && !chosen)) return;
    busy = true; controls(); error.textContent = '';
    try { await mutate(record, deleting ? null : chosen); dialog.close(); }
    catch (cause) { if (dialog.open) error.textContent = cause.message || 'Сохранение не подтверждено. Закройте окно и обновите список; автоматического повтора нет.'; }
    finally { busy = false; controls(); }
  }
  save.addEventListener('click', () => send(false));
  remove.addEventListener('click', () => { if (!busy && canAct()) { get('cover-delete-confirmation').hidden = false; confirm.focus(); } });
  cancelRemove.addEventListener('click', resetDelete);
  confirm.addEventListener('click', () => { if (!get('cover-delete-confirmation').hidden) return send(true); });
  get('close-cover').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { readEpoch++; chosen = record = null; file.value = ''; image(null); onClose(); });
  return {
    reset() { readEpoch++; if (dialog.open) dialog.close(); chosen = record = null; file.value = ''; image(null); error.textContent = ''; },
    open(value) {
      if (busy) return;
      record = value; chosen = null; file.value = ''; error.textContent = ''; resetDelete();
      const owner = isOwner(); get('cover-owner-controls').hidden = !owner;
      save.hidden = !owner; remove.hidden = !owner || !recordCover(record);
      get('cover-file-label').textContent = recordCover(record) ? 'Заменить обложку' : 'Добавить обложку';
      get('cover-title').textContent = `Обложка: ${record.artist} — ${record.album}`;
      image(recordCover(record)?.imageUrl); controls(); dialog.showModal(); get('close-cover').focus();
    }
  };
}
