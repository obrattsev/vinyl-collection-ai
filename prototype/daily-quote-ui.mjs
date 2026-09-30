import { selectDailyQuote } from '../src/daily-quote.mjs';

export function renderQuote(document, root, quote) {
  root.replaceChildren(); root.hidden = !quote;
  if (!quote) return;
  const words = document.createElement('blockquote'); words.textContent = quote.quote;
  const attribution = document.createElement('figcaption'); attribution.textContent = `${quote.artist} — ${quote.song}`;
  root.append(words, attribution);
}
export async function bindDailyQuote({ document, window, fetch, section, now = () => new Date() }) {
  const root = document.querySelector('#daily-quote'); let source = [], timer;
  function update() {
    clearTimeout(timer);
    const date = now(); renderQuote(document, root, selectDailyQuote(source, section, date));
    const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    timer = setTimeout(update, Math.max(1000, tomorrow - date));
    timer.unref?.();
  }
  try { const response = await fetch('/assets/data/music-quotes.json', { cache: 'no-store' }); if (response.ok) source = await response.json(); }
  catch { /* Curated content is optional, never a dependency of collection UI. */ }
  update();
  window.addEventListener('focus', update);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  return () => clearTimeout(timer);
}
