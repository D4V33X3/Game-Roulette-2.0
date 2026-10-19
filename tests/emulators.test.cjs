const test = require('node:test');
const assert = require('node:assert/strict');
const { EMULATOR_PRESETS, cleanEmulatorProfile, tokenizeArguments, buildLaunchArguments, isPathInside, emulatorForRom } = require('../src/emulators.cjs');

test('emulator presets keep their documented game-file argument styles', () => {
  assert.equal(EMULATOR_PRESETS.find((item) => item.id === 'duckstation').args, '-- {rom}');
  assert.equal(EMULATOR_PRESETS.find((item) => item.id === 'pcsx2').args, '-- {rom}');
  assert.equal(EMULATOR_PRESETS.find((item) => item.id === 'dolphin').args, '--exec {rom}');
  const profile = cleanEmulatorProfile({ id: 'pcsx2', name: 'PCSX2', executable_path: 'C:\\Emulators\\pcsx2-qt.exe' });
  assert.equal(profile.args, '-- {rom}');
  assert.equal(profile.custom, false);
});

test('launch arguments keep a ROM path with spaces as one argument', () => {
  assert.deepEqual(buildLaunchArguments('-- "{rom}"', 'C:\\ROMs\\My Game.iso'), ['--', 'C:\\ROMs\\My Game.iso']);
});

test('custom argument parser handles quotes and adds the game path when omitted', () => {
  assert.deepEqual(tokenizeArguments('-L "cores\\Nintendo - SNES.so"'), ['-L', 'cores\\Nintendo - SNES.so']);
  assert.deepEqual(buildLaunchArguments('-L "cores\\Nintendo - SNES.so"', 'D:\\ROMs\\Game.sfc'), ['-L', 'cores\\Nintendo - SNES.so', 'D:\\ROMs\\Game.sfc']);
  assert.throws(() => tokenizeArguments('-- "{rom}'), /quotation marks/);
});

test('ROM folder mapping uses the deepest matching root and respects folder boundaries', () => {
  const roots = ['C:\\ROMs', 'C:\\ROMs\\PS2'];
  const mapping = { 'C:\\ROMs': 'duckstation', 'C:\\ROMs\\PS2': 'pcsx2' };
  assert.equal(emulatorForRom('C:\\ROMs\\PS2\\Game.iso', roots, mapping), 'pcsx2');
  assert.equal(emulatorForRom('C:\\ROMs\\PS1\\Game.cue', roots, mapping), 'duckstation');
  assert.equal(emulatorForRom('C:\\ROMsBackup\\Game.iso', roots, mapping), '');
  assert.equal(isPathInside('C:\\ROMs', 'C:\\ROMs\\Game.iso'), true);
  assert.equal(isPathInside('C:\\ROMs', 'C:\\ROMsBackup\\Game.iso'), false);
});

test('invalid emulator profiles are ignored and custom profiles are bounded', () => {
  assert.equal(cleanEmulatorProfile({ id: 'bad id', name: 'Bad', executable_path: 'bad.exe' }), null);
  const profile = cleanEmulatorProfile({ id: 'custom-retroarch-123abc', name: '  RetroArch  ', executable_path: 'C:\\Apps\\retroarch.exe', args: '-L "my core.dll"' });
  assert.equal(profile.name, 'RetroArch');
  assert.equal(profile.custom, true);
  assert.equal(profile.platform, 'Custom');
});
