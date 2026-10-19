const path = require('node:path');

const EMULATOR_PRESETS = [
  { id: 'duckstation', name: 'DuckStation', platform: 'PlayStation', args: '-- {rom}' },
  { id: 'pcsx2', name: 'PCSX2', platform: 'PlayStation 2', args: '-- {rom}' },
  { id: 'dolphin', name: 'Dolphin', platform: 'GameCube / Wii', args: '--exec {rom}' },
];

function cleanEmulatorProfile(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '').trim().toLowerCase();
  const name = String(item.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 48);
  const executablePath = String(item.executable_path || item.executablePath || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id) || !name || !executablePath) return null;
  const preset = EMULATOR_PRESETS.find((candidate) => candidate.id === id);
  const args = String(item.args ?? preset?.args ?? '{rom}').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 240);
  return {
    id,
    name,
    platform: String(item.platform || preset?.platform || 'Custom').slice(0, 64),
    executable_path: path.normalize(executablePath),
    args: args || '{rom}',
    custom: !preset,
  };
}

function tokenizeArguments(template) {
  const source = String(template);
  const tokens = [];
  let token = '';
  let quote = '';
  let started = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
      else if (character === '\\' && quote === '"' && source[index + 1] === '"') { token += '"'; index += 1; }
      else token += character;
      started = true;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) tokens.push(token);
      token = '';
      started = false;
    } else {
      token += character;
      started = true;
    }
  }
  if (quote) throw new Error('Check the quotation marks in the emulator launch options.');
  if (started) tokens.push(token);
  return tokens;
}

function buildLaunchArguments(template, gamePath) {
  const pathValue = String(gamePath || '');
  if (!pathValue) throw new Error('The game file path is missing.');
  const tokens = tokenizeArguments(template || '{rom}');
  const hasRom = tokens.some((token) => token.includes('{rom}'));
  const args = tokens.map((token) => token.replaceAll('{rom}', pathValue));
  if (!hasRom) args.push(pathValue);
  return args;
}

function isPathInside(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function emulatorForRom(filePath, folders, folderMap) {
  const roots = (Array.isArray(folders) ? folders : [])
    .filter((root) => typeof root === 'string' && root.trim())
    .sort((left, right) => right.length - left.length);
  const root = roots.find((candidate) => isPathInside(candidate, filePath));
  if (!root || !folderMap || typeof folderMap !== 'object') return '';
  return String(folderMap[root] || '');
}

module.exports = { EMULATOR_PRESETS, cleanEmulatorProfile, tokenizeArguments, buildLaunchArguments, isPathInside, emulatorForRom };
