import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, sameAlbum, isPotentialDuplicate, checkAddition, genresAreDistinct, matchesGenre, searchCollection, validateSearchCriteria } from '../src/collection-rules.mjs';

const release = Object.freeze({ artist: 'Example Band', album: 'First Album', label: 'Label A', recordYear: 2000, editionType: 'Оригинал', genre: 'Rock', additionalGenre: 'Jazz' });

test('comparison ignores only case and whitespace, preserving punctuation and words', () => {
  assert.equal(normalize('  EXAMPLE   Band '), 'example band');
  assert.notEqual(normalize('AC/DC'), normalize('AC DC'));
  assert.notEqual(normalize("Artist’s"), normalize("Artist's"));
  assert.notEqual(normalize('Ёлка'), normalize('Елка'));
  assert.equal(sameAlbum(release, {...release, artist: ' example BAND  '}), true);
});

test('missing edition evidence blocks a possible duplicate', () => {
  assert.equal(isPotentialDuplicate(release, {artist: 'Example Band', album: 'First Album'}), true);
  assert.equal(isPotentialDuplicate(release, {...release, label: '', recordYear: null}), true);
  assert.equal(isPotentialDuplicate(release, {...release, album: 'Other Album'}), false);
});

test('any differing edition attribute populated on both sides proves a different edition', () => {
  for (const [field,value] of [['label','Label B'], ['recordYear',2001], ['editionType','Переиздание']]) {
    assert.equal(isPotentialDuplicate(release, {...release, [field]:value}), false);
  }
  assert.equal(isPotentialDuplicate(release, {...release, recordYear:'2000', label:' label A '}), true);
});

test('wish-list distinguishes an owned album warning from an owned edition block', () => {
  const other = {...release, recordYear:2001};
  const result = checkAddition(other, 'wishlist', [release]);
  assert.equal(result.blocked, false);
  assert.deepEqual(result.ownedAlbums, [release]);
  assert.deepEqual(result.ownedDuplicates, []);
  assert.equal(checkAddition(release, 'wishlist', [release]).blocked, true);
  assert.equal(checkAddition(other, 'wishlist', [], [other]).blocked, true);
});

test('collection checks its own duplicates, not desired purchases', () => {
  assert.equal(checkAddition(release, 'collection', [], [release]).blocked, false);
  assert.equal(checkAddition(release, 'collection', [release]).blocked, true);
  assert.throws(() => checkAddition(release, 'unknown', []));
});

test('genre search checks both genres with the explicit mode', () => {
  assert.equal(matchesGenre(release, ' jazz ', 'exact'), true);
  assert.equal(matchesGenre(release, 'az', 'contains'), true);
  assert.equal(matchesGenre(release, 'az', 'exact'), false);
  assert.equal(matchesGenre(release, 'Classical', 'contains'), false);
  assert.throws(() => matchesGenre(release, 'Rock'));
});

test('additional genre is optional and must differ after normalization', () => {
  assert.equal(genresAreDistinct({...release, additionalGenre:null}), true);
  assert.equal(genresAreDistinct({...release, additionalGenre:' ROCK '}), false);
  assert.equal(genresAreDistinct(release), true);
});

test('comparison does not modify records or lose duplicate rows', () => {
  const records = Object.freeze([release, release]);
  const before = JSON.stringify(records);
  assert.equal(checkAddition(release, 'collection', records).duplicates.length, 2);
  matchesGenre(release, 'Jazz', 'exact');
  assert.equal(JSON.stringify(records), before);
});

test('normalize handles missing values, case and surrounding or repeated spaces', () => {
  for (const value of [null, undefined, '', '   ']) {
    assert.equal(normalize(value), '');
  }
  assert.equal(normalize('RoCK'), 'rock');
  assert.equal(normalize('  rock  '), 'rock');
  assert.equal(normalize('Art   Rock'), 'art rock');
});

test('empty genre criteria disable the filter regardless of genres or mode', () => {
  const records = [release, {genre: 'Rock'}, {additionalGenre: 'Jazz'},
    {}, {genre: null, additionalGenre: undefined}, {genre: '', additionalGenre: '   '}];
  for (const value of ['', '   ', null, undefined]) {
    for (const record of records) {
      assert.equal(matchesGenre(record, value), true);
      for (const mode of ['exact', 'contains', 'unknown', null]) {
        assert.equal(matchesGenre(record, value, mode), true);
      }
    }
  }
});

test('primary genre supports exact and contains searches', () => {
  assert.equal(matchesGenre(release, ' ROCK ', 'exact'), true);
  assert.equal(matchesGenre(release, 'OC', 'contains'), true);
  assert.equal(matchesGenre(release, 'oc', 'exact'), false);
});

test('additional genre is searchable without a primary genre', () => {
  const record = {additionalGenre: 'Jazz'};
  assert.equal(matchesGenre(record, ' JAZZ ', 'exact'), true);
  assert.equal(matchesGenre(record, 'AZ', 'contains'), true);
});

test('nonempty criteria do not match absent genres', () => {
  for (const record of [{}, {genre: null, additionalGenre: undefined},
    {genre: '', additionalGenre: '   '}]) {
    for (const mode of ['exact', 'contains']) {
      assert.equal(matchesGenre(record, 'Rock', mode), false);
    }
  }
});

test('nonempty genre criteria require a valid explicit mode', () => {
  for (const mode of [undefined, null, '', 'unknown']) {
    assert.throws(() => matchesGenre(release, 'Rock', mode), /Explicit matching mode required/);
  }
});

test('additional genre accepts missing values but rejects normalized equality', () => {
  for (const additionalGenre of [undefined, '', '   ']) {
    assert.equal(genresAreDistinct({...release, additionalGenre}), true);
  }
  assert.equal(genresAreDistinct({genre: ' Art   ROCK ', additionalGenre: 'art rock'}), false);
});

test('missing edition attributes cannot prove a different edition on either side', () => {
  for (const value of [undefined, null, '', '   ']) {
    const incomplete = {...release, label: value, recordYear: value, editionType: value};
    assert.equal(isPotentialDuplicate(release, incomplete), true);
    assert.equal(isPotentialDuplicate(incomplete, release), true);
    assert.equal(isPotentialDuplicate(incomplete, incomplete), true);
  }
});

test('different artists are not potential duplicates even with missing edition attributes', () => {
  const other = {artist: 'Other Band', album: release.album};
  assert.equal(sameAlbum(release, other), false);
  assert.equal(isPotentialDuplicate(release, other), false);
  assert.equal(isPotentialDuplicate(other, release), false);
});

const searchRecords = Object.freeze([
  Object.freeze({...release, albumYear: 2000}),
  Object.freeze({...release, albumYear: '2000', recordYear: 2024}),
  Object.freeze({...release, artist: 'Other Band', album: 'Second Album', albumYear: '2020', genre: null, additionalGenre: undefined})
]);

test('search combines all four criteria with AND and searches additional genre', () => {
  const criteria = {artist: 'example', album: 'first', albumYear: '2000', genre: 'az'};
  assert.deepEqual(searchCollection(searchRecords, criteria), searchRecords.slice(0, 2));
  for (const [field, value] of [['artist', 'Other'], ['album', 'Second'], ['albumYear', '2020'], ['genre', 'Classical']]) {
    assert.deepEqual(searchCollection(searchRecords, {...criteria, [field]: value}), []);
  }
});

test('each search criterion works independently', () => {
  for (const criteria of [{artist: ' example BAND '}, {album: ' FIRST  Album '}, {genre: ' rock '}, {genre: 'jazz'}]) {
    assert.deepEqual(searchCollection(searchRecords, criteria), searchRecords.slice(0, 2));
  }
  assert.deepEqual(searchCollection(searchRecords, {albumYear: '2000'}), searchRecords.slice(0, 2));
});

test('automatic search includes exact and partial matches without ranking', () => {
  for (const field of ['artist', 'album', 'genre']) {
    const records = [{[field]: 'Art Rock'}, {[field]: 'Rock'}, {[field]: 'Rock Music'}];
    assert.deepEqual(searchCollection(records, {[field]: ' ROCK '}), records);
  }
  const records = [{genre: 'Jazz', additionalGenre: 'Art Rock'}, {genre: 'Rock'}];
  assert.deepEqual(searchCollection(records, {genre: 'Rock'}), records);
});

test('empty criteria return every row without requiring a mode', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.deepEqual(searchCollection(searchRecords, {artist: value, album: value, albumYear: value, genre: value}), searchRecords);
  }
  assert.deepEqual(searchCollection(searchRecords), searchRecords);
  assert.deepEqual(searchCollection([], {}), []);
});

test('year is exact and rejects invalid criteria even for empty records', () => {
  assert.deepEqual(searchCollection(searchRecords, {albumYear: ' 2000 '}), searchRecords.slice(0, 2));
  for (const albumYear of ['20', '200', '20000', '2000-2020', '20xx', '2e03', '2000.0']) {
    assert.throws(() => searchCollection([], {albumYear}), /YYYY/);
  }
});

test('text search needs no mode and validates an empty collection', () => {
  for (const field of ['artist', 'album', 'genre']) {
    assert.deepEqual(searchCollection([], {[field]: 'Rock'}), []);
  }
  assert.deepEqual(validateSearchCriteria({artist: '  BAND '}), {artist: 'band', album: '', genre: '', albumYear: ''});
});

test('search skips empty criteria but does not match missing fields to nonempty text', () => {
  assert.deepEqual(searchCollection(searchRecords, {artist: 'Other Band', genre: '   '}), [searchRecords[2]]);
  assert.deepEqual(searchCollection([{}], {artist: 'Band'}), []);
  assert.deepEqual(searchCollection([{}], {album: 'Album'}), []);
  assert.deepEqual(searchCollection([{}], {genre: 'Jazz'}), []);
});

test('search preserves order, editions and inputs', () => {
  const criteria = Object.freeze({genre: ' ROCK '});
  const before = JSON.stringify(searchRecords);
  assert.deepEqual(searchCollection(searchRecords, criteria), searchRecords.slice(0, 2));
  assert.equal(JSON.stringify(searchRecords), before);
  assert.equal(criteria.genre, ' ROCK ');
});
