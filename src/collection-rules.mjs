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

// Unknown edition attributes are not evidence of equality.
export function isConfirmedDuplicate(left, right) {
  return sameAlbum(left, right) && ['label', 'recordYear', 'editionType'].every(field => {
    const value = normalize(left[field]);
    return value !== '' && value === normalize(right[field]);
  });
}

export function checkAddition(candidate, target, collection, wishlist = []) {
  if (!['collection', 'wishlist'].includes(target)) throw new Error('Unknown target');
  const ownRecords = target === 'collection' ? collection : wishlist;
  const duplicates = ownRecords.filter(record => isConfirmedDuplicate(candidate, record));
  const warnings = ownRecords.filter(record => isPotentialDuplicate(candidate, record) && !isConfirmedDuplicate(candidate, record));
  const ownedAlbums = target === 'wishlist'
    ? collection.filter(record => sameAlbum(candidate, record)) : [];
  const ownedDuplicates = ownedAlbums.filter(record => isConfirmedDuplicate(candidate, record));
  return { blocked: duplicates.length > 0 || ownedDuplicates.length > 0,
    duplicates, warnings, ownedAlbums, ownedDuplicates };
}

export function genresAreDistinct(record) {
  const additional = normalize(record.additionalGenre);
  return additional === '' || additional !== normalize(record.genre);
}

export function matchesGenre(record, value, mode) {
  const expected = normalize(value);
  if (expected === '') return true;
  if (!['exact', 'contains'].includes(mode)) throw new Error('Explicit matching mode required');
  return [record.genre, record.additionalGenre].some(genre => matchesText(genre, expected, mode));
}

function matchesText(value, expected, mode) {
  const actual = normalize(value);
  return mode === 'exact' ? actual === expected : actual.includes(expected);
}

// Validate once, before reading records or applying short-circuit comparisons.
export function validateSearchCriteria(criteria = {}) {
  const values = Object.fromEntries(['artist', 'album', 'albumYear', 'genre']
    .map(field => [field, normalize(criteria[field])]));
  if (values.albumYear && !/^[0-9]{4}$/.test(values.albumYear)) {
    throw new Error('Укажите год альбома в формате YYYY (четыре цифры).');
  }
  return values;
}

export function searchCollection(records, criteria = {}) {
  const values = validateSearchCriteria(criteria);
  return records.filter(record =>
    ['artist', 'album'].every(field => !values[field] || matchesText(record[field], values[field], 'contains')) &&
    (!values.albumYear || normalize(record.albumYear) === values.albumYear) &&
    matchesGenre(record, values.genre, 'contains'));
}
