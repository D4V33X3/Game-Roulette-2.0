const test = require('node:test');
const assert = require('node:assert/strict');
const { STATUSES, gameKey, normalizeGame, mergeLibrary, removeGame, clearRomGames, getMeta, scanFilter, collectionNames } = require('../src/model.cjs');

test('loads the existing library JSON shape and preserves tracking fields', () => {
  const saved = mergeLibrary({
    version: 1,
    metadata: { 'path:c:\\games\\sample.iso': { status: 'Playing', rating: 8, notes: 'resume here', collections: ['PS2'], ra_game_id: 321 } },
    entries: [{ path: 'C:\\Games\\Sample.iso', title: 'Sample', source: 'ROM' }],
  });
  assert.equal(saved.games.length, 1);
  assert.equal(saved.games[0].key, 'path:c:\\games\\sample.iso');
  assert.equal(getMeta(saved.metadata, saved.games[0]).status, 'Playing');
  assert.equal(saved.metadata[saved.games[0].key].ra_game_id, 321);
  assert.equal(collectionNames(saved.games, saved.metadata)[0], 'PS2');
});

test('uses title based identity for non-installed Steam catalog entries', () => {
  const game = normalizeGame({ path: 'Steam library (not installed)', title: 'Test Game', source: 'Steam library (not installed)' });
  assert.equal(game.key, 'title:test game|Steam library (not installed)');
  assert.equal(gameKey(game), game.key);
});

test('removes a game and its library metadata without touching its file path', () => {
  const library = mergeLibrary({
    entries: [
      { path: 'C:\\Games\\Duplicate.iso', title: 'Duplicate' },
      { path: 'C:\\Games\\Keep.iso', title: 'Keep' },
    ],
    metadata: {
      'path:c:\\games\\duplicate.iso': { notes: 'old duplicate' },
      'path:c:\\games\\keep.iso': { status: 'Playing' },
    },
  });
  const removed = removeGame(library, 'path:c:\\games\\duplicate.iso');
  assert.equal(removed.path, 'C:\\Games\\Duplicate.iso');
  assert.deepEqual(library.games.map((game) => game.title), ['Keep']);
  assert.equal(Object.hasOwn(library.metadata, 'path:c:\\games\\duplicate.iso'), false);
  assert.equal(library.metadata['path:c:\\games\\keep.iso'].status, 'Playing');
  assert.equal(removeGame(library, 'path:c:\\games\\missing.iso'), null);
});

test('clears only ROM entries and their metadata while preserving launcher games', () => {
  const library = mergeLibrary({
    entries: [
      { path: 'C:\\Games\\Old.iso', title: 'Old ROM', source: 'ROM' },
      { path: 'C:\\Games\\Other.chd', title: 'Other ROM', source: 'ROM' },
      { path: 'Steam library (not installed)', title: 'Steam Game', source: 'Steam linked account' },
    ],
    metadata: {
      'path:c:\\games\\old.iso': { notes: 'remove this' },
      'path:c:\\games\\other.chd': { status: 'Playing' },
      'title:steam game|steam linked account': { status: 'Completed' },
    },
  });
  assert.equal(clearRomGames(library), 2);
  assert.deepEqual(library.games.map((game) => game.title), ['Steam Game']);
  assert.equal(Object.hasOwn(library.metadata, 'path:c:\\games\\old.iso'), false);
  assert.equal(Object.hasOwn(library.metadata, 'path:c:\\games\\other.chd'), false);
  assert.equal(library.metadata['title:steam game|steam linked account'].status, 'Completed');
  assert.equal(clearRomGames(library), 0);
});

test('normalizes unknown statuses and bounds game ratings', () => {
  const game = normalizeGame({ path: 'C:\\Games\\One.iso' });
  const meta = getMeta({ [game.key]: { status: 'Gone', rating: 99, collections: 'Favorites' } }, game);
  assert.equal(meta.status, 'Backlog');
  assert.equal(meta.rating, 10);
  assert.deepEqual(meta.collections, []);
  assert.deepEqual(STATUSES, ['Backlog', 'Playing', 'Completed', '100% Completed', 'Abandoned']);
});

test('treats cue/bin pairs as one game while retaining standalone BIN files', () => {
  const found = scanFilter([
    'C:\\ROMs\\Disc.cue', 'C:\\ROMs\\Disc.bin', 'C:\\ROMs\\Standalone.bin',
    'C:\\ROMs\\notes.txt', 'C:\\ROMs\\Other.iso',
  ]);
  assert.deepEqual(found, ['C:\\ROMs\\Disc.cue', 'C:\\ROMs\\Standalone.bin', 'C:\\ROMs\\Other.iso']);
});
