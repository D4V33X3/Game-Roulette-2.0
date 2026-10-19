const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { mergeLibrary, normalizeGame, cleanMeta, getMeta, collectionNames, removeGame, clearRomGames, STATUSES } = require('./model.cjs');
const { EMULATOR_PRESETS, cleanEmulatorProfile, buildLaunchArguments, emulatorForRom } = require('./emulators.cjs');
const { normalizeCoverTitle, ps2SerialKeys, parsePcsx2GamelistCache, pcsx2SerialForGame, findIndexedCover, buildCoverIndex, matchCoverName, steamAppIdForGame, steamLibraryCoverUrls, steamAppDetailsUrl, coverImageExtension } = require('./covers.cjs');
const { mergeSteamAchievements } = require('./steam.cjs');

const DEV_SESSION_DATA = !app.isPackaged && !process.env.GAME_ROULETTE_DATA_DIR;
const DATA_DIR = process.env.GAME_ROULETTE_DATA_DIR || (DEV_SESSION_DATA
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'game-roulette-dev-'))
  : path.join(os.homedir(), '.rom_roulette'));
fs.mkdirSync(DATA_DIR, { recursive: true });
app.setPath('userData', path.join(DATA_DIR, 'electron-user-data'));
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const LIBRARY_PATH = path.join(DATA_DIR, 'library.json');
const RA_STATE_PATH = path.join(DATA_DIR, 'retro_achievements_state.json');
const COVER_DIR = path.join(DATA_DIR, 'covers');
const LEGACY_COVER_DIR = DEV_SESSION_DATA ? '' : path.join(os.homedir(), '.rom_roulette', 'online_covers');
const PS2_COVER_URL = 'https://raw.githubusercontent.com/xlenore/ps2-covers/main/covers/3d/{serial}.png';
const RA_BASE = 'https://retroachievements.org/API/';
const ROM_EXTENSIONS = new Set(['.iso','.bin','.cue','.chd','.cso','.pbp','.gcm','.gcz','.rvz','.wad','.wbfs','.wud','.nsp','.xci','.3ds','.cia','.nds','.gba','.gbc','.gb','.z64','.n64','.v64','.nes','.sfc','.smc','.md','.gen','.sms','.gg','.a26','.a78','.zip','.7z','.rar','.elf','.dol','.pkg']);
const THEMES = [
  ['Neon Arcade','#fa3fc8','neon-arcade.png'],
  ['Cyberpunk Drift','#a35dff','cyberpunk-drift.png'],
  ['Mythic Boss Raid','#ff713e','mythic-boss-raid.png'],
  ['Tactical Night Ops','#a2db55','tactical-night-ops.png'],
  ['Cosmic Loot Run','#bd77ff','cosmic-loot-run.png'],
  ['Survival Horror','#f34c5e','survival-horror.png'],
].map(([name, accent, background]) => ({ name, accent, background, reactive: true }));

const THEME_FILE_FORMAT = 'game-roulette-theme';
const MAX_CUSTOM_THEMES = 24;

function cleanCustomTheme(item) {
  if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.startsWith('Custom: ')) return null;
  const name = item.name.slice(8).trim().slice(0, 32);
  if (!name) return null;
  return {
    name: `Custom: ${name}`, custom: true,
    accent: /^#[0-9a-f]{6}$/i.test(item.accent) ? item.accent : '#a855f7',
    background: typeof item.background === 'string' && /^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(item.background) ? item.background : 'midnight.png',
    wallpaper_path: typeof item.wallpaper_path === 'string' ? item.wallpaper_path : '',
    glow_strength: clamp(item.glow_strength, 0, 10, 3),
    panel_opacity: clamp(item.panel_opacity, 55, 100, 98),
    wallpaper_dim: clamp(item.wallpaper_dim, 0, 80, 35),
    reactive_theme: item.reactive_theme !== false,
  };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

let mainWindow;
let settings = {};
let library = { games: [], metadata: {} };
let ra = { profile: null, recent: [], recentPlayed: [], completion: [], connected: false, error: '' };
let raApiKey = '';
let steamApiKey = '';
let raSeen = new Set();
let raInitialized = false;
let overlayEvent = null;
let overlayServer;
let overlayUrl = '';
let scanBusy = false;
let refreshTimer;
let coverIndex;
let pcsx2Serials = new Map();
let steamCoverSyncPromise = null;

function defaultSettings() {
  return {
    profile_display_name: 'Player', profile_avatar_path: '', theme_name: 'Neon Arcade',
    glow_color: '#a855f7', glow_strength: 3, theme_panel_opacity: 98, wallpaper_dim_percent: 35, reactive_theme: true,
    custom_wallpaper_path: '', custom_themes: [], rom_folders: [], rom_folder_emulators: {}, emulators: [], cover_folders: [], pcsx2_cache_path: '', ra_notifications_enabled: true,
    ra_poll_minutes: 2, sound_enabled: true,
    ra_overlay_config: { enabled: true, height: 112, opacity: 92, show_icon: true, show_game: true, show_points: true },
    dashboard_visual_revision: 'glass-edition-reference-1',
  };
}

function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function unprotectSecret(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value.startsWith('plain:')) return value.slice(6);
  if (!value.startsWith('dpapi:') || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(value.slice(6), 'base64')); } catch { return ''; }
}

function protectSecret(value) {
  if (!value) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable; the key was not saved.');
  return `dpapi:${safeStorage.encryptString(value).toString('base64')}`;
}

async function connectSteamThroughOpenId() {
  const state = crypto.randomBytes(24).toString('hex');
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const server = http.createServer(async (request, response) => {
      const callback = new URL(request.url, 'http://127.0.0.1');
      if (callback.pathname !== '/steam/callback') { response.writeHead(404); response.end('Not found'); return; }
      const finish = (error, steamId) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); server.close();
        if (error) reject(error); else resolve(steamId);
      };
      const fail = (message) => {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Game Roulette</title><p>Steam account linking failed. Return to Game Roulette and try again.</p>');
        finish(new Error(message));
      };
      if (callback.searchParams.get('state') !== state || callback.searchParams.get('openid.mode') !== 'id_res') return fail('Steam sign-in was not completed or did not match this request.');
      if (callback.searchParams.get('openid.ns') !== 'http://specs.openid.net/auth/2.0') return fail('Steam returned an unsupported sign-in response.');
      const claimedId = callback.searchParams.get('openid.claimed_id') || '';
      const identity = callback.searchParams.get('openid.identity') || '';
      const match = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/i.exec(claimedId);
      if (!match || identity !== claimedId) return fail('Steam did not return a valid Steam account ID.');
      const expectedReturn = new URL(`http://127.0.0.1:${server.address().port}/steam/callback`);
      expectedReturn.searchParams.set('state', state);
      if (callback.searchParams.get('openid.return_to') !== expectedReturn.href) return fail('Steam returned to an unexpected sign-in address.');
      const endpoint = new URL(callback.searchParams.get('openid.op_endpoint') || '');
      if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'steamcommunity.com' || !endpoint.pathname.startsWith('/openid/')) return fail('Steam returned an untrusted sign-in endpoint.');
      const verification = new URLSearchParams();
      for (const [key, value] of callback.searchParams) if (key.startsWith('openid.')) verification.append(key, value);
      verification.set('openid.mode', 'check_authentication');
      try {
        const checked = await fetch('https://steamcommunity.com/openid/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' }, body: verification, signal: AbortSignal.timeout(15000) });
        const body = await checked.text();
        if (!checked.ok || !/\bis_valid:true\b/i.test(body)) return fail('Steam could not verify the sign-in response.');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Game Roulette</title><p>Steam connected. You can return to Game Roulette now.</p>');
        finish(null, match[1]);
      } catch { fail('Could not verify your Steam sign-in. Check your internet connection and try again.'); }
    });
    timeout = setTimeout(() => {
      if (!settled) { settled = true; server.close(); reject(new Error('Steam sign-in timed out. Please try again.')); }
    }, 120000);
    server.once('error', (error) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(error); }
    });
    server.listen(0, '127.0.0.1', async () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const returnTo = new URL(`${origin}/steam/callback`);
      returnTo.searchParams.set('state', state);
      const login = new URL('https://steamcommunity.com/openid/login');
      const parameters = {
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': returnTo.href,
        'openid.realm': `${origin}/`,
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
      };
      for (const [key, value] of Object.entries(parameters)) login.searchParams.set(key, value);
      try { await shell.openExternal(login.href); }
      catch { if (!settled) { settled = true; clearTimeout(timeout); server.close(); reject(new Error('Could not open Steam sign-in in your browser.')); } }
    });
  });
}

async function getSteamOwnedGames() {
  const steamId = String(settings.steam_id || '');
  if (!/^\d{17}$/.test(steamId)) throw new Error('Connect your Steam account first.');
  if (!steamApiKey) throw new Error('Add your Steam Web API key to import the account library.');
  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/');
  url.search = new URLSearchParams({ key: steamApiKey, steamid: steamId, include_appinfo: '1', include_played_free_games: '1' }).toString();
  const response = await fetch(url, { headers: { 'User-Agent': 'GameRoulette/2.0' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Steam returned HTTP ${response.status}.`);
  const payload = await response.json();
  const games = payload?.response?.games;
  if (!Array.isArray(games)) throw new Error('Steam could not return this library. Set your Steam game details to Public, then try again.');
  if (!games.length && Number(payload?.response?.game_count || 0) === 0) throw new Error('Steam returned an empty library. Check that this account owns games and its game details are Public.');
  return games.filter((game) => game.name && Number(game.appid) > 0).map((game) => ({ path: `steam://rungameid/${game.appid}`, title: game.name, source: 'Steam linked account' }));
}

async function getSteamAchievementsForGame(gameKey) {
  const game = library.games.find((item) => item.key === String(gameKey || ''));
  if (!game) throw new Error('That game is no longer in your library.');
  const appId = steamAppIdForGame(game);
  if (!appId) throw new Error('Steam achievements are available for games linked to a Steam app ID.');
  if (!/^[0-9]{17}$/.test(String(settings.steam_id || '')) || !steamApiKey) throw new Error('Connect Steam and save your Steam Web API key to view achievements.');
  const parameters = { key: steamApiKey, steamid: settings.steam_id, appid: appId, l: 'english' };
  const playerUrl = new URL('https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/');
  playerUrl.search = new URLSearchParams(parameters).toString();
  const schemaUrl = new URL('https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/');
  schemaUrl.search = new URLSearchParams({ key: steamApiKey, appid: appId, l: 'english' }).toString();
  const [playerResponse, schemaResponse] = await Promise.all([
    fetch(playerUrl, { headers: { 'User-Agent': 'GameRoulette/2.0' }, signal: AbortSignal.timeout(20000) }),
    fetch(schemaUrl, { headers: { 'User-Agent': 'GameRoulette/2.0' }, signal: AbortSignal.timeout(20000) }).catch(() => null),
  ]);
  if (!playerResponse.ok) throw new Error(`Steam could not load achievements for this game (HTTP ${playerResponse.status}). Check that your game details are public.`);
  const playerPayload = await playerResponse.json();
  const schemaPayload = schemaResponse?.ok ? await schemaResponse.json() : {};
  return mergeSteamAchievements(appId, game.title, playerPayload, schemaPayload);
}

function findGogGalaxyClient() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'GOG Galaxy', 'GalaxyClient.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GOG Galaxy', 'GalaxyClient.exe'),
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'GOG Galaxy', 'GalaxyClient.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function pcsx2CachePaths() {
  const home = os.homedir();
  const candidates = [
    settings.pcsx2_cache_path,
    'G:\\PCSX2\\cache\\gamelist.cache',
    path.join(home, 'Documents', 'PCSX2', 'cache', 'gamelist.cache'),
    path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'PCSX2', 'cache', 'gamelist.cache'),
    path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'PCSX2', 'cache', 'gamelist.cache'),
    path.join(path.dirname(process.execPath), 'gamelist.cache'),
    path.join(app.getAppPath(), 'gamelist.cache'),
  ].filter((item) => typeof item === 'string' && item.trim());
  const unique = new Map();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (!unique.has(key)) unique.set(key, resolved);
  }
  return [...unique.values()];
}

function reloadPcsx2Serials() {
  const database = new Map();
  for (const cachePath of pcsx2CachePaths()) {
    try {
      for (const [key, serial] of parsePcsx2GamelistCache(fs.readFileSync(cachePath))) if (!database.has(key)) database.set(key, serial);
    } catch {}
  }
  pcsx2Serials = database;
}

function invalidateCoverIndex() {
  coverIndex = undefined;
}

function getCoverIndex() {
  const folders = [...new Set([...(settings.cover_folders || []), LEGACY_COVER_DIR, COVER_DIR].filter((folder) => typeof folder === 'string' && folder.trim()))];
  const signature = folders.map((folder) => path.resolve(folder).toLowerCase()).join('|');
  if (coverIndex?.signature === signature) return coverIndex.files;
  const files = buildCoverIndex(folders);
  coverIndex = { signature, files };
  return files;
}

function loadData() {
  settings = { ...defaultSettings(), ...loadJson(SETTINGS_PATH, {}) };
  settings.custom_themes = (Array.isArray(settings.custom_themes) ? settings.custom_themes : []).map(cleanCustomTheme).filter(Boolean).slice(0, MAX_CUSTOM_THEMES);
  settings.emulators = (Array.isArray(settings.emulators) ? settings.emulators : []).map(cleanEmulatorProfile).filter(Boolean);
  settings.rom_folders = Array.isArray(settings.rom_folders) ? settings.rom_folders.filter((folder) => typeof folder === 'string') : [];
  settings.rom_folder_emulators = settings.rom_folder_emulators && typeof settings.rom_folder_emulators === 'object' && !Array.isArray(settings.rom_folder_emulators) ? settings.rom_folder_emulators : {};
  settings.pcsx2_cache_path = typeof settings.pcsx2_cache_path === 'string' ? settings.pcsx2_cache_path : '';
  reloadPcsx2Serials();
  invalidateCoverIndex();
  if (!getTheme(settings.theme_name)) {
    settings.theme_name = THEMES[0].name;
    settings.glow_color = THEMES[0].accent;
    settings.custom_wallpaper_path = '';
    settings.reactive_theme = true;
  }
  const overlay = settings.ra_overlay_config && typeof settings.ra_overlay_config === 'object' ? settings.ra_overlay_config : {};
  settings.ra_overlay_config = { ...defaultSettings().ra_overlay_config, ...overlay };
  const rawLibrary = loadJson(LIBRARY_PATH, {});
  library = mergeLibrary(rawLibrary);
  for (const game of library.games) if (!library.metadata[game.key]) library.metadata[game.key] = cleanMeta();
  const state = loadJson(RA_STATE_PATH, {});
  if (String(state.username || '').toLowerCase() === String(settings.retro_achievements_username || '').toLowerCase()) {
    raSeen = new Set((state.seen_unlock_ids || []).map(String));
    raInitialized = Boolean(state.initialized);
    ra.recentPlayed = Array.isArray(state.recent_played) ? state.recent_played.slice(0, 50) : [];
  }
  raApiKey = unprotectSecret(settings.retro_achievements_key_protected || '');
  steamApiKey = unprotectSecret(settings.steam_api_key_protected || '');
  ra.connected = Boolean(settings.retro_achievements_username && raApiKey);
}

function saveSettings() {
  atomicJson(SETTINGS_PATH, settings);
}

function saveLibrary() {
  atomicJson(LIBRARY_PATH, {
    version: 1,
    metadata: library.metadata,
    entries: library.games.map(({ path: gamePath, title, source }) => ({ path: gamePath, title, source })),
  });
}

function saveRAState() {
  atomicJson(RA_STATE_PATH, {
    username: settings.retro_achievements_username || '',
    seen_unlock_ids: [...raSeen].slice(-500), initialized: raInitialized,
    recent_played: ra.recentPlayed.slice(0, 50),
  });
}

function getMetaByKey(key) {
  return cleanMeta(library.metadata[key] || {});
}

function themeAsset(name) {
  const theme = getTheme(name) || THEMES[0];
  if (theme.custom && theme.wallpaper_path && fs.existsSync(theme.wallpaper_path)) return theme.wallpaper_path;
  const bundled = path.join(app.getAppPath(), 'assets', 'themes', theme.background);
  if (fs.existsSync(bundled)) return bundled;
  return path.join(app.getAppPath(), 'assets', theme.background);
}

function getThemes() {
  return [...THEMES, ...(settings.custom_themes || [])];
}

function getTheme(name) {
  return getThemes().find((item) => item.name === name);
}

function activateTheme(theme) {
  settings.theme_name = theme.name;
  settings.glow_color = theme.accent;
  if (theme.custom) {
    settings.glow_strength = theme.glow_strength;
    settings.theme_panel_opacity = theme.panel_opacity;
    settings.wallpaper_dim_percent = theme.wallpaper_dim;
    settings.reactive_theme = theme.reactive_theme;
    settings.custom_wallpaper_path = theme.wallpaper_path || '';
  } else {
    settings.custom_wallpaper_path = '';
    settings.wallpaper_dim_percent = 35;
    settings.reactive_theme = theme.reactive !== false;
  }
}

function makeCustomTheme(input, fallbackName = '') {
  const rawName = String(input?.name || fallbackName).replace(/[\u0000-\u001f]/g, '').trim().replace(/^Custom:\s*/i, '').slice(0, 32);
  if (!rawName) throw new Error('Give your custom theme a name.');
  const accent = String(input?.accent || settings.glow_color || '#a855f7');
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new Error('Choose a valid theme accent colour.');
  const active = getTheme(settings.theme_name);
  return cleanCustomTheme({
    name: `Custom: ${rawName}`, accent,
    background: input?.background || active?.background || 'midnight.png',
    wallpaper_path: input?.wallpaper_path ?? settings.custom_wallpaper_path ?? '',
    glow_strength: input?.glow_strength ?? settings.glow_strength,
    panel_opacity: input?.panel_opacity ?? settings.theme_panel_opacity,
    wallpaper_dim: input?.wallpaper_dim ?? settings.wallpaper_dim_percent,
    reactive_theme: input?.reactive_theme ?? settings.reactive_theme,
  });
}

function saveCustomTheme(input, { allowUpdate = true } = {}) {
  const theme = makeCustomTheme(input);
  const existingIndex = settings.custom_themes.findIndex((item) => item.name.toLowerCase() === theme.name.toLowerCase());
  if (existingIndex >= 0) {
    if (!allowUpdate || settings.theme_name !== settings.custom_themes[existingIndex].name) throw new Error('A custom theme with that name already exists.');
    settings.custom_themes[existingIndex] = theme;
  } else {
    if (settings.custom_themes.length >= MAX_CUSTOM_THEMES) throw new Error(`You can save up to ${MAX_CUSTOM_THEMES} custom themes.`);
    if (THEMES.some((item) => item.name.toLowerCase() === theme.name.toLowerCase())) throw new Error('That name is already used by a built-in theme.');
    settings.custom_themes.push(theme);
  }
  activateTheme(theme);
  saveSettings();
  publish();
  return theme;
}

function imageUrl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try { return pathToFileURL(filePath).href; } catch { return ''; }
}

function normalizeTitle(value) {
  return normalizeCoverTitle(value);
}

function coverFor(game) {
  const serial = pcsx2SerialForGame(game, pcsx2Serials);
  return imageUrl(findIndexedCover(game, getCoverIndex(), serial));
}

const COVER_SYSTEMS = {
  '.iso': 'Sony - PlayStation 2', '.chd': 'Sony - PlayStation 2', '.cue': 'Sony - PlayStation',
  '.cso': 'Sony - PlayStation Portable', '.pbp': 'Sony - PlayStation Portable',
  '.gcm': 'Nintendo - GameCube', '.gcz': 'Nintendo - GameCube', '.rvz': 'Nintendo - Wii', '.wbfs': 'Nintendo - Wii',
  '.nds': 'Nintendo - Nintendo DS', '.gba': 'Nintendo - Game Boy Advance', '.gbc': 'Nintendo - Game Boy Color', '.gb': 'Nintendo - Game Boy',
  '.z64': 'Nintendo - Nintendo 64', '.n64': 'Nintendo - Nintendo 64', '.v64': 'Nintendo - Nintendo 64',
  '.nes': 'Nintendo - Nintendo Entertainment System', '.sfc': 'Nintendo - Super Nintendo Entertainment System', '.smc': 'Nintendo - Super Nintendo Entertainment System',
  '.md': 'Sega - Mega Drive - Genesis', '.gen': 'Sega - Mega Drive - Genesis', '.3ds': 'Nintendo - Nintendo 3DS',
};

async function downloadCoverFor(game, listingCache) {
  const ext = path.extname(game.path).toLowerCase();
  const isRom = game.source === 'ROM';
  const serial = isRom ? pcsx2SerialForGame(game, pcsx2Serials) : '';
  if (serial) {
    const folder = path.join(COVER_DIR, 'xlenore_ps2_3d');
    const cached = path.join(folder, `${serial}.png`);
    try { if (fs.statSync(cached).size > 100) { invalidateCoverIndex(); return true; } } catch {}
    try {
      await fsp.mkdir(folder, { recursive: true });
      const response = await fetch(PS2_COVER_URL.replace('{serial}', encodeURIComponent(serial)), { headers: { 'User-Agent': 'GameRoulette/2.0' }, signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
          await fsp.writeFile(cached, bytes);
          invalidateCoverIndex();
          return true;
        }
      }
    } catch {}
  }
  const folderName = isRom ? COVER_SYSTEMS[ext] : 'launcher_games';
  if (!folderName) return false;
  const folder = path.join(COVER_DIR, folderName.replace(/[^a-z0-9_-]+/gi, '_'));
  await fsp.mkdir(folder, { recursive: true });
  if (coverFor(game)) return true;
  let imageUrlToFetch = '';
  let fileName = normalizeTitle(game.title);
  if (!isRom) {
    const appId = steamAppIdForGame(game);
    if (appId) {
      fileName = fileName || `steam-${appId}`;
      let candidates = steamLibraryCoverUrls(appId);
      if (await saveSteamArtwork(candidates, folder, fileName)) return true;
      candidates = await fetchSteamStoreArtworkUrls(appId);
      return candidates.length ? saveSteamArtwork(candidates, folder, fileName) : false;
    }
    const search = new URL('https://store.steampowered.com/api/storesearch/');
    search.search = new URLSearchParams({ term: game.title, l: 'english', cc: 'GB' }).toString();
    const response = await fetch(search, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return false;
    const items = (await response.json()).items || [];
    const exact = items.find((item) => normalizeTitle(item.name) === normalizeTitle(game.title));
    const uniqueClose = items.filter((item) => {
      const result = normalizeTitle(item.name); const wanted = normalizeTitle(game.title);
      return result && wanted && (result.includes(wanted) || wanted.includes(result));
    });
    const match = exact || (uniqueClose.length === 1 ? uniqueClose[0] : null);
    if (!match?.id) return false;
    const candidates = [
      ...steamLibraryCoverUrls(match.id),
      ...await fetchSteamStoreArtworkUrls(match.id),
    ];
    return saveSteamArtwork(candidates, folder, fileName || `steam-${match.id}`);
  } else {
    let names = listingCache.get(folderName);
    if (!names) {
      const listing = await fetch('https://thumbnails.libretro.com/' + encodeURIComponent(folderName) + '/Named_Boxarts/', { signal: AbortSignal.timeout(12000) });
      if (!listing.ok) return false;
      const html = await listing.text();
      names = [...html.matchAll(/href="([^"]+\.png)"/gi)].map((match) => decodeURIComponent(match[1].replace(/&amp;/g, '&')));
      listingCache.set(folderName, names);
    }
    const match = matchCoverName(game, names);
    if (!match) return false;
    imageUrlToFetch = 'https://thumbnails.libretro.com/' + encodeURIComponent(folderName) + '/Named_Boxarts/' + encodeURIComponent(match);
    fileName = path.basename(match);
  }
  if (!imageUrlToFetch) return false;
  try {
    const response = await fetch(imageUrlToFetch, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    if (bytes.length < 1000 || (!isPng && !isJpeg)) return false;
    if (!/\.(png|jpe?g)$/i.test(fileName)) fileName += isPng ? '.png' : '.jpg';
    await fsp.writeFile(path.join(folder, fileName), bytes);
    invalidateCoverIndex();
    return true;
  } catch { return false; }
}

async function saveSteamArtwork(candidates, folder, fileName) {
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { signal: AbortSignal.timeout(6500) });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      const extension = coverImageExtension(bytes);
      if (bytes.length < 1000 || !extension) continue;
      await fsp.writeFile(path.join(folder, `${fileName}${extension}`), bytes);
      invalidateCoverIndex();
      return true;
    } catch {}
  }
  return false;
}

async function fetchSteamStoreArtworkUrls(appId) {
  try {
    const response = await fetch(steamAppDetailsUrl(appId), { signal: AbortSignal.timeout(9000) });
    if (!response.ok) return [];
    const result = (await response.json())?.[String(appId)];
    if (!result?.success || !result.data) return [];
    return [result.data.library_capsule, result.data.header_image, result.data.capsule_imagev5, result.data.capsule_image]
      .filter((value) => typeof value === 'string')
      .filter((value) => { try { const url = new URL(value); const host = url.hostname.toLowerCase(); return url.protocol === 'https:' && (host === 'steamstatic.com' || host.endsWith('.steamstatic.com') || host === 'steampowered.com' || host.endsWith('.steampowered.com')); } catch { return false; } });
  } catch { return []; }
}

async function downloadMissingSteamCovers() {
  if (steamCoverSyncPromise) return steamCoverSyncPromise;
  steamCoverSyncPromise = (async () => {
    const missing = library.games.filter((game) => steamAppIdForGame(game) && !coverFor(game));
    let downloaded = 0;
    for (let start = 0; start < missing.length; start += 6) {
      const batch = missing.slice(start, start + 6);
      const results = await Promise.all(batch.map((game) => downloadCoverFor(game, new Map()).catch(() => false)));
      const found = results.filter(Boolean).length;
      downloaded += found;
      if (found) publish();
    }
    return { checked: missing.length, downloaded };
  })().finally(() => { steamCoverSyncPromise = null; });
  return steamCoverSyncPromise;
}

function platformFor(game) {
  if (game.source && game.source !== 'ROM') return game.source;
  const ext = path.extname(game.path).toLowerCase();
  const map = { '.iso':'Disc image', '.chd':'Disc image', '.rvz':'Wii/GameCube', '.gcm':'GameCube', '.gcz':'GameCube', '.wbfs':'Wii', '.nsp':'Nintendo Switch', '.xci':'Nintendo Switch', '.3ds':'Nintendo 3DS', '.nds':'Nintendo DS', '.gba':'Game Boy Advance', '.gbc':'Game Boy Color', '.gb':'Game Boy', '.sfc':'Super Nintendo', '.smc':'Super Nintendo', '.nes':'NES', '.z64':'Nintendo 64', '.n64':'Nintendo 64', '.md':'Mega Drive', '.gen':'Mega Drive', '.cso':'PSP', '.pbp':'PSP' };
  return map[ext] || 'ROM';
}

function dashboardGame(game) {
  const meta = getMetaByKey(game.key);
  return { key: game.key, title: game.title, platform: platformFor(game), source: game.source, status: meta.status, rating: meta.rating, art: coverFor(game), collections: meta.collections };
}

function snapshot() {
  const names = collectionNames(library.games, library.metadata);
  const counts = Object.fromEntries(STATUSES.map((status) => [status, library.games.filter((game) => getMetaByKey(game.key).status === status).length]));
  const ordered = [...library.games].sort((a, b) => (getMetaByKey(a.key).status === 'Playing' ? 0 : getMetaByKey(b.key).status === 'Playing' ? 1 : 0) || a.title.localeCompare(b.title));
  const featured = ordered.find((game) => getMetaByKey(game.key).status === 'Playing') || ordered[0] || null;
  const recentLocal = [...library.games].filter((game) => Number(getMetaByKey(game.key).last_played || 0) > 0).sort((a, b) => Number(getMetaByKey(b.key).last_played) - Number(getMetaByKey(a.key).last_played)).slice(0, 4);
  const linkedById = new Map(library.games.map((game) => [String(getMetaByKey(game.key).ra_game_id || ''), game]).filter(([id]) => id));
  const recentFromRA = ra.recentPlayed.map((entry) => {
    const game = linkedById.get(String(entry.GameID || entry.gameId || entry.ID || ''));
    if (!game) return null;
    const playedAt = Date.parse(entry.LastPlayed || entry.lastPlayed || '');
    return { ...dashboardGame(game), lastPlayed: Number.isFinite(playedAt) ? new Date(playedAt).toLocaleString() : 'Recently played' };
  }).filter(Boolean);
  const recentlyPlayed = [...recentFromRA, ...recentLocal.map((game) => ({ ...dashboardGame(game), lastPlayed: new Date(getMetaByKey(game.key).last_played).toLocaleString() }))]
    .filter((game, index, all) => all.findIndex((item) => item.key === game.key) === index).slice(0, 4);
  const unlocks = ra.recent.slice(0, 5).map((record) => ({ title: record.Title || record.title || 'Achievement unlocked', game: record.GameTitle || record.gameTitle || '', gameId: record.GameID || record.gameId || record.ID || '', points: record.Points ?? record.points ?? 0, date: record.Date || record.date || '' }));
  const profile = ra.profile || {};
  const overlay = settings.ra_overlay_config;
  return {
    version: '2.0', name: settings.profile_display_name || 'Player', avatar: imageUrl(settings.profile_avatar_path),
    accent: settings.glow_color || '#a855f7', panelOpacity: Number(settings.theme_panel_opacity || 98) / 100,
    dim: Number(settings.wallpaper_dim_percent || 35), wallpaper: imageUrl(settings.custom_wallpaper_path) || imageUrl(themeAsset(settings.theme_name)),
    theme: settings.theme_name || THEMES[0].name, customTheme: Boolean(getTheme(settings.theme_name)?.custom),
    themes: getThemes().map(({ name, accent, custom }) => ({ name, accent, custom: Boolean(custom) })),
    settings: { ...settings, retro_achievements_key_protected: undefined, steam_api_key_protected: undefined },
    accounts: {
      steam: {
        connected: /^\d{17}$/.test(String(settings.steam_id || '')),
        steamId: /^\d{17}$/.test(String(settings.steam_id || '')) ? String(settings.steam_id) : '',
        hasApiKey: Boolean(steamApiKey),
        importedGames: library.games.filter((game) => game.source === 'Steam linked account').length,
      },
    },
    stats: { total: library.games.length, backlog: counts.Backlog, playing: counts.Playing, completed: counts.Completed + counts['100% Completed'], collections: names.length, unlocks: unlocks.length },
    ra: { connected: Boolean(ra.connected), username: settings.retro_achievements_username || '', rank: profile.Rank || profile.rank || '', points: profile.TotalPoints || profile.totalPoints || '', presence: profile.RichPresenceMsg || profile.richPresenceMsg || '', error: ra.error, profile, recentRecords: ra.recent, recentPlayed: ra.recentPlayed, completion: ra.completion },
    games: library.games.map((game) => {
      const meta = getMetaByKey(game.key);
      return { ...dashboardGame(game), path: game.path, isRom: game.source === 'ROM' && ROM_EXTENSIONS.has(path.extname(game.path).toLowerCase()), emulator_id: meta.emulator_id || '', emulator_assignment: meta.emulator_assignment || '', notes: meta.notes, completed_date: meta.completed_date, last_played: meta.last_played || 0, ra_game_id: meta.ra_game_id || '' };
    }),
    emulatorCatalog: [
      ...EMULATOR_PRESETS.map((preset) => {
        const configured = settings.emulators.find((item) => item.id === preset.id);
        return { ...preset, configured: Boolean(configured), executablePath: configured?.executable_path || '', assignedGames: library.games.filter((game) => getMetaByKey(game.key).emulator_id === preset.id).length };
      }),
      ...settings.emulators.filter((item) => item.custom).map((profile) => ({ ...profile, configured: true, executablePath: profile.executable_path, assignedGames: library.games.filter((game) => getMetaByKey(game.key).emulator_id === profile.id).length })),
    ],
    featured: featured ? dashboardGame(featured) : null,
    collection: ordered.slice(0, 4).map(dashboardGame),
    backlogGames: ordered.filter((game) => getMetaByKey(game.key).status === 'Backlog').slice(0, 3).map(dashboardGame),
    recentlyPlayed,
    achievements: unlocks, achievementProgress: null,
    collections: names.map((name) => ({ name, count: library.games.filter((game) => getMetaByKey(game.key).collections.includes(name)).length })),
    statuses: STATUSES, folders: settings.rom_folders || [], overlayUrl, overlay,
  };
}

function publish() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:changed', snapshot());
}

async function walkFiles(roots) {
  const stack = roots.map((entry) => path.resolve(entry));
  const files = [];
  while (stack.length) {
    const dir = stack.pop();
    let children;
    try { children = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      const full = path.join(dir, child.name);
      if (child.isDirectory()) stack.push(full);
      else if (child.isFile()) files.push(full);
    }
  }
  return files;
}

async function scanFolders() {
  if (scanBusy) throw new Error('A scan is already running.');
  if (!settings.rom_folders?.length) throw new Error('Add at least one ROM folder first.');
  scanBusy = true;
  try {
    const allFiles = await walkFiles(settings.rom_folders);
    const cueSet = new Set(allFiles.filter((file) => path.extname(file).toLowerCase() === '.cue').map((file) => `${path.dirname(file).toLowerCase()}|${path.basename(file, path.extname(file)).toLowerCase()}`));
    const candidates = allFiles.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      if (!ROM_EXTENSIONS.has(ext)) return false;
      return ext !== '.bin' || !cueSet.has(`${path.dirname(file).toLowerCase()}|${path.basename(file, ext).toLowerCase()}`);
    });
    const existing = new Set(library.games.map((game) => game.key));
    let added = 0;
    for (const file of candidates) {
      const game = normalizeGame({ path: file, source: 'ROM' });
      const selectedEmulator = emulatorForRom(file, settings.rom_folders, settings.rom_folder_emulators);
      const emulatorId = settings.emulators.some((profile) => profile.id === selectedEmulator) ? selectedEmulator : '';
      if (!existing.has(game.key)) {
        library.games.push(game);
        library.metadata[game.key] = cleanMeta({ emulator_id: emulatorId, emulator_assignment: emulatorId ? 'folder' : '' });
        existing.add(game.key);
        added += 1;
      } else {
        const meta = getMetaByKey(game.key);
        if (meta.emulator_assignment !== 'manual') {
          meta.emulator_id = emulatorId;
          meta.emulator_assignment = emulatorId ? 'folder' : '';
          library.metadata[game.key] = cleanMeta(meta);
        }
      }
    }
    library.games.sort((a, b) => a.title.localeCompare(b.title));
    saveLibrary();
    return { scanned: candidates.length, added };
  } finally { scanBusy = false; }
}

async function fetchRA(endpoint, params = {}) {
  if (!settings.retro_achievements_username || !raApiKey) throw new Error('Connect your RetroAchievements account first.');
  const url = new URL(endpoint, RA_BASE);
  url.searchParams.set('y', raApiKey);
  for (const [key, value] of Object.entries({ u: settings.retro_achievements_username, ...params })) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { 'User-Agent': 'GameRoulette/2.0 (JavaScript Edition)', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`RetroAchievements returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload && (payload.Error || payload.error)) throw new Error(String(payload.Error || payload.error));
  return payload;
}

async function refreshRA() {
  if (!settings.retro_achievements_username || !raApiKey) throw new Error('Add your RetroAchievements username and Web API key in Settings.');
  ra.error = '';
  const [profile, recent, completion, recentPlayed] = await Promise.all([
    fetchRA('API_GetUserProfile.php'),
    fetchRA('API_GetUserRecentAchievements.php', { m: 120 }),
    fetchRA('API_GetUserCompletionProgress.php', { c: 100, o: 0 }).catch(() => []),
    fetchRA('API_GetUserRecentlyPlayedGames.php', { c: 50, o: 0 }).catch(() => []),
  ]);
  if (!profile || !(profile.User || profile.user)) throw new Error('RetroAchievements did not return a profile. Check the username and key.');
  ra.profile = profile;
  ra.recent = Array.isArray(recent) ? recent : [];
  ra.completion = Array.isArray(completion) ? completion : (Array.isArray(completion?.Results) ? completion.Results : []);
  ra.recentPlayed = Array.isArray(recentPlayed) ? recentPlayed : [];
  ra.connected = true;
  const newItems = [];
  for (const item of ra.recent) {
    const id = String(item.HardcoreID || item.id || item.ID || `${item.GameID || item.gameId}:${item.Title || item.title}:${item.Date || item.date}`);
    if (raInitialized && !raSeen.has(id)) newItems.push(item);
    raSeen.add(id);
  }
  if (!raInitialized) raInitialized = true;
  if (newItems.length) {
    const latest = newItems[0];
    overlayEvent = { id: String(latest.HardcoreID || Date.now()), title: String(latest.Title || latest.title || 'Achievement unlocked').slice(0, 120), game: String(latest.GameTitle || latest.gameTitle || '').slice(0, 120), points: String(latest.Points || latest.points || 0), visible_until: Date.now() / 1000 + 12 };
  }
  saveRAState();
  publish();
  return { count: ra.recent.length };
}

function startOverlayServer() {
  if (overlayServer) return;
  const root = path.join(app.getAppPath(), 'OBS Bottom Bar');
  const safeFiles = new Set(['index.html', 'overlay.css', 'overlay.js']);
  overlayServer = http.createServer(async (req, res) => {
    const route = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    if (route === 'state.json') {
      const config = settings.ra_overlay_config || {};
      const body = JSON.stringify({ enabled: Boolean(config.enabled), height: config.height, opacity: config.opacity, show_icon: Boolean(config.show_icon), show_game: Boolean(config.show_game), show_points: Boolean(config.show_points), accent: settings.glow_color, event: overlayEvent });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); return;
    }
    const file = route || 'index.html';
    if (!safeFiles.has(file)) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const body = await fsp.readFile(path.join(root, file));
      const types = { 'index.html': 'text/html; charset=utf-8', 'overlay.css': 'text/css; charset=utf-8', 'overlay.js': 'application/javascript; charset=utf-8' };
      res.writeHead(200, { 'Content-Type': types[file], 'Cache-Control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const publishUrl = () => {
    overlayUrl = `http://127.0.0.1:${overlayServer.address().port}/`;
    publish();
  };
  overlayServer.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && !overlayUrl) overlayServer.listen(0, '127.0.0.1', publishUrl);
  });
  overlayServer.listen(47831, '127.0.0.1', publishUrl);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1050, minHeight: 690,
    frame: false, backgroundColor: '#070711', show: false,
    title: 'Game Roulette', icon: path.join(app.getAppPath(), 'game_roulette_icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => { mainWindow.show(); publish(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function addGame(game) {
  const normalized = normalizeGame(game);
  if (!normalized) return false;
  if (library.games.some((item) => item.key === normalized.key || item.title.toLowerCase() === normalized.title.toLowerCase())) return false;
  library.games.push(normalized);
  library.metadata[normalized.key] = cleanMeta(game.metadata || {});
  return true;
}

function spawnDetached(executable, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Windows could not start ${path.basename(executable)}: ${error.message}`));
    });
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}

function installIpc() {
  ipcMain.handle('app:snapshot', () => snapshot());
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggle-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:big-picture', (_event, active) => { mainWindow?.setFullScreen(Boolean(active)); return Boolean(mainWindow?.isFullScreen()); });
  ipcMain.handle('app:reveal-data-folder', async () => { await fsp.mkdir(DATA_DIR, { recursive: true }); await shell.openPath(DATA_DIR); return DATA_DIR; });
  ipcMain.handle('library:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'multiSelections'] });
    if (result.canceled) return { folders: settings.rom_folders || [] };
    settings.rom_folders = [...new Set([...(settings.rom_folders || []), ...result.filePaths])]; saveSettings(); publish(); return { folders: settings.rom_folders };
  });
  ipcMain.handle('library:set-folder-emulator', async (_event, folder, emulatorId) => {
    const selectedFolder = String(folder || '');
    const configuredFolder = (settings.rom_folders || []).find((item) => path.resolve(item).toLowerCase() === path.resolve(selectedFolder).toLowerCase());
    if (!configuredFolder) throw new Error('That ROM folder is no longer in your library settings.');
    const selectedId = String(emulatorId || '');
    if (selectedId && !settings.emulators.some((profile) => profile.id === selectedId)) throw new Error('Set up that emulator before assigning it to a folder.');
    if (selectedId) settings.rom_folder_emulators[configuredFolder] = selectedId;
    else delete settings.rom_folder_emulators[configuredFolder];
    saveSettings(); publish();
    return { saved: true };
  });
  ipcMain.handle('emulator:setup-preset', async (_event, emulatorId) => {
    const preset = EMULATOR_PRESETS.find((item) => item.id === String(emulatorId || ''));
    if (!preset) throw new Error('Choose a supported emulator first.');
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Windows applications', extensions: ['exe'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const executablePath = path.resolve(result.filePaths[0]);
    if (!fs.existsSync(executablePath) || path.extname(executablePath).toLowerCase() !== '.exe') throw new Error('Choose the emulator’s Windows .exe file.');
    const profile = cleanEmulatorProfile({ ...preset, executable_path: executablePath });
    const existingIndex = settings.emulators.findIndex((item) => item.id === profile.id);
    if (existingIndex >= 0) settings.emulators[existingIndex] = profile;
    else settings.emulators.push(profile);
    saveSettings(); publish();
    return { configured: true, name: profile.name };
  });
  ipcMain.handle('emulator:choose-executable', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Windows applications', extensions: ['exe'] }] });
    return result.canceled ? '' : (result.filePaths[0] || '');
  });
  ipcMain.handle('emulator:add-custom', async (_event, input = {}) => {
    const name = String(input.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 48);
    const executablePath = path.resolve(String(input.executablePath || ''));
    if (!name) throw new Error('Give this emulator a name.');
    if (!executablePath || !fs.existsSync(executablePath) || path.extname(executablePath).toLowerCase() !== '.exe') throw new Error('Choose the emulator’s Windows .exe file.');
    const args = String(input.args || '{rom}').trim().slice(0, 240) || '{rom}';
    buildLaunchArguments(args, 'C:\\Example Games\\Game.iso');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'emulator';
    const id = `custom-${slug}-${crypto.randomBytes(3).toString('hex')}`;
    const profile = cleanEmulatorProfile({ id, name, platform: 'Custom emulator', executable_path: executablePath, args });
    settings.emulators.push(profile); saveSettings(); publish();
    return { id, name };
  });
  ipcMain.handle('emulator:remove', async (_event, emulatorId) => {
    const id = String(emulatorId || '');
    if (!settings.emulators.some((profile) => profile.id === id)) throw new Error('That emulator is not set up.');
    settings.emulators = settings.emulators.filter((profile) => profile.id !== id);
    for (const [folder, assignedId] of Object.entries(settings.rom_folder_emulators)) if (assignedId === id) delete settings.rom_folder_emulators[folder];
    for (const game of library.games) {
      const meta = getMetaByKey(game.key);
      if (meta.emulator_id === id) { meta.emulator_id = ''; meta.emulator_assignment = ''; library.metadata[game.key] = cleanMeta(meta); }
    }
    saveSettings(); saveLibrary(); publish();
    return { removed: true };
  });
  ipcMain.handle('library:choose-cover-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'multiSelections'] });
    if (result.canceled) return { folders: settings.cover_folders || [] };
    settings.cover_folders = [...new Set([...(settings.cover_folders || []), ...result.filePaths])]; invalidateCoverIndex(); saveSettings(); publish(); return { folders: settings.cover_folders };
  });
  ipcMain.handle('library:choose-pcsx2-cache', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'PCSX2 game list cache', extensions: ['cache'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    settings.pcsx2_cache_path = path.resolve(result.filePaths[0]);
    reloadPcsx2Serials(); saveSettings(); publish();
    return { canceled: false, path: settings.pcsx2_cache_path };
  });
  ipcMain.handle('library:auto-pcsx2-cache', () => {
    settings.pcsx2_cache_path = '';
    reloadPcsx2Serials(); saveSettings(); publish();
    return { reset: true };
  });
  ipcMain.handle('library:scan', async () => { const result = await scanFolders(); publish(); return result; });
  ipcMain.handle('library:download-covers', async () => {
    reloadPcsx2Serials();
    const missing = library.games.filter((game) => !coverFor(game));
    const listingCache = new Map();
    let downloaded = 0;
    for (const game of missing) if (await downloadCoverFor(game, listingCache)) downloaded += 1;
    publish();
    return { checked: missing.length, downloaded };
  });
  ipcMain.handle('library:import-launchers', async (_event, sources = []) => {
    const found = [];
    if (sources.includes('Steam')) {
      const roots = [...new Set([path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')])];
      for (let index = 0; index < roots.length; index += 1) {
        const root = roots[index];
        try {
          const vdf = await fsp.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
          for (const match of vdf.matchAll(/"path"\s+"([^"]+)"|"\d+"\s+"([^"]+)"/gi)) {
            const libraryRoot = (match[1] || match[2] || '').replace(/\\\\/g, '\\');
            if (libraryRoot && !roots.includes(libraryRoot)) roots.push(libraryRoot);
          }
        } catch {}
      }
      for (const root of roots) {
        try {
          const manifests = path.join(root, 'steamapps');
          for (const file of await fsp.readdir(manifests)) {
            const match = /^appmanifest_(\d+)\.acf$/i.exec(file); if (!match) continue;
            const text = await fsp.readFile(path.join(manifests, file), 'utf8');
            const name = /"name"\s+"([^"]+)"/i.exec(text)?.[1];
            if (name) found.push({ path: `steam://rungameid/${match[1]}`, title: name, source: 'Steam' });
          }
        } catch {}
      }
    }
    if (sources.includes('Epic Games')) {
      const manifestDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'EpicGamesLauncher', 'Saved', 'Config', 'Windows', 'Manifests');
      try {
        for (const file of await fsp.readdir(manifestDir)) {
          if (!file.endsWith('.item')) continue;
          try {
            const item = JSON.parse(await fsp.readFile(path.join(manifestDir, file), 'utf8'));
            if (item.DisplayName && item.InstallLocation) found.push({ path: path.resolve(item.InstallLocation, item.LaunchExecutable || ''), title: item.DisplayName, source: 'Epic Games' });
          } catch {}
        }
      } catch {}
    }
    const shortcutLaunchers = { 'GOG Galaxy': 'GOG.com', 'Ubisoft Connect': 'Ubisoft', 'EA app': 'EA Games', 'Xbox app': 'Xbox Games' };
    const selectedShortcuts = Object.entries(shortcutLaunchers).filter(([launcher]) => sources.includes(launcher));
    if (selectedShortcuts.length) {
      const roots = [
        path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
        path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
        path.join(os.homedir(), 'Desktop'),
      ];
      const shortcuts = (await walkFiles(roots)).filter((file) => path.extname(file).toLowerCase() === '.lnk');
      for (const file of shortcuts) for (const [launcher, marker] of selectedShortcuts) {
        if (file.toLowerCase().includes(marker.toLowerCase())) found.push({ path: file, title: path.basename(file, '.lnk'), source: launcher });
      }
    }
    const added = found.filter(addGame).length;
    saveLibrary(); publish();
    return { added, found: found.length };
  });
  ipcMain.handle('accounts:steam-connect', async () => {
    const steamId = await connectSteamThroughOpenId();
    settings.steam_id = steamId;
    saveSettings(); publish();
    return { steamId };
  });
  ipcMain.handle('accounts:steam-save-key', async (_event, value) => {
    const key = String(value || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(key)) throw new Error('Enter the 32-character Steam Web API key from your Steam key page.');
    const protectedKey = protectSecret(key);
    settings.steam_api_key_protected = protectedKey;
    steamApiKey = key;
    saveSettings(); publish();
    return { saved: true };
  });
  ipcMain.handle('accounts:steam-sync', async () => {
    const ownedGames = await getSteamOwnedGames();
    const added = ownedGames.filter(addGame).length;
    saveLibrary(); publish();
    void downloadMissingSteamCovers();
    return { added, total: ownedGames.length };
  });
  ipcMain.handle('achievements:steam-game', async (_event, gameKey) => getSteamAchievementsForGame(gameKey));
  ipcMain.handle('accounts:steam-disconnect', async () => {
    settings.steam_id = '';
    settings.steam_api_key_protected = '';
    steamApiKey = '';
    saveSettings(); publish();
    return true;
  });
  ipcMain.handle('accounts:steam-open-key-page', async () => {
    await shell.openExternal('https://steamcommunity.com/dev/apikey');
    return true;
  });
  ipcMain.handle('library:launch', async (_event, key) => {
    const game = library.games.find((item) => item.key === key); if (!game) throw new Error('That game is no longer in the library.');
    const meta = getMetaByKey(key);
    const markLaunched = () => { meta.status = 'Playing'; meta.last_played = Date.now(); library.metadata[key] = meta; saveLibrary(); publish(); };
    if (game.path.startsWith('steam://')) { await shell.openExternal(game.path); markLaunched(); return { launched: true }; }
    if (/\.lnk$/i.test(game.path)) { const error = await shell.openPath(game.path); if (error) throw new Error(error); markLaunched(); return { launched: true }; }
    if (!fs.existsSync(game.path)) throw new Error('The game file is not available at the saved location.');
    if (meta.emulator_id) {
      const profile = settings.emulators.find((item) => item.id === meta.emulator_id);
      if (!profile) throw new Error('The selected emulator is no longer set up. Open Settings → Emulator setup to choose it again.');
      if (!fs.existsSync(profile.executable_path)) throw new Error(`${profile.name} could not be found. Re-select its application in Settings → Emulator setup.`);
      const args = buildLaunchArguments(profile.args, game.path);
      await spawnDetached(profile.executable_path, args);
      markLaunched();
      return { launched: true, emulator: profile.name };
    }
    if (game.source === 'ROM' && ROM_EXTENSIONS.has(path.extname(game.path).toLowerCase())) throw new Error('Choose an emulator for this game in Edit Game, or assign its ROM folder in Settings → Library Management.');
    await spawnDetached(game.path, []);
    markLaunched();
    return { launched: true };
  });
  ipcMain.handle('library:update-game', async (_event, key, patch = {}) => {
    if (!library.games.some((game) => game.key === key)) throw new Error('Game not found.');
    if (Object.hasOwn(patch, 'emulator_id') && patch.emulator_id && !settings.emulators.some((profile) => profile.id === patch.emulator_id)) throw new Error('Set up this emulator before assigning it to a game.');
    const before = getMetaByKey(key); const next = cleanMeta({ ...before, ...patch });
    if (next.status === 'Completed' || next.status === '100% Completed') next.completed_date = next.completed_date || new Date().toISOString().slice(0, 10);
    library.metadata[key] = next; saveLibrary(); publish(); return next;
  });
  ipcMain.handle('library:remove-game', async (_event, key) => {
    const removed = removeGame(library, String(key || ''));
    if (!removed) throw new Error('That game is no longer in the library.');
    saveLibrary(); publish(); return { title: removed.title };
  });
  ipcMain.handle('library:clear-roms', async () => {
    if (scanBusy) throw new Error('Wait for the library scan to finish before clearing ROM entries.');
    const removed = clearRomGames(library);
    if (removed) { saveLibrary(); publish(); }
    return { removed };
  });
  ipcMain.handle('roulette:spin', async (_event, filters = {}) => {
    const candidates = library.games.filter((game) => {
      const meta = getMetaByKey(game.key);
      if (filters.status && filters.status !== 'All statuses' && meta.status !== filters.status) return false;
      if (filters.collection && filters.collection !== 'All collections' && !meta.collections.includes(filters.collection)) return false;
      if (filters.excludeCompleted && ['Completed', '100% Completed'].includes(meta.status)) return false;
      return true;
    });
    if (!candidates.length) throw new Error('No games match those roulette filters.');
    return dashboardGame(candidates[Math.floor(Math.random() * candidates.length)]);
  });
  ipcMain.handle('profile:save-name', async (_event, value) => {
    const name = String(value || '').trim().slice(0, 48); if (!name) throw new Error('Enter a player name.');
    settings.profile_display_name = name; saveSettings(); publish(); return name;
  });
  ipcMain.handle('profile:choose-avatar', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png','jpg','jpeg','webp','bmp'] }] });
    if (result.canceled || !result.filePaths[0]) return '';
    const source = result.filePaths[0]; const ext = path.extname(source).toLowerCase() || '.png'; const dest = path.join(DATA_DIR, `profile-avatar${ext}`);
    await fsp.mkdir(DATA_DIR, { recursive: true }); await fsp.copyFile(source, dest); settings.profile_avatar_path = dest; saveSettings(); publish(); return imageUrl(dest);
  });
  ipcMain.handle('appearance:set-theme', async (_event, name) => {
    const theme = getTheme(name); if (!theme) throw new Error('Choose one of the available themes.');
    activateTheme(theme); saveSettings(); publish(); return theme.name;
  });
  ipcMain.handle('appearance:save-custom-theme', async (_event, input = {}) => {
    const theme = saveCustomTheme(input); return theme.name;
  });
  ipcMain.handle('appearance:delete-custom-theme', async () => {
    const active = getTheme(settings.theme_name);
    if (!active?.custom) throw new Error('Choose one of your custom themes to delete.');
    settings.custom_themes = settings.custom_themes.filter((item) => item.name !== active.name);
    activateTheme(THEMES[0]); saveSettings(); publish(); return true;
  });
  ipcMain.handle('appearance:export-theme', async (_event, name) => {
    const theme = getTheme(name) || getTheme(settings.theme_name);
    if (!theme) throw new Error('Choose a theme to export.');
    const fileName = `${theme.name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '') || 'Game-Roulette-Theme'}.grtheme`;
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: fileName, filters: [{ name: 'Game Roulette theme package', extensions: ['grtheme'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const wallpaperPath = themeAsset(theme.name);
    const wallpaper = await fsp.readFile(wallpaperPath);
    if (wallpaper.length > 16 * 1024 * 1024) throw new Error('That wallpaper is too large to include in a theme package.');
    const ext = path.extname(wallpaperPath).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    const payload = { format: THEME_FILE_FORMAT, formatVersion: 2, theme: { name: theme.name.replace(/^Custom:\s*/i, ''), accent: settings.glow_color, glow_strength: settings.glow_strength, panel_opacity: settings.theme_panel_opacity, wallpaper_dim: settings.wallpaper_dim_percent, reactive_theme: settings.reactive_theme }, image: { mimeType, data: wallpaper.toString('base64') } };
    await fsp.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { exported: true };
  });
  ipcMain.handle('appearance:import-theme', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Game Roulette theme package', extensions: ['grtheme','json'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const info = await fsp.stat(result.filePaths[0]);
    if (info.size > 24 * 1024 * 1024) throw new Error('That theme package is too large to import.');
    const file = JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8'));
    if (file?.format !== THEME_FILE_FORMAT || ![1, 2].includes(file?.formatVersion) || !file.theme || typeof file.theme !== 'object') throw new Error('That file is not a supported Game Roulette theme.');
    let wallpaperPath = '';
    if (file.formatVersion === 2) {
      const image = file.image;
      const mimeExtensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
      const ext = mimeExtensions[image?.mimeType];
      if (!ext || typeof image.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) throw new Error('This theme package does not contain a supported wallpaper image.');
      const buffer = Buffer.from(image.data, 'base64');
      if (!buffer.length || buffer.length > 16 * 1024 * 1024) throw new Error('The theme wallpaper is empty or too large.');
      const signatureOk = ext === '.png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : ext === '.jpg' ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
          : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
      if (!signatureOk) throw new Error('The wallpaper image does not match its declared format.');
      const themeDir = path.join(DATA_DIR, 'themes');
      await fsp.mkdir(themeDir, { recursive: true });
      wallpaperPath = path.join(themeDir, `${crypto.randomUUID()}${ext}`);
      await fsp.writeFile(wallpaperPath, buffer, { flag: 'wx' });
    }
    const theme = saveCustomTheme({ ...file.theme, wallpaper_path: wallpaperPath, background: 'neon-arcade.png' }, { allowUpdate: false });
    return { imported: theme.name };
  });
  ipcMain.handle('appearance:update', async (_event, patch = {}) => {
    if (typeof patch.accent === 'string' && /^#[0-9a-f]{6}$/i.test(patch.accent)) settings.glow_color = patch.accent;
    if (Number.isFinite(Number(patch.glow_strength))) settings.glow_strength = Math.max(0, Math.min(10, Number(patch.glow_strength)));
    if (Number.isFinite(Number(patch.panel_opacity))) settings.theme_panel_opacity = Math.max(55, Math.min(100, Number(patch.panel_opacity)));
    if (Number.isFinite(Number(patch.wallpaper_dim))) settings.wallpaper_dim_percent = Math.max(0, Math.min(80, Number(patch.wallpaper_dim)));
    if (typeof patch.reactive_theme === 'boolean') settings.reactive_theme = patch.reactive_theme;
    if (patch.overlay && typeof patch.overlay === 'object') settings.ra_overlay_config = { ...settings.ra_overlay_config, ...patch.overlay };
    if (typeof patch.ra_notifications_enabled === 'boolean') settings.ra_notifications_enabled = patch.ra_notifications_enabled;
    saveSettings(); publish(); return snapshot();
  });
  ipcMain.handle('appearance:choose-wallpaper', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png','jpg','jpeg','webp','bmp'] }] });
    if (result.canceled || !result.filePaths[0]) return '';
    settings.custom_wallpaper_path = result.filePaths[0]; saveSettings(); publish(); return imageUrl(settings.custom_wallpaper_path);
  });
  ipcMain.handle('backup:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: 'game-roulette-backup.json', filters: [{ name: 'JSON backup', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const entries = library.games.map((game) => ({ path: game.path, title: game.title, source: game.source, metadata: getMetaByKey(game.key) }));
    await fsp.writeFile(result.filePath, JSON.stringify({ version: 1, games: entries }, null, 2), 'utf8'); return { exported: entries.length };
  });
  ipcMain.handle('backup:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'JSON backup', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const backup = JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8'));
    if (!Array.isArray(backup.games)) throw new Error('That backup does not contain a Game Roulette library.');
    let added = 0;
    for (const item of backup.games) if (addGame(item)) added += 1;
    saveLibrary(); publish(); return { added };
  });
  ipcMain.handle('ra:connect', async (_event, details = {}) => {
    const username = String(details.username || '').trim(); const key = String(details.apiKey || '').trim();
    if (!username || !key) throw new Error('Enter both your RetroAchievements username and Web API key.');
    settings.retro_achievements_username = username; settings.retro_achievements_key_protected = protectSecret(key); raApiKey = key; ra.connected = true; raSeen.clear(); raInitialized = false; saveSettings();
    await refreshRA(); return { connected: true };
  });
  ipcMain.handle('ra:refresh', async () => refreshRA());
  ipcMain.handle('ra:game-set', async (_event, gameId) => {
    const payload = await fetchRA('API_GetGameInfoAndUserProgress.php', { g: Number(gameId), a: 1, u: settings.retro_achievements_username });
    return payload;
  });
  ipcMain.handle('ra:link-game', async (_event, key, gameId) => {
    if (!library.games.some((game) => game.key === key)) throw new Error('Game not found.');
    const meta = getMetaByKey(key); meta.ra_game_id = Number(gameId); library.metadata[key] = meta; saveLibrary(); publish(); return meta;
  });
  ipcMain.handle('ra:disconnect', async () => {
    settings.retro_achievements_username = ''; settings.retro_achievements_key_protected = ''; raApiKey = ''; ra = { profile: null, recent: [], recentPlayed: [], completion: [], connected: false, error: '' }; raSeen.clear(); raInitialized = false; overlayEvent = null; saveSettings(); saveRAState(); publish(); return true;
  });
  ipcMain.handle('obs:url', () => overlayUrl);
}

app.whenReady().then(() => {
  loadData();
  startOverlayServer();
  installIpc();
  createWindow();
  if (settings.ra_overlay_config.enabled) startOverlayServer();
  if (ra.connected && settings.ra_notifications_enabled) setTimeout(() => refreshRA().catch((error) => { ra.error = error.message; publish(); }), 1200);
  refreshTimer = setInterval(() => { if (ra.connected && settings.ra_notifications_enabled) refreshRA().catch((error) => { ra.error = error.message; publish(); }); }, Math.max(1, Number(settings.ra_poll_minutes) || 2) * 60 * 1000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => {
  if (DEV_SESSION_DATA) {
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  }
});
app.on('before-quit', () => { clearInterval(refreshTimer); if (overlayServer) overlayServer.close(); });

