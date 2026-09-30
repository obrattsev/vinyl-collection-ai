// Presentation only: the application owns records, sorting and every CRUD operation.
export function createMobileRecords({ document, media, labels, publicFields, display, isOwner, canAct, isBusy,
  openEdit, openDelete, openTransfer, wishlist, desktopResults, cover, favorite }) {
  const get = id => document.querySelector(`#${id}`);
  const root = get('mobile-results'), list = get('mobile-records'), detail = get('detail-dialog');
  const content = get('detail-content'), actions = get('detail-actions');
  const status = get('status');
  let focusRecord = null, buttons = new Map(), quickButtons = new Map(), handingOff = false;
  const key = record => record.id?.toLowerCase() || record;
  function restoreFocus(kind) {
    if (focusRecord === null || isBusy() || detail.open) return;
    const button = quickButtons.get(focusRecord)?.[kind] || buttons.get(focusRecord);
    if (media.matches && button) button.focus();
    else if (!media.matches && !desktopResults.hidden) desktopResults.focus();
    else status.focus();
    focusRecord = null;
  }
  function clearDetail() { content.replaceChildren(); actions.replaceChildren(); }
  detail.addEventListener('close', () => { clearDetail(); if (!handingOff) setTimeout(restoreFocus, 0); });
  get('close-detail').addEventListener('click', () => detail.close());
  function open(record) {
    if (isBusy()) return;
    focusRecord = key(record);
    display(content, record, isOwner() ? labels : Object.fromEntries(publicFields.map(field => [field, labels[field]])));
    actions.replaceChildren();
    if (isOwner()) {
      for (const [title, callback] of [['Редактировать', openEdit], ['Удалить', openDelete], ...(wishlist ? [['Добавить в коллекцию', openTransfer]] : [])]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = title;
        button.className = 'button-secondary'; button.disabled = !canAct();
        button.addEventListener('click', () => {
          if (!canAct()) return;
          handingOff = true; detail.close(); clearDetail(); callback(record); handingOff = false;
        });
        actions.append(button);
      }
    }
    detail.showModal(); get('close-detail').focus();
  }
  media.addEventListener('change', () => {
    // CSS changes the presentation; no fetch and no independent list/sort state.
    if (detail.open) { detail.close(); clearDetail(); return; }
    const focusedRecord = [...buttons].find(([, button]) => button === document.activeElement);
    if (focusedRecord) { focusRecord = focusedRecord[0]; restoreFocus(); }
    else if (media.matches && desktopResults.contains(document.activeElement) && !isBusy()) get('mobile-sort-field').focus();
  });
  return {
    restoreFocus,
    suspendDetail(record) {
      focusRecord = key(record); handingOff = true;
      if (detail.open) detail.close();
      clearDetail(); handingOff = false;
    },
    reset(forgetFocus = false) {
      if (forgetFocus) focusRecord = null;
      if (detail.open) detail.close();
      clearDetail(); buttons.clear(); quickButtons.clear(); list.replaceChildren(); root.hidden = true;
    },
    render(records) {
      buttons = new Map(); quickButtons = new Map(); list.replaceChildren();
      for (const record of records) {
        const item = document.createElement('li');
        const button = document.createElement('button'); button.type = 'button'; button.className = 'compact-record';
        button.setAttribute('aria-haspopup', 'dialog');
        for (const field of ['artist', 'album']) {
          const value = document.createElement('span'); value.className = `compact-${field}`;
          value.textContent = record[field] ?? '—'; button.append(value);
        }
        const metadata = document.createElement('span'); metadata.className = 'compact-metadata';
        metadata.textContent = [record.albumYear, record.genre].filter(value => value != null && value !== '').join(' · ') || '—';
        button.append(metadata);
        button.addEventListener('click', () => open(record)); buttons.set(key(record), button);
        item.className = 'compact-item';
        const coverButton = cover?.(record);
        if (coverButton) item.append(coverButton);
        item.append(button);
        const favoriteButton = wishlist ? null : favorite?.(record);
        if (favoriteButton) item.append(favoriteButton);
        quickButtons.set(key(record), { cover: coverButton, favorite: favoriteButton });
        list.append(item);
      }
      root.hidden = !records.length;
    }
  };
}
