import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, sameAlbum, isPotentialDuplicate, checkAddition, genresAreDistinct, matchesGenre } from '../src/collection-rules.mjs';

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
