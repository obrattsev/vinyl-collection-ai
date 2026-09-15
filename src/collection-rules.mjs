// Shared comparisons for already validated records. No storage or UI side effects.
export function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function sameAlbum(left, right) {
  return ['artist', 'album'].every(field => normalize(left[field]) === normalize(right[field]));
}

export function isPotentialDuplicate(left, right) {
  if (!sameAlbum(left, right)) return false;
  return !['label', 'recordYear', 'editionType'].some(field => {
    const a = normalize(left[field]);
    const b = normalize(right[field]);
    return a !== '' && b !== '' && a !== b;
  });
}

export function checkAddition(candidate, target, collection, wishlist = []) {
  if (!['collection', 'wishlist'].includes(target)) throw new Error('Unknown target');
  const ownRecords = target === 'collection' ? collection : wishlist;
  const duplicates = ownRecords.filter(record => isPotentialDuplicate(candidate, record));
  const ownedAlbums = target === 'wishlist'
    ? collection.filter(record => sameAlbum(candidate, record)) : [];
  const ownedDuplicates = ownedAlbums.filter(record => isPotentialDuplicate(candidate, record));
  return { blocked: duplicates.length > 0 || ownedDuplicates.length > 0,
    duplicates, ownedAlbums, ownedDuplicates };
}

export function genresAreDistinct(record) {
  const additional = normalize(record.additionalGenre);
  return additional === '' || additional !== normalize(record.genre);
}

export function matchesGenre(record, value, mode) {
  const expected = normalize(value);
  if (expected === '') return true;
  if (!['exact', 'contains'].includes(mode)) throw new Error('Explicit matching mode required');
  return [record.genre, record.additionalGenre].some(genre => {
    const actual = normalize(genre);
    return mode === 'exact' ? actual === expected : actual.includes(expected);
  });
}
