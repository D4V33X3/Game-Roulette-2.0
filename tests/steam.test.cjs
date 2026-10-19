const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSteamAchievements, steamAchievementIcon } = require('../src/steam.cjs');

test('combines Steam achievement names and icons with the player unlock state', () => {
  const result = mergeSteamAchievements('440', 'Team Fortress 2', {
    playerstats: {
      success: true,
      gameName: 'Team Fortress 2',
      achievements: [
        { apiname: 'TF_PLAY_GAME', achieved: 1, unlocktime: 1700000000 },
        { apiname: 'TF_HIDDEN', achieved: 0, unlocktime: 0 },
      ],
    },
  }, {
    game: {
      gameName: 'Team Fortress 2',
      availableGameStats: { achievements: [
        { name: 'TF_PLAY_GAME', displayName: 'First steps', description: 'Play a round.', icon: 'http://media.steampowered.com/steamcommunity/public/images/apps/440/unlocked.jpg', icongray: 'locked.jpg' },
        { name: 'TF_HIDDEN', displayName: 'Secret', description: 'Hidden detail.', hidden: 1, icon: 'secret.jpg', icongray: 'secret-gray.jpg' },
      ] },
    },
  });
  assert.equal(result.title, 'Team Fortress 2');
  assert.equal(result.earned, 1);
  assert.equal(result.total, 2);
  assert.equal(result.percent, 50);
  assert.equal(result.achievements[0].title, 'First steps');
  assert.equal(result.achievements[0].unlocked, true);
  assert.equal(result.achievements[0].icon, 'https://media.steampowered.com/steamcommunity/public/images/apps/440/unlocked.jpg');
  assert.equal(result.achievements[0].unlockTime, '2023-11-14T22:13:20.000Z');
  assert.equal(result.achievements[1].title, 'Hidden achievement');
  assert.equal(result.achievements[1].description, 'Unlock this achievement to reveal its details.');
});

test('rejects a Steam icon URL from an unrelated host', () => {
  assert.equal(steamAchievementIcon('https://example.com/badge.png', '440'), '');
});

test('surfaces Steam achievement endpoint failures', () => {
  assert.throws(() => mergeSteamAchievements('440', 'Game', { playerstats: { success: false, error: 'Profile is private.' } }, {}), /Profile is private/);
});
