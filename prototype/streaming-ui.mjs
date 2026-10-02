import { appleAlbumLinks } from '../src/streaming.mjs';

const messages = {
  STREAMING_TIMEOUT: 'Поиск занял слишком много времени. Попробуйте ещё раз.',
  STREAMING_RATE_LIMITED: 'Слишком много запросов. Попробуйте позже.',
  RATE_LIMITED: 'Слишком много запросов. Попробуйте позже.',
  STREAMING_BUSY: 'Поиск сейчас занят. Попробуйте чуть позже.',
  STREAMING_INVALID_RESPONSE: 'Apple вернул некорректный ответ. Попробуйте позже.',
  STREAMING_UNAVAILABLE: 'Поиск Apple временно недоступен. Попробуйте позже.',
  INTERNAL_ERROR: 'Не удалось выполнить поиск из-за ошибки приложения.'
};
// One disposable player belongs to its host dialog/detail. No work before click.
export function mountStreaming({ document, target, record, fetch: request }) {
  const root = document.createElement('section'); root.className = 'streaming';
  root.setAttribute('aria-label', 'Прослушивание альбома');
  const action = document.createElement('button'); action.type = 'button'; action.textContent = 'Прослушать';
  const attribution = document.createElement('p'); attribution.className = 'streaming-note';
  attribution.textContent = 'Плеер предоставляется Apple Music. Доступность и длительность фрагментов определяет Apple.';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const output = document.createElement('div'); output.className = 'streaming-output';
  root.append(action, attribution, status, output); target.append(root);
  let disposed = false, busy = false, region = 'ru', controller = null;
  function showAlbum(candidate) {
    const links = appleAlbumLinks(candidate.url, region);
    if (!links || disposed) return;
    output.replaceChildren(); action.hidden = true;
    status.textContent = `${candidate.artist} — ${candidate.album} (${candidate.year})`;
    const link = document.createElement('a'); link.textContent = 'Открыть в Apple Music ↗';
    link.href = links.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const frame = document.createElement('iframe'); frame.src = links.embedUrl;
    frame.title = `Apple Music: ${candidate.artist} — ${candidate.album}`;
    frame.setAttribute('allow', 'encrypted-media; fullscreen'); frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.className = 'apple-player'; frame.setAttribute('height', '450');
    const hint = document.createElement('p'); hint.className = 'streaming-note';
    hint.textContent = 'Если плеер не загружается или фрагмент недоступен, откройте альбом в Apple Music.';
    output.append(frame, link, hint);
  }
  async function lookup() {
    if (busy || disposed) return;
    busy = true; action.disabled = true; output.replaceChildren(); status.textContent = 'Ищем альбом…';
    controller = new AbortController();
    try {
      let result;
      // A single user action searches the existing storefronts in order.
      for (const storefront of ['ru', 'us']) {
        region = storefront;
        const response = await request('/api/streaming/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: controller.signal, body: JSON.stringify({ artist: record.artist, album: record.album, albumYear: record.albumYear, storefront: region }) });
        try { result = await response.json(); } catch { throw Error('INTERNAL_ERROR'); }
        if (disposed) return;
        if (!response.ok) throw Error(result?.error || 'INTERNAL_ERROR');
        if (!result || result.storefront !== region || !['matched', 'ambiguous', 'not_found'].includes(result.status) ||
            !Array.isArray(result.candidates) || result.candidates.length > 5 ||
            (result.status === 'matched' && result.candidates.length !== 1) ||
            (result.status === 'not_found' && result.candidates.length !== 0) ||
            (result.status === 'ambiguous' && !result.candidates.length) ||
            result.candidates.some(c => !c || !['artist', 'album', 'year'].every(k => typeof c[k] === 'string') || !appleAlbumLinks(c.url, region))) throw Error('INTERNAL_ERROR');
        if (result.status !== 'not_found') break;
      }
      action.hidden = true;
      if (result.status === 'matched') showAlbum(result.candidates[0]);
      else if (result.status === 'ambiguous') {
        status.textContent = 'Выберите подходящее издание:';
        for (const candidate of result.candidates) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'button-secondary streaming-candidate';
          button.textContent = `${candidate.artist} — ${candidate.album} (${candidate.year})`;
          button.addEventListener('click', () => showAlbum(candidate)); output.append(button);
        }
      } else {
        status.textContent = 'Альбом не найден';
      }
    } catch (error) {
      if (disposed) return;
      status.textContent = messages[error.message] || 'Не удалось связаться с приложением. Попробуйте ещё раз.';
      action.hidden = false; action.textContent = 'Повторить поиск';
    } finally { busy = false; if (!disposed) action.disabled = false; }
  }
  action.addEventListener('click', lookup);
  return () => { disposed = true; controller?.abort(); output.replaceChildren(); };
}

// Desktop-only read presentation. Cover management and mobile detail remain independent.
export function createStreamingDialog({ document, fetch, cover, media, isBusy }) {
  const get = id => document.querySelector(`#${id}`);
  const dialog = get('streaming-dialog'), content = get('streaming-content');
  let dispose = null, trigger = null;
  function clear() { dispose?.(); dispose = null; content.replaceChildren(); }
  dialog.addEventListener('close', () => {
    clear();
    if (media.matches) get('mobile-sort-field').focus();
    else if (trigger && get('table-container').contains(trigger)) trigger.focus();
    trigger = null;
  });
  get('close-streaming').addEventListener('click', () => dialog.close());
  media.addEventListener('change', () => { if (dialog.open) { dialog.close(); clear(); } });
  return {
    reset() { trigger = null; if (dialog.open) dialog.close(); clear(); },
    open(record, source) {
      if (media.matches || isBusy() || dialog.open) return;
      clear(); trigger = source;
      get('streaming-title').textContent = `${record.artist} — ${record.album}`;
      const artwork = cover(record);
      if (artwork) {
        const image = document.createElement('img'); image.src = artwork.imageUrl;
        image.className = 'streaming-cover'; image.alt = `Обложка: ${record.artist} — ${record.album}`;
        content.append(image);
      }
      dispose = mountStreaming({ document, target: content, record, fetch });
      dialog.showModal(); get('close-streaming').focus();
    }
  };

}
