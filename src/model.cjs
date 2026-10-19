const path = require('node:path');
const STATUSES = ['Backlog', 'Playing', 'Completed', '100% Completed', 'Abandoned'];
const ROM_EXTENSIONS = new Set(['.iso','.bin','.cue','.chd','.cso','.pbp','.gcm','.gcz','.rvz','.wad','.wbfs','.wud','.nsp','.xci','.3ds','.cia','.nds','.gba','.gbc','.gb','.z64','.n64','.v64','.nes','.sfc','.smc','.md','.gen','.sms','.gg','.a26','.a78','.zip','.7z','.rar','.elf','.dol','.pkg']);

function gameKey(game) {
  const sourcePath = String(game.path || '');
  if (sourcePath.startsWith('Steam library (not installed)')) return `title:${String(game.title || '').toLowerCase()}|${game.source || ''}`;
  return `path:${sourcePath.toLowerCase()}`;
}

function cleanMeta(value = {}) {
  const status = STATUSES.includes(value.status) ? value.status : 'Backlog';
  return {
    ...value,
    status,
    rating: Math.max(0, Math.min(10, Number.parseInt(value.rating, 10) || 0)),
    notes: String(value.notes || ''),
    completed_date: String(value.completed_date || ''),
    collections: Array.isArray(value.collections) ? [...new Set(value.collections.map(String).map((x) => x.trim()).filter(Boolean))] : [],
    emulator_id: /^[a-z0-9][a-z0-9-]{0,47}$/i.test(String(value.emulator_id || '')) ? String(value.emulator_id).toLowerCase() : '',
    emulator_assignment: ['manual', 'folder'].includes(value.emulator_assignment) ? value.emulator_assignment : '',
  };
}

function normalizeGame(item) {
  const path = String(item.path || '').trim();
  if (!path) return null;
  let title = String(item.title || '').trim();
  if (!title) {
    const leaf = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
    title = leaf.replace(/\.[^.]+$/, '').replace(/[._]/g, ' ').replace(/[\s._-]*(disc|disk|cd)[\s._-]*\d+$/i, '').trim() || leaf;
  }
  return { path, title, source: String(item.source || 'ROM'), key: gameKey({ path, title, source: item.source || 'ROM' }) };
}

function mergeLibrary(raw = {}) {
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : (raw.games && typeof raw.games === 'object' ? raw.games : {});
  const entries = Array.isArray(raw.entries) ? raw.entries : (Array.isArray(raw.games) ? raw.games : []);
  const byKey = new Map();
  for (const entry of entries) {
    const game = normalizeGame(entry);
    if (game) byKey.set(game.key, game);
  }
  const cleanMetadata = {};
  for (const [key, value] of Object.entries(metadata)) cleanMetadata[key] = cleanMeta(value);
  return { games: [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title)), metadata: cleanMetadata };
}

function removeGame(library, key) {
  if (!library || !Array.isArray(library.games)) return null;
  const index = library.games.findIndex((game) => game.key === key);
  if (index < 0) return null;
  const [removed] = library.games.splice(index, 1);
  if (library.metadata && typeof library.metadata === 'object') delete library.metadata[key];
  return removed;
}

function clearRomGames(library) {
  if (!library || !Array.isArray(library.games)) return 0;
  const removed = library.games.filter((game) => game.source === 'ROM');
  if (!removed.length) return 0;
  const removedKeys = new Set(removed.map((game) => game.key));
  library.games = library.games.filter((game) => !removedKeys.has(game.key));
  if (library.metadata && typeof library.metadata === 'object') {
    for (const key of removedKeys) delete library.metadata[key];
  }
  return removed.length;
}

function getMeta(metadata, game) {
  return cleanMeta(metadata[game.key] || {});
}

function collectionNames(games, metadata) {
  return [...new Set(games.flatMap((game) => getMeta(metadata, game).collections))].sort((a, b) => a.localeCompare(b));
}

function scanFilter(paths) {
  const normalized = [];
  for (const filePath of paths) {
    const ext = path.extname(filePath).toLowerCase();
    if (ROM_EXTENSIONS.has(ext)) normalized.push(filePath);
  }
  const pairKey = (filePath) => `${path.dirname(filePath).toLowerCase()}|${path.basename(filePath, path.extname(filePath)).toLowerCase()}`;
  const cue = new Set(normalized.filter((p) => path.extname(p).toLowerCase() === '.cue').map(pairKey));
  return normalized.filter((p) => {
    if (!p.toLowerCase().endsWith('.bin')) return true;
    return !cue.has(pairKey(p));
  });
}

module.exports = { STATUSES, ROM_EXTENSIONS, gameKey, cleanMeta, normalizeGame, mergeLibrary, removeGame, clearRomGames, getMeta, collectionNames, scanFilter };
