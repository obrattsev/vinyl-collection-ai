const sections = ['collection', 'wishlist', 'both'];
export function quoteCandidates(source, section) {
  if (!Array.isArray(source) || !sections.slice(0, 2).includes(section)) return [];
  const ids = new Set();
  const valid = source.filter(item => {
    if (!item || ['id', 'artist', 'song', 'quote'].some(key => typeof item[key] !== 'string' || !item[key].trim()) ||
        !sections.includes(item.section) || ids.has(item.id)) return false;
    ids.add(item.id); return true;
  });
  return valid.filter(item => item.section === section || item.section === 'both').sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function selectDailyQuote(source, section, date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  const candidates = quoteCandidates(source, section);
  if (!candidates.length) return null;
  // Extract local calendar components first; UTC arithmetic avoids 23/25-hour days.
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const index = ((day + (section === 'wishlist' ? 1 : 0)) % candidates.length + candidates.length) % candidates.length;
  return candidates[index];
}
