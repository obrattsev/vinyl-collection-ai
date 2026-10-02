// Streaming metadata is transient; never part of a stored record or its revision.
export const normalizeStreaming = value => value.normalize('NFKC').toLowerCase()
  .replace(/[‘’ʼ]/gu, "'").replace(/[“”]/gu, '"').replace(/[‐‑–—]/gu, '-').trim().replace(/\s+/gu, ' ');
export function appleAlbumLinks(value, storefront) {
  if (!['ru', 'us'].includes(storefront) || typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.port || url.username || url.password || url.hash) return null;
    const match = url.pathname.match(/^\/(ru|us)\/album\/(?:[^/]+\/)?([1-9]\d{0,19})$/);
    if (!match || match[1] !== storefront) return null;
    // Keep the provider's path and region; discard affiliate and other query parameters.
    return { url: `https://music.apple.com${url.pathname}`, embedUrl: `https://embed.music.apple.com${url.pathname}`, id: match[2] };
  } catch { return null; }
}
