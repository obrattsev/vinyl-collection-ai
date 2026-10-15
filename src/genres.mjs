import { normalize } from './collection-rules.mjs';
// Closed choices for the manual collection form, not a migration of stored genres.
export const GENRES = Object.freeze([
  'Rock', 'Pop', 'Jazz', 'Blues', 'Soul', 'R&B', 'Funk', 'Disco', 'Folk',
  'Country', 'Reggae', 'Ska', 'Punk', 'New Wave', 'Post-Punk', 'Alternative',
  'Indie', 'Metal', 'Electronic', 'Ambient', 'Classical', 'Soundtrack', 'Hip-Hop',
  'New Age', 'Various', 'Experimental', 'Psychedelic Rock', 'Progressive Rock', 'Hard Rock', 'Folk Rock', 'Garage Rock'
]);

const alphabet = new Intl.Collator('ru', { sensitivity: 'variant' });
const compareLabel = (a, b) => alphabet.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const canonicalGenres = new Map(GENRES.map(genre => [normalize(genre), genre]));

// Input must be the complete, authorized list, not its filtered display slice.
// Do not read the other list or introduce a shared user/global genre cache.
export function genresInRecords(records) {
  const counts = new Map();
  for (const record of records) {
    const seen = new Set();
    for (const raw of [record.genre, record.additionalGenre]) {
      if (typeof raw !== 'string') continue;
      const key = normalize(raw);
      if (!key) continue;
      const label = canonicalGenres.get(key) || raw.trim().replace(/\s+/gu, ' ');
      const existing = counts.get(key);
      if (!existing) counts.set(key, { label, count: 1 });
      else {
        if (!seen.has(key)) existing.count++;
        if (compareLabel(label, existing.label) < 0) existing.label = label;
      }
      seen.add(key);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || compareLabel(a.label, b.label)).map(item => item.label);
}
