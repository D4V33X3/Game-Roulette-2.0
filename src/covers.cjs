const fs = require('node:fs');
const path = require('node:path');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

function basename(value) {
  return String(value || '').replaceAll('\\', '/').split('/').pop() || '';
}

function normalizeCoverTitle(value) {
  return basename(value)
    .replace(/\.[^.]+$/, '')
    .replace(/\s*(?:\(|\[)?\s*(?:disc|disk|cd)[\s._-]*[0-9]+\s*(?:\)|\])?$/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function baseNormalizeCoverTitle(value) {
  const title = basename(value).replace(/\.[^.]+$/, '');
  return normalizeCoverTitle(title.replace(/\s*[([].*$/, ''));
}

function ps2SerialKeys(value) {
  const title = basename(value).replace(/\.[^.]+$/, '').toUpperCase();
  const found = [];
  const pattern = /\b(SLUS|SLES|SCUS|SCES|SLPS|SCAJ|SLPM|SLAJ|SCPS|PAPX|PCPX|TCPS|TCUS)[-_ ]?([0-9]{3})[-_. ]?([0-9]{2,3})\b/g;
  for (const match of title.matchAll(pattern)) found.push(normalizeCoverTitle(`${match[1]}${match[2]}${match[3]}`));
  return [...new Set(found)];
}

function parsePcsx2GamelistCache(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
  const binary = bytes.toString('latin1');
  const database = new Map();
  const pattern = /([^\x00\r\n]+\.(?:iso|bin|chd|cue|elf|cso|gz))\n\x00{3}([A-Z]{4}-\d{5})/gi;
  for (const match of binary.matchAll(pattern)) {
    const romPath = Buffer.from(match[1], 'latin1').toString('utf8');
    const name = basename(romPath);
    const serial = match[2].toUpperCase();
    for (const key of [normalizeCoverTitle(name), normalizeCoverTitle(name.replace(/\.[^.]+$/, ''))]) {
      if (key && !database.has(key)) database.set(key, serial);
    }
  }
  return database;
}

function pcsx2SerialForGame(game, database) {
  const names = [game?.path, basename(game?.path), game?.title];
  for (const name of names) {
    const serial = database?.get(normalizeCoverTitle(name));
    if (serial) return serial;
  }
  return '';
}

function coverLookupKeys(game, serial = '') {
  const pathName = basename(game?.path);
  const title = String(game?.title || '');
  const candidates = [
    ...ps2SerialKeys(pathName),
    ...ps2SerialKeys(title),
    normalizeCoverTitle(serial),
    normalizeCoverTitle(pathName),
    normalizeCoverTitle(title),
    baseNormalizeCoverTitle(pathName),
    baseNormalizeCoverTitle(title),
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function findIndexedCover(game, coverIndex, serial = '') {
  for (const key of coverLookupKeys(game, serial)) {
    const result = coverIndex?.get(key);
    if (result) return result;
  }
  return '';
}

function buildCoverIndex(folders) {
  const files = new Map();
  for (const folder of folders || []) {
    if (typeof folder !== 'string' || !folder.trim()) continue;
    const stack = [folder];
    while (stack.length) {
      const current = stack.pop();
      let entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(file);
        else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const keys = [normalizeCoverTitle(entry.name), ...ps2SerialKeys(entry.name)];
          for (const key of keys) if (key && !files.has(key)) files.set(key, file);
        }
      }
    }
  }
  return files;
}

function matchCoverName(game, names) {
  const byTitle = new Map();
  for (const name of names) {
    const key = normalizeCoverTitle(name);
    if (key && !byTitle.has(key)) byTitle.set(key, name);
  }
  for (const key of coverLookupKeys(game)) {
    if (byTitle.has(key)) return byTitle.get(key);
  }
  const baseKey = baseNormalizeCoverTitle(game?.title || game?.path);
  if (!baseKey) return '';
  const baseMatches = names.filter((name) => baseNormalizeCoverTitle(name) === baseKey);
  return baseMatches.length === 1 ? baseMatches[0] : '';
}

function steamAppIdForGame(game) {
  const match = /^steam:\/\/rungameid\/(\d+)\/?$/i.exec(String(game?.path || '').trim());
  return match ? match[1] : '';
}

function steamLibraryCoverUrls(appId) {
  if (!/^\d+$/.test(String(appId || ''))) return [];
  const id = String(appId);
  return [
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_hero.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
  ];
}

function steamAppDetailsUrl(appId) {
  if (!/^\d+$/.test(String(appId || ''))) return '';
  const url = new URL('https://store.steampowered.com/api/appdetails/');
  url.search = new URLSearchParams({ appids: String(appId), l: 'english', cc: 'gb' }).toString();
  return url.toString();
}

function coverImageExtension(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes || []);
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return '.jpg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return '';
}

module.exports = {
  IMAGE_EXTENSIONS,
  normalizeCoverTitle,
  baseNormalizeCoverTitle,
  ps2SerialKeys,
  parsePcsx2GamelistCache,
  pcsx2SerialForGame,
  coverLookupKeys,
  findIndexedCover,
  buildCoverIndex,
  matchCoverName,
  steamAppIdForGame,
  steamLibraryCoverUrls,
  steamAppDetailsUrl,
  coverImageExtension,
};
