const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeCoverTitle,
  baseNormalizeCoverTitle,
  ps2SerialKeys,
  parsePcsx2GamelistCache,
  pcsx2SerialForGame,
  findIndexedCover,
  buildCoverIndex,
  matchCoverName,
  steamAppIdForGame,
  steamLibraryCoverUrls,
  steamAppDetailsUrl,
  coverImageExtension,
} = require('../src/covers.cjs');

test('reads serial numbers from the original PCSX2 game list cache format', () => {
  const prefix = Buffer.from('G:\\PCSX2\\Games\\Bob the Builder.iso\n', 'utf8');
  const cache = Buffer.concat([prefix, Buffer.from([0, 0, 0]), Buffer.from('SLES-51234', 'ascii')]);
  const database = parsePcsx2GamelistCache(cache);
  assert.equal(database.get(normalizeCoverTitle('Bob the Builder.iso')), 'SLES-51234');
  assert.equal(pcsx2SerialForGame({ path: 'G:\\ROMs\\Bob the Builder.iso', title: 'Bob the Builder' }, database), 'SLES-51234');
});

test('maps serial named PS2 covers before title based art', () => {
  const game = { path: 'D:\\ROMs\\SLUS_123.45.iso', title: 'Example Game (USA)' };
  const serial = 'SLUS-12345';
  const index = new Map([['slus12345', 'C:\\covers\\SLUS-12345.png']]);
  assert.deepEqual(ps2SerialKeys(game.path), ['slus12345']);
  assert.equal(findIndexedCover(game, index, serial), 'C:\\covers\\SLUS-12345.png');
});

test('recovers existing cover files from nested legacy cache folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-roulette-cover-cache-'));
  const coverFolder = path.join(root, 'online_covers', 'xlenore_ps2_3d');
  fs.mkdirSync(coverFolder, { recursive: true });
  const coverPath = path.join(coverFolder, 'SLES-51234.png');
  fs.writeFileSync(coverPath, Buffer.from([137, 80, 78, 71]));
  try {
    const index = buildCoverIndex([path.join(root, 'online_covers')]);
    const game = { path: 'D:\\ROMs\\Bob.iso', title: 'Bob the Builder' };
    assert.equal(findIndexedCover(game, index, 'SLES-51234'), coverPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normalizes region tags and accepts a unique exact base title match', () => {
  const game = { path: 'D:\\ROMs\\Okage Shadow King (USA).iso', title: 'Okage - Shadow King (USA)' };
  assert.equal(baseNormalizeCoverTitle(game.title), 'okageshadowking');
  assert.equal(matchCoverName(game, ['Okage - Shadow King (Europe).png']), 'Okage - Shadow King (Europe).png');
  assert.equal(matchCoverName(game, ['Okage - Shadow King (USA).png', 'Okage - Shadow King (Europe).png']), 'Okage - Shadow King (USA).png');
  assert.equal(matchCoverName(game, ['Okage - Shadow King (Europe).png', 'Okage - Shadow King (Japan).png']), '');
});

test('cover title normalization ignores extensions and disc suffixes', () => {
  assert.equal(normalizeCoverTitle('Game Name (USA) (Disc 2).iso'), 'gamenameusa');
});

test('reads Steam app IDs from linked owned-game paths, including non-installed games', () => {
  assert.equal(steamAppIdForGame({ path: 'steam://rungameid/1091500', source: 'Steam linked account' }), '1091500');
  assert.equal(steamAppIdForGame({ path: 'steam://rungameid/730/', source: 'Steam' }), '730');
  assert.equal(steamAppIdForGame({ path: 'C:\\Games\\Example.exe', source: 'Steam' }), '');
  assert.equal(steamAppIdForGame({ path: 'steam://rungameid/not-an-id' }), '');
});

test('builds Steam library-cover URLs only for numeric app IDs', () => {
  assert.deepEqual(steamLibraryCoverUrls('1091500').slice(0, 2), [
    'https://cdn.akamai.steamstatic.com/steam/apps/1091500/library_600x900.jpg',
    'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1091500/library_600x900.jpg',
  ]);
  assert.deepEqual(steamLibraryCoverUrls('../invalid'), []);
  assert.match(steamAppDetailsUrl('1091500'), /^https:\/\/store\.steampowered\.com\/api\/appdetails\/\?appids=1091500/);
  assert.equal(steamAppDetailsUrl('bad'), '');
});

test('recognizes verified JPEG, PNG, and WebP cover images', () => {
  assert.equal(coverImageExtension(Buffer.from([255, 216, 255, 0])), '.jpg');
  assert.equal(coverImageExtension(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), '.png');
  assert.equal(coverImageExtension(Buffer.from('RIFF0000WEBP')), '.webp');
  assert.equal(coverImageExtension(Buffer.from('<html>not a cover</html>')), '');
});
