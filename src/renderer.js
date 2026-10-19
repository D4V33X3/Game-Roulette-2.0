(() => {
  const api = window.gameRoulette;
  const pageEl = document.getElementById('page');
  const dialog = document.getElementById('gameDialog');
  let data = null;
  let currentPage = 'dashboard';
  let searchTerm = '';
  let activeCollection = '';
  let collectionPlatformFilter = 'All games';
  let libraryStatusFilter = 'All statuses';
  let rouletteWinner = null;
  let currentAchievementSet = null;
  let achievementFilter = 'all';
  let customEmulatorPath = '';
  let busy = false;
  let steamAchievementKey = '';
  let steamAchievementSet = null;
  let steamAchievementLoading = false;
  let steamAchievementError = '';
  let steamAchievementFilter = 'all';
  let steamAchievementRequest = 0;
  let bigPictureActive = false;
  let bigPicturePreviousPage = 'dashboard';
  let bigPictureSelectedKey = '';
  let bigPictureFocusedKey = '';
  let bigPictureStatusFilter = 'All statuses';
  let gamepadTimer = null;
  let gamepadNavRepeatAt = 0;
  let gamepadActionWasDown = false;
  let gamepadBackWasDown = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const fmt = (value) => Number(value || 0).toLocaleString();
  const gameByKey = (key) => data?.games.find((game) => game.key === key);
  const toast = (message) => { const node = document.getElementById('toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2800); };
  const status = (message) => { document.getElementById('statusLine').textContent = message; };
  const img = (src, alt = '') => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : '<span aria-hidden="true">🎮</span>';
  const cover = (game, cls = 'game-art') => `<div class="${cls}">${game?.art ? img(game.art, game.title) : '<span aria-hidden="true">🎮</span>'}</div>`;
  const button = (action, text, extra = '') => `<button class="small-button" data-action="${action}" ${extra}>${text}</button>`;
  const pageHeader = (title, subtitle, right = '') => `<div class="page-header"><div><h2>${title}</h2><p>${subtitle}</p></div><div class="toolbar">${right}</div></div>`;
  const empty = (message) => `<div class="empty-state">${message}</div>`;

  function setTheme() {
    if (!data) return;
    document.documentElement.style.setProperty('--accent', data.accent || '#a855f7');
    document.documentElement.style.setProperty('--panel-alpha', String(Math.max(55, Math.min(100, Number(data.settings?.theme_panel_opacity || 98)))));
    document.documentElement.style.setProperty('--glow-strength', String(Math.max(0, Math.min(10, Number(data.settings?.glow_strength ?? 3))) / 10));
    document.documentElement.style.setProperty('--page-dim', String(Math.max(0, Math.min(80, Number(data.dim ?? 35))) / 100));
    document.documentElement.style.setProperty('--wallpaper', data.wallpaper ? `url("${String(data.wallpaper).replaceAll('"', '%22')}")` : 'none');
    document.body.classList.toggle('reactive-theme', data.settings?.reactive_theme !== false);
    document.getElementById('welcomeName').textContent = data.name || 'Player';
    document.getElementById('sideName').textContent = data.name || 'Player';
    const headerAvatar = document.getElementById('headerAvatar');
    const sideAvatar = document.getElementById('sideAvatar');
    if (data.avatar) { headerAvatar.src = data.avatar; sideAvatar.innerHTML = img(data.avatar, data.name); }
    else { headerAvatar.removeAttribute('src'); sideAvatar.textContent = '🎮'; }
  }

  function filteredGames(statusFilter = 'All statuses', collection = activeCollection) {
    const q = searchTerm.trim().toLowerCase();
    return (data?.games || []).filter((game) => {
      if (statusFilter !== 'All statuses' && game.status !== statusFilter) return false;
      if (collection && !game.collections.includes(collection)) return false;
      if (q && !`${game.title} ${game.platform} ${game.source} ${game.status} ${game.collections.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function collectionCategory(game) {
    const source = String(game.source || '').toLowerCase();
    const path = String(game.path || '').toLowerCase();
    const platform = String(game.platform || '').toLowerCase();
    const emulator = String(game.emulator_id || '').toLowerCase();
    const combined = `${source} ${platform} ${path}`;
    if (path.startsWith('steam://') || source.includes('steam')) return 'Steam';
    if (source.includes('gog') || combined.includes('gog galaxy')) return 'GOG Galaxy';
    if (source.includes('epic')) return 'Epic Games';
    if (source.includes('ubisoft')) return 'Ubisoft Connect';
    if (source.includes('ea app') || source === 'ea') return 'EA app';
    if (source.includes('xbox')) return 'Xbox';
    if (emulator === 'pcsx2' || /\b(?:ps2|playstation[\s_-]*2)\b/i.test(combined) || platform.includes('playstation 2')) return 'PS2';
    if (emulator === 'duckstation' || /\b(?:ps1|playstation)\b/i.test(`${source} ${platform}`)) return 'PlayStation';
    if (emulator === 'dolphin' || /gamecube|\bwii\b/i.test(`${source} ${platform}`)) return 'GameCube / Wii';
    return String(game.platform || game.source || (game.isRom ? 'ROM' : 'Other')).trim() || 'Other';
  }

  function gameCard(game) {
    return `<article class="game-card" data-key="${esc(game.key)}"><div class="game-art">${game.art ? img(game.art, game.title) : '<span>🎮</span>'}</div><div class="game-card-copy"><b title="${esc(game.title)}">${esc(game.title)}</b><small>${esc(game.platform)} · ${esc(game.status)}</small></div><div class="card-actions"><button class="small-button" data-action="launch" data-key="${esc(game.key)}">▶ Play</button><button class="small-button" data-action="edit-game" data-key="${esc(game.key)}">Edit</button></div></article>`;
  }

  function renderDashboard() {
    const featured = data.featured;
    const collection = data.collection || [];
    const activity = [
      { icon:'◉', title:'YOUR LIBRARY', sub:`${fmt(data.stats.total)} games`, page:'library' },
      { icon:'🎲', title:'IN PROGRESS', sub:`${fmt(data.stats.playing)} playing`, page:'library', status:'Playing' },
      { icon:'▤', title:'BACKLOG', sub:`${fmt(data.stats.backlog)} to play`, page:'backlog' },
      { icon:'🏆', title:'COLLECTIONS', sub:`${fmt(data.stats.collections)} created`, page:'collections' },
    ];
    const achievements = data.achievements || [];
    const percent = data.achievementProgress;
    pageEl.innerHTML = `<section class="dashboard-grid">
      <article class="panel hero-card"><div class="hero-copy"><span class="tag">${featured?.status === 'Playing' ? 'NOW PLAYING' : 'YOUR NEXT ADVENTURE'}</span><h2>${featured ? esc(featured.title.split(/\s+/).slice(0,2).join(' ')) : 'GAME'}<span>${featured ? esc(featured.title.split(/\s+/).slice(2).join(' ') || 'ROULETTE') : 'ROULETTE'}</span></h2><p>${featured ? `${esc(featured.platform)} · ${esc(featured.status)}<br>Pick up where you left off.` : 'Build your library and let Game Roulette choose what to play.'}</p><div class="hero-actions">${featured ? `<button class="primary-button" data-action="launch" data-key="${esc(featured.key)}">▶ &nbsp; LAUNCH GAME</button><button class="secondary-button" data-action="edit-game" data-key="${esc(featured.key)}" title="Edit game">☆</button>` : `<button class="primary-button" data-page="library">ADD YOUR GAMES</button>`}</div></div><aside class="hero-progress"><small>LIBRARY OVERVIEW</small><strong>${featured ? esc(featured.status.toUpperCase()) : 'READY TO PLAY'}</strong><div class="progress-ring" style="background:radial-gradient(closest-side,#0d1020 85%,transparent 87%),conic-gradient(var(--accent) ${percent ?? 0}%,#222438 0)">${percent == null ? fmt(data.stats.total) : `${percent}%`}</div><span class="stat-row">${fmt(data.stats.total)} GAMES IN LIBRARY</span><span class="stat-row">${data.ra.connected ? `${fmt(data.stats.unlocks)} recent unlocks` : 'Local profile active'}</span></aside></article>
      <section class="panel collection-panel"><div class="section-heading"><div><h2>MY COLLECTION</h2><p>Games in your library</p></div><button class="text-action" data-page="library">VIEW ALL ›</button></div><div class="collection-list">${collection.length ? collection.map((game) => `<article class="collection-item" data-action="edit-game" data-key="${esc(game.key)}">${game.art ? img(game.art, game.title) : '<div class="cover cover-empty">🎮</div>'}<div class="collection-info"><b>${esc(game.title)}</b><small>${esc(game.platform)}</small><div class="progress-bar"><span style="width:${game.status === 'Completed' || game.status === '100% Completed' ? 100 : game.status === 'Playing' ? 56 : 18}%"></span></div></div><button aria-label="Edit game">⋮</button></article>`).join('') : empty('Your games will show here after you add them.')}</div></section>
      <section class="panel activity-panel"><div class="section-heading"><div><h2>YOUR GAMING ACTIVITY</h2><p>A snapshot of your collection</p></div><button class="text-action" data-page="library">VIEW LIBRARY ›</button></div><div class="activity-grid">${activity.map((item) => `<button type="button" class="activity-card" data-page="${item.page}" ${item.status ? `data-status="${esc(item.status)}"` : ''}><span class="badge">${item.icon}</span><b>${item.title}</b><small>${esc(item.sub)}</small><span class="activity-open">OPEN ›</span></button>`).join('')}</div></section>
      <section class="panel profile-panel"><div class="section-heading"><div><h2>PLAYER PROFILE</h2><p>${esc(data.theme)}</p></div><button class="text-action" data-action="edit-profile">EDIT ›</button></div><div class="profile-body"><div class="profile-ring">${data.avatar ? img(data.avatar, data.name) : '🎮'}</div><div class="profile-data"><h3>${esc(data.name)}</h3><small>${data.ra.connected ? `RetroAchievements · ${esc(data.ra.rank || 'Connected')}` : 'Game collector'}</small><div class="stats-row"><div class="stat-cell"><strong>${fmt(data.stats.total)}</strong><small>Games</small></div><div class="stat-cell"><strong>${fmt(data.stats.completed)}</strong><small>Completed</small></div><div class="stat-cell"><strong>${fmt(data.stats.unlocks)}</strong><small>Unlocks</small></div><div class="stat-cell"><strong>${esc(data.ra.points || '—')}</strong><small>RA Points</small></div></div></div></div><div class="mini-row">${featured?.art ? img(featured.art, featured.title).replace('<img ', '<img class="mini-cover" ') : '<div class="mini-cover cover-empty">🎮</div>'}<div><b>${featured ? esc(featured.title) : 'Start your collection'}</b><small>${featured ? esc(featured.status) : 'Your dashboard is ready'}</small></div>${featured ? `<button data-action="launch" data-key="${esc(featured.key)}">▶</button>` : ''}</div></section>
      <section class="panel download-panel"><img class="download-art" src="../game_roulette_icon.png" alt="Game Roulette icon"><div class="download-copy"><h3>LIBRARY SCANNER</h3><p>${(data.folders || []).length ? `${data.folders.length} folder${data.folders.length === 1 ? '' : 's'} ready to scan` : 'Add your ROM folders to find games on this PC.'}</p><div class="progress-bar"><span style="width:${data.stats.total ? '100' : '0'}%"></span></div><small>${fmt(data.stats.total)} games · ${fmt(data.stats.backlog)} in backlog</small></div><button class="primary-button" data-action="scan">${busy ? 'SCANNING…' : 'SCAN LIBRARY'}</button></section>
      <section class="panel recent-achievements"><div class="section-heading"><div><h2>RECENT ACHIEVEMENTS</h2><p>${data.ra.connected ? `RetroAchievements · ${esc(data.ra.username)}` : 'Connect RetroAchievements in Settings'}</p></div><button class="text-action" data-page="achievements">VIEW ALL ›</button></div><div class="achievement-strip">${achievements.length ? achievements.slice(0,5).map((item) => `<button type="button" class="achievement-mini" ${item.gameId ? `data-action="view-played-game-set" data-id="${esc(item.gameId)}"` : 'data-page="achievements"'}><span>✦</span><b>${esc(item.title)}</b><small>${esc(item.game || 'View achievements')} · +${esc(item.points)} XP</small></button>`).join('') : `<div class="empty-state">${data.ra.connected ? 'No recent unlocks were returned.' : 'Connect your account to see unlocks.'}</div>`}</div></section>
    </section>`;
    const heroCard = pageEl.querySelector('.hero-card');
    if (heroCard && featured?.art) heroCard.style.setProperty('--hero-art', `url("${String(featured.art).replaceAll('"', '%22')}")`);
  }

  function renderLibrary() {
    const statusSelect = `<select class="select-field" id="statusFilter"><option ${libraryStatusFilter === 'All statuses' ? 'selected' : ''}>All statuses</option>${data.statuses.map((item) => `<option ${item === libraryStatusFilter ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select>`;
    const collectionSelect = `<select class="select-field" id="collectionFilter"><option>All collections</option>${data.collections.map((item) => `<option ${item.name === activeCollection ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`;
    const steam = data.accounts?.steam || {};
    const steamShortcut = steam.connected && steam.hasApiKey ? '<button class="small-button" data-action="steam-sync">SYNC STEAM</button>' : `<button class="small-button" data-action="open-accounts-settings">${steam.connected ? 'ADD STEAM KEY' : 'CONNECT STEAM'}</button>`;
    const right = `${statusSelect}${collectionSelect}${steamShortcut}<button class="small-button" data-action="add-folder">＋ ADD FOLDER</button><button class="small-button" data-action="import-launchers">IMPORT</button><button class="primary-button" data-action="scan">SCAN GAMES</button>`;
    const games = filteredGames(libraryStatusFilter);
    pageEl.innerHTML = `${pageHeader('Game Library', `${fmt(data.stats.total)} games · ${activeCollection ? `Showing “${esc(activeCollection)}”` : 'Your local game collection'}`, right)}${games.length ? `<div class="game-grid">${games.map(gameCard).join('')}</div>` : empty(searchTerm ? 'No games match that search.' : 'No games yet. Add a game folder or import a backup to get started.')}`;
  }

  function renderRoulette() {
    const collectionOptions = ['All collections', ...(data.collections || []).map((item) => item.name)].map((name) => `<option>${esc(name)}</option>`).join('');
    pageEl.innerHTML = `${pageHeader('Game Roulette', 'Set the filters and spin for your next game.')}<div class="roulette-layout"><section class="panel wheel-panel"><div class="wheel" id="wheel"><div class="wheel-center"><span class="wheel-logo-disc"><img class="wheel-logo" src="../game_roulette_icon.png" alt="Game Roulette logo"></span><span>GAME ROULETTE</span></div></div><button class="primary-button" id="spinButton" style="margin-top:20px;padding-inline:30px">${busy ? 'SPINNING…' : 'SPIN THE WHEEL'}</button></section><section class="panel wheel-panel"><div class="roulette-filters"><label><span class="field-label">GAME STATUS</span><select class="select-field" id="rouletteStatus"><option>All statuses</option>${data.statuses.map((item) => `<option>${esc(item)}</option>`).join('')}</select></label><label><span class="field-label">COLLECTION</span><select class="select-field" id="rouletteCollection">${collectionOptions}</select></label><label style="grid-column:1/-1"><input id="excludeCompleted" type="checkbox" checked> <span class="field-label" style="display:inline">SKIP COMPLETED GAMES</span></label></div><div class="roulette-result" id="rouletteResult">${rouletteWinner ? `${cover(rouletteWinner)}<h3>${esc(rouletteWinner.title)}</h3><p class="muted">${esc(rouletteWinner.platform)} · ${esc(rouletteWinner.status)}</p><button class="primary-button" data-action="launch" data-key="${esc(rouletteWinner.key)}">▶ LAUNCH GAME</button>` : `<div style="padding:36px;text-align:center"><div style="font-size:36px;color:var(--accent)">🎲</div><h3>Your next game is waiting</h3><p class="muted">Spin to choose at random from your library.</p></div>`}</div></section></div>`;
  }

  function renderBacklog() {
    const games = filteredGames('Backlog');
    pageEl.innerHTML = `${pageHeader('Your Backlog', `${fmt(data.stats.backlog)} games waiting to be played.`, `<button class="small-button" data-action="export">EXPORT BACKUP</button>`)}<div class="game-grid">${games.map(gameCard).join('') || empty('Your backlog is clear. Add games to your library or change a game’s status.')}</div>`;
  }

  function renderCollections() {
    const counts = new Map();
    for (const game of data.games || []) {
      const category = collectionCategory(game);
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    const order = ['Steam', 'PS2', 'PlayStation', 'GameCube / Wii', 'GOG Galaxy', 'Epic Games', 'Ubisoft Connect', 'EA app', 'Xbox'];
    const categories = [...new Set(['Steam', 'PS2', ...counts.keys()])].sort((a, b) => {
      const ai = order.indexOf(a); const bi = order.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
    });
    if (collectionPlatformFilter !== 'All games' && !categories.includes(collectionPlatformFilter)) collectionPlatformFilter = 'All games';
    const filters = [['All games', data.games.length], ...categories.map((category) => [category, counts.get(category) || 0])];
    const filterButtons = filters.map(([category, count]) => `<button type="button" class="collection-platform-chip ${collectionPlatformFilter === category ? 'selected' : ''}" data-action="filter-collection-platform" data-filter="${esc(category)}"><span>${esc(category)}</span><small>${fmt(count)}</small></button>`).join('');
    const games = data.games.filter((game) => collectionPlatformFilter === 'All games' || collectionCategory(game) === collectionPlatformFilter);
    const tiles = data.collections.length ? `<div class="collection-tiles">${data.collections.map((item) => `<article class="collection-tile" data-action="open-collection" data-name="${esc(item.name)}"><strong>${esc(item.name)}</strong><small>${fmt(item.count)} game${item.count === 1 ? '' : 's'} · Click to browse</small></article>`).join('')}</div>` : '<div class="panel data-panel notice">You have no named collections yet. Open a game and add collection names to build custom lists.</div>';
    pageEl.innerHTML = `${pageHeader('Collections', 'Browse your named lists or filter games by launcher and platform.', `<button class="primary-button" data-action="new-collection">＋ NEW COLLECTION</button>`)}${tiles}<section class="panel platform-collections-panel"><div class="section-heading"><div><span class="eyebrow">QUICK FILTERS</span><h2>Platforms &amp; launchers</h2><p>Choose Steam, PS2, or another detected source to browse those games.</p></div><span class="achievement-count-tag">${fmt(data.games.length)} GAMES</span></div><div class="collection-platform-filters">${filterButtons}</div><div class="collection-filter-results"><div><b>${esc(collectionPlatformFilter)}</b><small>${fmt(games.length)} matching games</small></div></div>${games.length ? `<div class="game-grid">${games.map(gameCard).join('')}</div>` : empty('No games match this filter yet.')}</section>`;
  }

  function renderAchievements() {
    const recent = data.achievements || [];
    const records = data.ra.recentRecords || [];
    const connectBlock = data.ra.connected ? `<section class="panel data-panel connection-banner"><div><strong>Connected to RetroAchievements</strong><small>${esc(data.ra.username)} · ${esc(data.ra.rank || 'Profile linked')} · ${esc(data.ra.points || '0')} points</small></div><div class="toolbar"><button class="small-button" data-action="refresh-ra">REFRESH</button><button class="small-button" data-action="disconnect-ra">DISCONNECT</button></div></section>` : `<section class="panel data-panel"><h3 style="margin-top:0">Connect your account</h3><p class="muted" style="font-size:10px">Your RetroAchievements username and Web API key are stored locally. Your player display name remains separate.</p><form id="raConnectForm" class="toolbar"><input class="field" name="username" placeholder="RetroAchievements username" required><input class="field" name="apiKey" type="password" placeholder="Web API key" required><button class="primary-button">CONNECT</button></form></section>`;
    const remotePlayed = Array.isArray(data.ra.recentPlayed) ? data.ra.recentPlayed : [];
    const normalizeTitle = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const played = remotePlayed.map((item) => {
      const id = String(item.GameID || item.gameId || item.ID || item.id || '');
      const title = String(item.Title || item.GameTitle || item.title || 'Played game');
      const local = data.games.find((game) => (id && String(game.ra_game_id || '') === id) || normalizeTitle(game.title) === normalizeTitle(title));
      const icon = item.ImageIcon || item.imageIcon || '';
      const art = icon ? (String(icon).startsWith('http') ? icon : `https://media.retroachievements.org${String(icon).startsWith('/') ? '' : '/'}${icon}`) : (local?.art || '');
      const lastPlayed = item.LastPlayed || item.lastPlayed || item.MostRecentAwardedDate || 'Recently played';
      return { id, key: local?.key || '', title, platform: item.ConsoleName || item.Console || local?.platform || 'RetroAchievements', lastPlayed, art, earned: Number(item.NumAchieved ?? item.NumAwardedToUser ?? 0), total: Number(item.NumPossibleAchievements ?? item.NumAchievements ?? 0) };
    }).filter((item) => item.id || item.title);
    const localPlayed = data.games.filter((game) => Number(game.last_played) > 0).sort((a, b) => Number(b.last_played) - Number(a.last_played));
    for (const game of localPlayed) {
      const existing = played.find((item) => (game.ra_game_id && item.id === String(game.ra_game_id)) || normalizeTitle(item.title) === normalizeTitle(game.title));
      if (existing) { existing.key = game.key; existing.art = existing.art || game.art || ''; existing.platform = existing.platform || game.platform; }
      else played.push({ id: String(game.ra_game_id || ''), key: game.key, title: game.title, platform: game.platform, lastPlayed: new Date(Number(game.last_played)).toLocaleString(), art: game.art || '', earned: 0, total: 0 });
    }
    const playedRows = played.length ? played.map((item) => {
      const progress = item.total > 0 ? Math.round(Math.min(100, item.earned / item.total * 100)) : 0;
      const action = item.id ? `data-action="view-game-set" data-id="${esc(item.id)}"` : item.key ? `data-action="link-achievement-game" data-key="${esc(item.key)}"` : 'disabled';
      const actionLabel = item.id ? 'VIEW ACHIEVEMENTS ›' : item.key ? 'LINK ACHIEVEMENT SET ›' : 'NO SET LINKED';
      return `<button type="button" class="played-game-card" ${action}><span class="played-game-art">${item.art ? img(item.art, item.title) : '<span>🎮</span>'}</span><span class="played-game-info"><b>${esc(item.title)}</b><small>${esc(item.platform)} · ${esc(item.lastPlayed)}</small>${item.total ? `<span class="played-progress"><span style="width:${progress}%"></span></span><small>${fmt(item.earned)} / ${fmt(item.total)} earned</small>` : '<small>Open to see the achievement set and your unlocks</small>'}<strong>${actionLabel}</strong></span></button>`;
    }).join('') : empty(data.ra.connected ? 'No played games were returned yet. Refresh your RetroAchievements account to update the list.' : 'Connect RetroAchievements or launch a game from your library to build your played list.');
    const list = records.length ? records.slice(0,30).map((item) => {
      const gameId = item.GameID || item.gameId || item.ID || '';
      const card = `<img src="https://media.retroachievements.org/Badge/${esc(item.BadgeName || item.badgeName || '')}.png" alt="" onerror="this.style.opacity=.15"><span><b>${esc(item.Title || item.title || 'Achievement')}</b><small>${esc(item.GameTitle || item.gameTitle || '')} · ${esc(item.Points || item.points || 0)} points${item.Date || item.date ? ` · ${esc(item.Date || item.date)}` : ''}</small></span>`;
      return gameId ? `<button type="button" class="achievement-card achievement-unlock" data-action="view-game-set" data-id="${esc(gameId)}">${card}<strong>VIEW GAME ›</strong></button>` : `<article class="achievement-card">${card}</article>`;
    }).join('') : recent.map((item) => `<article class="achievement-card"><span class="side-avatar">✦</span><span><b>${esc(item.title)}</b><small>${esc(item.game)} · ${esc(item.points)} points</small></span></article>`).join('');
    pageEl.innerHTML = `${pageHeader('Achievements', 'Games you have played, their full sets, and the achievements you have earned.')}${connectBlock}${data.ra.error ? `<div class="inline-error">${esc(data.ra.error)}</div>` : ''}<div class="split"><section class="panel data-panel"><div class="section-heading"><div><h3 style="margin:0">Recent unlocks</h3><p>Click an unlock to open its game set</p></div><span class="tag">${fmt(recent.length)} RECENT</span></div><div class="achievements-grid">${list || empty(data.ra.connected ? 'No recent achievements were returned.' : 'Connect your account to load unlocks.')}</div></section><section class="panel data-panel"><div class="section-heading"><div><h3 style="margin:0">Games you have played</h3><p>${fmt(played.length)} games · Select one to view its full set</p></div></div><div class="played-game-list">${playedRows}</div><div class="played-search"><h3>Open a game set by ID</h3><p class="muted">You can also link a local game to its RetroAchievements ID in the game editor.</p><form id="raSetForm" class="toolbar"><input class="field" name="gameId" type="number" min="1" placeholder="RetroAchievements game ID"><button class="small-button">VIEW SET</button></form></div></section></div><div id="raSetResults" class="achievement-set-host"></div>${renderSteamAchievementSection()}`;
  }

  function renderSteamAchievementSection() {
    const games = (data.games || []).filter((game) => /^steam:\/\/rungameid\/\d+\/?$/i.test(String(game.path || '')));
    const selected = gameByKey(steamAchievementKey);
    const rows = games.map((game) => `<button type="button" class="steam-achievement-game ${game.key === steamAchievementKey ? 'selected' : ''}" data-action="view-steam-achievements" data-key="${esc(game.key)}">${game.art ? img(game.art, game.title) : '<span class="steam-achievement-game-empty">🎮</span>'}<span><b>${esc(game.title)}</b><small>STEAM GAME</small></span><span class="steam-game-chevron">›</span></button>`).join('');
    let detail = '<div class="steam-achievement-empty">Choose a Steam game to load its full achievement list.</div>';
    if (!games.length) detail = '<div class="steam-achievement-empty">Sync Steam or import Steam games to see their achievements here.</div>';
    else if (steamAchievementLoading) detail = `<div class="steam-achievement-empty"><span class="steam-achievement-loader"></span><b>Loading ${esc(selected?.title || 'Steam achievements')}…</b><small>Steam is returning the game’s achievement list.</small></div>`;
    else if (steamAchievementError) detail = `<div class="steam-achievement-empty steam-achievement-error"><b>Could not load this game’s achievements</b><small>${esc(steamAchievementError)}</small></div>`;
    else if (steamAchievementSet && steamAchievementSet.gameKey === steamAchievementKey) {
      const records = (steamAchievementSet.achievements || []).filter((item) => steamAchievementFilter === 'all' || (steamAchievementFilter === 'earned' ? item.unlocked : !item.unlocked));
      const filters = [['all','ALL'],['earned','EARNED'],['locked','LOCKED']].map(([value,label]) => `<button class="small-button ${steamAchievementFilter === value ? 'active-filter' : ''}" data-action="filter-steam-achievements" data-filter="${value}">${label}</button>`).join('');
      const achievementCards = records.map((item) => `<article class="steam-achievement-card ${item.unlocked ? 'unlocked' : 'locked'}"><span class="steam-achievement-icon">${item.icon ? `<img src="${esc(item.icon)}" alt="">` : '🏆'}</span><span class="steam-achievement-copy"><b>${esc(item.title)}</b><small>${esc(item.description || (item.hidden ? 'Hidden until unlocked.' : item.apiName))}</small><strong>${item.unlocked ? `EARNED${item.unlockTime ? ` · ${esc(new Date(item.unlockTime).toLocaleDateString())}` : ''}` : 'LOCKED'}</strong></span></article>`).join('');
      detail = `<div class="steam-achievement-results"><div class="steam-achievement-summary"><div><h3>${esc(steamAchievementSet.title)}</h3><p>${fmt(steamAchievementSet.earned)} of ${fmt(steamAchievementSet.total)} earned · ${fmt(steamAchievementSet.percent)}%</p><div class="progress-bar"><span style="width:${steamAchievementSet.percent}%"></span></div></div><div class="toolbar steam-achievement-filters">${filters}</div></div>${achievementCards ? `<div class="steam-achievement-grid">${achievementCards}</div>` : '<div class="steam-achievement-empty">No achievements match this filter.</div>'}</div>`;
    }
    const connection = data.accounts?.steam || {};
    return `<section class="panel steam-achievements-panel" id="steamAchievementsPanel"><div class="section-heading"><div><span class="eyebrow">STEAM ACCOUNT</span><h2>Steam achievements</h2><p>Browse achievements and unlocks for your Steam library games.</p></div><span class="achievement-count-tag">${fmt(games.length)} GAMES</span></div>${connection.connected && connection.hasApiKey ? '' : '<div class="notice steam-achievement-notice">Connect Steam and save your Web API key in Connected Accounts. Steam must also allow access to your game details.</div>'}<div class="steam-achievements-layout"><div class="steam-achievement-game-list">${rows || '<div class="steam-achievement-empty">No Steam games in your library yet.</div>'}</div><div class="steam-achievement-detail">${detail}</div></div></section>`;
  }

  function renderBigPicture() {
    const filters = ['All statuses', ...(data.statuses || [])];
    const games = (data.games || []).filter((game) => bigPictureStatusFilter === 'All statuses' || game.status === bigPictureStatusFilter);
    const selected = games.find((game) => game.key === bigPictureSelectedKey) || games.find((game) => game.status === 'Playing') || games[0] || null;
    bigPictureSelectedKey = selected?.key || '';
    const filterButtons = filters.map((filter, index) => `<button class="bp-filter ${filter === bigPictureStatusFilter ? 'selected' : ''}" data-action="bp-filter" data-filter="${esc(filter)}">${index === 0 ? 'ALL GAMES' : esc(filter.toUpperCase())}</button>`).join('');
    const cards = games.map((game, index) => `<button type="button" class="bp-game-card ${game.key === bigPictureSelectedKey ? 'selected' : ''}" data-action="launch" data-key="${esc(game.key)}" data-bp-index="${index}" aria-label="Play ${esc(game.title)}"><span class="bp-game-art">${game.art ? img(game.art, game.title) : '<span>🎮</span>'}</span><span class="bp-game-copy"><b>${esc(game.title)}</b><small>${esc(game.status)} · ${esc(game.platform)}</small></span></button>`).join('');
    pageEl.innerHTML = `<section class="big-picture-screen"><header class="bp-header"><div class="bp-brand"><img src="../game_roulette_icon.png" alt=""><span>GAME ROULETTE<small>BIG PICTURE MODE</small></span></div><div class="bp-header-hint">USE A CONTROLLER OR ARROW KEYS <span>·</span> ENTER TO PLAY</div><button class="bp-exit" data-action="exit-big-picture">EXIT BIG PICTURE <kbd>ESC</kbd></button></header><section class="bp-hero" id="bigPictureHero"><div class="bp-hero-copy"><span class="bp-eyebrow" id="bpEyebrow">${selected ? esc(selected.status.toUpperCase()) : 'YOUR LIBRARY'}</span><h1 id="bpFeatureTitle">${selected ? esc(selected.title) : 'Your games are waiting'}</h1><p id="bpFeatureMeta">${selected ? `${esc(selected.platform)} · ${fmt(data.stats.total)} games in your library` : 'Add games from your library to start playing.'}</p><div class="bp-hero-actions"><button class="bp-play-button" id="bpLaunchFeatured" data-action="launch" data-key="${esc(selected?.key || '')}" ${selected ? '' : 'disabled'}>▶ &nbsp; PLAY NOW</button><button class="bp-random-button" data-action="bp-random" ${games.length ? '' : 'disabled'}>↻ &nbsp; SURPRISE ME</button></div></div><div class="bp-hero-count"><strong>${fmt(games.length)}</strong><span>${games.length === 1 ? 'GAME READY' : 'GAMES READY'}</span><small>${esc(data.name || 'Player')}’s library</small></div></section><section class="bp-library-section"><div class="bp-section-heading"><div><span class="bp-eyebrow">YOUR COLLECTION</span><h2>Choose a game</h2></div><div class="bp-filters">${filterButtons}</div></div><div class="bp-library-grid" id="bigPictureGrid">${cards || '<div class="bp-no-games">No games match this filter.</div>'}</div></section><footer class="bp-footer"><span>← → ↑ ↓ &nbsp; BROWSE</span><span>ENTER &nbsp; PLAY</span><span>ESC / B &nbsp; EXIT</span><span class="bp-player-label">${esc(data.name || 'Player')} · GAME ROULETTE 2.0</span></footer></section>`;
    const hero = pageEl.querySelector('#bigPictureHero');
    if (hero && selected?.art) hero.style.setProperty('--bp-art', `url("${String(selected.art).replaceAll('"', '%22')}")`);
    else hero?.style.setProperty('--bp-art', 'none');
  }

  function selectBigPictureGame(key) {
    const game = gameByKey(key);
    if (!game) return;
    bigPictureSelectedKey = game.key;
    pageEl.querySelectorAll('.bp-game-card').forEach((card) => card.classList.toggle('selected', card.dataset.key === game.key));
    const hero = pageEl.querySelector('#bigPictureHero');
    if (hero) hero.style.setProperty('--bp-art', game.art ? `url("${String(game.art).replaceAll('"', '%22')}")` : 'none');
    const title = pageEl.querySelector('#bpFeatureTitle');
    const meta = pageEl.querySelector('#bpFeatureMeta');
    const eyebrow = pageEl.querySelector('#bpEyebrow');
    const launch = pageEl.querySelector('#bpLaunchFeatured');
    if (title) title.textContent = game.title;
    if (meta) meta.textContent = `${game.platform} · ${fmt(data.stats.total)} games in your library`;
    if (eyebrow) eyebrow.textContent = game.status.toUpperCase();
    if (launch) { launch.dataset.key = game.key; launch.disabled = false; }
  }

  function moveBigPictureFocus(direction) {
    const cards = [...pageEl.querySelectorAll('.bp-game-card')];
    if (!cards.length) { pageEl.querySelector('.bp-exit')?.focus(); return; }
    const grid = pageEl.querySelector('#bigPictureGrid');
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    const currentIndex = cards.indexOf(document.activeElement);
    let targetIndex = currentIndex < 0 ? cards.findIndex((card) => card.dataset.key === bigPictureSelectedKey) : currentIndex;
    if (targetIndex < 0) targetIndex = 0;
    if (direction === 'left') targetIndex = Math.max(0, targetIndex - 1);
    else if (direction === 'right') targetIndex = Math.min(cards.length - 1, targetIndex + 1);
    else if (direction === 'up') targetIndex = Math.max(0, targetIndex - columns);
    else if (direction === 'down') targetIndex = Math.min(cards.length - 1, targetIndex + columns);
    cards[targetIndex]?.focus();
  }

  function startBigPictureGamepad() {
    clearInterval(gamepadTimer);
    gamepadTimer = setInterval(() => {
      if (!bigPictureActive || !navigator.getGamepads) return;
      const pad = [...navigator.getGamepads()].find(Boolean);
      if (!pad) return;
      const axisX = Number(pad.axes?.[0] || 0);
      const axisY = Number(pad.axes?.[1] || 0);
      const buttonDown = (index) => Boolean(pad.buttons?.[index]?.pressed);
      const direction = buttonDown(14) || axisX < -0.55 ? 'left' : buttonDown(15) || axisX > 0.55 ? 'right' : buttonDown(12) || axisY < -0.55 ? 'up' : buttonDown(13) || axisY > 0.55 ? 'down' : '';
      if (direction && Date.now() >= gamepadNavRepeatAt) { moveBigPictureFocus(direction); gamepadNavRepeatAt = Date.now() + 240; }
      const actionDown = buttonDown(0);
      if (actionDown && !gamepadActionWasDown) document.activeElement?.click();
      gamepadActionWasDown = actionDown;
      const backDown = buttonDown(1);
      if (backDown && !gamepadBackWasDown) void exitBigPicture();
      gamepadBackWasDown = backDown;
    }, 100);
  }

  async function enterBigPicture() {
    if (bigPictureActive) return;
    bigPicturePreviousPage = currentPage === 'big-picture' ? 'dashboard' : currentPage;
    bigPictureActive = true;
    document.body.classList.add('big-picture-mode');
    currentPage = 'big-picture';
    renderPage();
    try { await api.setBigPictureMode(true); }
    catch (error) { toast(`Could not enter fullscreen: ${error.message}`); }
    startBigPictureGamepad();
    requestAnimationFrame(() => (pageEl.querySelector(`[data-key="${CSS.escape(bigPictureSelectedKey)}"].bp-game-card`) || pageEl.querySelector('.bp-exit'))?.focus());
  }

  async function exitBigPicture() {
    if (!bigPictureActive) return;
    bigPictureActive = false;
    clearInterval(gamepadTimer);
    gamepadTimer = null;
    gamepadActionWasDown = false;
    gamepadBackWasDown = false;
    document.body.classList.remove('big-picture-mode');
    try { await api.setBigPictureMode(false); } catch {}
    currentPage = bigPicturePreviousPage;
    renderPage();
  }

  function renderSettings() {
    const emulatorHelpOpen = pageEl.querySelector('.emulator-help')?.open || false;
    const themeGuideOpen = pageEl.querySelector('.theme-guide')?.open || false;
    const overlay = data.overlay || {};
    const selectedTheme = data.theme;
    const builtInThemes = data.themes.filter((theme) => !theme.custom);
    const customThemes = data.themes.filter((theme) => theme.custom);
    const themeOptions = `<optgroup label="SIX GAME THEMES">${builtInThemes.map((theme) => `<option ${theme.name === selectedTheme ? 'selected' : ''}>${esc(theme.name)}</option>`).join('')}</optgroup>${customThemes.length ? `<optgroup label="YOUR THEMES">${customThemes.map((theme) => `<option ${theme.name === selectedTheme ? 'selected' : ''}>${esc(theme.name)}</option>`).join('')}</optgroup>` : ''}`;
    const emulators = data.settings.emulators || [];
    const romCount = (data.games || []).filter((game) => game.isRom).length;
    const pcsx2CacheName = String(data.settings.pcsx2_cache_path || '').split(/[\\/]/).pop();
    const folders = (data.folders || []).map((folder) => {
      const selected = data.settings.rom_folder_emulators?.[folder] || '';
      return `<div class="rom-folder-row"><span title="${esc(folder)}">${esc(folder)}</span><select class="select-field folder-emulator-select" data-folder="${esc(folder)}" aria-label="Default emulator for ${esc(folder)}"><option value="" ${selected ? '' : 'selected'}>Per-game choice</option>${emulators.map((item) => `<option value="${esc(item.id)}" ${selected === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>`;
    }).join('') || '<div class="muted">No scan folders selected.</div>';
    const emulatorCards = (data.emulatorCatalog || []).map((item) => {
      const configured = item.configured;
      const executableName = String(item.executablePath || '').split(/[\\/]/).pop();
      return `<article class="emulator-card"><div class="emulator-card-heading"><span class="emulator-mark">${esc(item.name.slice(0, 1))}</span><div><b>${esc(item.name)}</b><small>${esc(item.platform)}</small></div></div><p title="${esc(item.executablePath || '')}">${configured ? esc(executableName || 'Ready') : 'Choose the emulator app on this PC'}</p><small class="emulator-assigned">${fmt(item.assignedGames || 0)} games assigned</small><div class="toolbar"><button class="small-button" data-action="configure-emulator" data-emulator-id="${esc(item.id)}">${configured ? 'CHANGE APP' : 'SET UP'}</button>${item.custom ? `<button class="small-button danger-button" data-action="remove-emulator" data-emulator-id="${esc(item.id)}">REMOVE</button>` : ''}</div></article>`;
    }).join('');
    pageEl.innerHTML = `${pageHeader('Settings', 'Customize your player, accounts, appearance, and library.')}<div class="settings-grid">${renderAccountSettingsSection()}
      <section class="panel settings-card"><h3>PLAYER PROFILE</h3><div class="settings-row"><label for="profileName">Display name</label><input class="field" id="profileName" maxlength="48" value="${esc(data.name)}"></div><div class="settings-row"><label>Profile picture</label><div class="toolbar"><button class="small-button" data-action="choose-avatar">CHANGE PICTURE</button><button class="small-button" data-action="save-profile">SAVE NAME</button></div></div><div class="notice">Your player name and picture are separate from your RetroAchievements account.</div></section>
      <section class="panel settings-card"><h3>APPEARANCE</h3><div class="theme-art-preview">${data.wallpaper ? `<img src="${esc(data.wallpaper)}" alt="${esc(selectedTheme)} wallpaper preview">` : ''}<span>ACTIVE THEME ART · ${esc(selectedTheme)}</span></div><div class="settings-row"><label for="themeSelect">Gaming theme</label><select class="select-field" id="themeSelect">${themeOptions}</select></div><div class="settings-row"><label for="accent">Custom accent</label><input type="color" id="accent" value="${esc(data.accent)}"></div><div class="settings-row"><label for="glow">Accent glow</label><input type="range" id="glow" min="0" max="10" value="${esc(data.settings.glow_strength || 3)}"></div><div class="settings-row"><label for="opacity">Panel opacity</label><input type="range" id="opacity" min="55" max="100" value="${esc(data.settings.theme_panel_opacity || 98)}"></div><div class="settings-row"><label for="dim">Wallpaper dimming</label><input type="range" id="dim" min="0" max="80" value="${esc(data.dim)}"></div><div class="settings-row reactive-setting"><label for="reactiveTheme"><b>Reactive lighting</b><small>Accents follow your pointer and glow as you move around the app.</small></label><input type="checkbox" id="reactiveTheme" ${data.settings.reactive_theme !== false ? 'checked' : ''}></div><div class="settings-row"><label>Wallpaper image</label><button class="small-button" data-action="wallpaper">CHOOSE WALLPAPER</button></div><div class="theme-workshop"><div class="theme-workshop-heading"><b>THEME WORKSHOP</b><small>Build a look, save it, and share it with other players.</small></div><label class="field-label" for="customThemeName">Theme name</label><input class="field theme-name-field" id="customThemeName" maxlength="32" placeholder="e.g. My Neon Arcade" value="${data.customTheme ? esc(data.theme.replace(/^Custom:\s*/i, '')) : ''}"><div class="toolbar theme-actions"><button class="small-button" data-action="save-custom-theme">${data.customTheme ? 'UPDATE THEME' : 'SAVE CUSTOM THEME'}</button><button class="small-button" data-action="export-theme">EXPORT</button><button class="small-button" data-action="import-theme">IMPORT</button><button class="small-button danger-button" data-action="delete-custom-theme" ${data.customTheme ? '' : 'disabled'}>DELETE</button></div><details class="theme-guide" ${themeGuideOpen ? 'open' : ''}><summary>HOW TO CREATE AND SHARE A THEME</summary><ol><li>Choose one of the six game themes as your starting point.</li><li>Pick an accent colour, then adjust glow, panel opacity, and wallpaper dimming.</li><li>Choose a wallpaper image from your PC and switch Reactive lighting on or off.</li><li>Enter a name and choose <b>Save Custom Theme</b>. Your named theme is saved on this PC and selected right away.</li><li>Choose <b>Export</b> to make a shareable theme package with its wallpaper image, or <b>Import</b> to load one from another player.</li></ol><p>Each theme package contains its image and display settings. Wallpapers you choose stay inside your own theme.</p></details></div></section>
      <section class="panel settings-card"><h3>LIBRARY MANAGEMENT</h3><div class="settings-row"><label>ROM folders</label><button class="small-button" data-action="add-folder">ADD FOLDER</button></div><div class="folder-list">${folders}</div><div class="toolbar" style="margin-top:10px"><button class="primary-button" data-action="scan">SCAN LIBRARY</button><button class="small-button" data-action="import-launchers">IMPORT LAUNCHER GAMES</button></div><div class="settings-row"><label>Local game covers</label><button class="small-button" data-action="choose-covers">CHOOSE COVER FOLDER</button><button class="small-button" data-action="download-covers">FIND MISSING ART</button></div><div class="cover-cache-row"><div><b>PS2 cover matching</b><small>Uses PCSX2 game serials to find the original 3D covers.</small></div><div class="toolbar"><button class="small-button" data-action="choose-pcsx2-cache">LINK CACHE</button><button class="small-button" data-action="auto-pcsx2-cache">AUTO FIND</button></div><small class="muted cover-cache-status">${pcsx2CacheName ? `Linked: ${esc(pcsx2CacheName)}` : 'Using automatic PCSX2 cache search; your earlier cover cache is included.'}</small></div><div class="rom-reset-row"><div><b>ROM library</b><small>${fmt(romCount)} ROM game${romCount === 1 ? '' : 's'} saved. Clear entries and saved details to scan your folders fresh. Files and cover artwork stay on your PC.</small></div><button class="small-button danger-button" data-action="clear-rom-library" ${romCount ? '' : 'disabled'}>CLEAR ROM ENTRIES</button></div><div class="settings-row"><label>Library backups</label><div class="toolbar"><button class="small-button" data-action="export">EXPORT</button><button class="small-button" data-action="import-backup">RESTORE</button></div></div><div class="settings-row"><label>Local data folder</label><button class="small-button" data-action="reveal-data">OPEN FOLDER</button></div></section>
      <section class="panel settings-card emulator-settings"><h3>EMULATOR SETUP</h3><p class="muted emulator-intro">Choose an emulator app once. Link a ROM folder for automatic assignment, or select one in a game’s Edit screen. Emulator apps and BIOS files are installed separately.</p><div class="emulator-grid">${emulatorCards}</div><div class="toolbar emulator-add-row"><button class="small-button" data-action="add-custom-emulator">＋ ADD ANOTHER EMULATOR</button></div><details class="emulator-help" ${emulatorHelpOpen ? 'open' : ''}><summary>HOW TO SET IT UP</summary><ol><li>Choose <b>Set up</b> and browse to the emulator’s application file.</li><li>Add your ROM folder here, then choose its default emulator in the folder list above.</li><li>Scan the library. You can change an individual game’s emulator from <b>Edit Game</b>.</li><li>Use <b>Add another emulator</b> for other emulators. Its launch options can use <code>{rom}</code> for the game file.</li></ol><p>Game Roulette launches the emulator you installed. It does not include emulator software, game files, or BIOS.</p></details></section>
      <section class="panel settings-card"><h3>OBS ACHIEVEMENT BAR</h3><div class="notice">Local browser source only. Game Roulette does not connect to Twitch or another streaming service.</div><div class="settings-row"><label for="overlayEnabled">Enable local source</label><input type="checkbox" id="overlayEnabled" ${overlay.enabled ? 'checked' : ''}></div><div class="settings-row"><label for="overlayHeight">Bar height</label><input type="range" id="overlayHeight" min="72" max="240" value="${esc(overlay.height || 112)}"></div><div class="settings-row"><label for="overlayOpacity">Bar opacity</label><input type="range" id="overlayOpacity" min="20" max="100" value="${esc(overlay.opacity || 92)}"></div><div class="settings-row"><label>Show details</label><div class="toolbar"><label><input type="checkbox" id="overlayIcon" ${overlay.show_icon ? 'checked' : ''}> icon</label><label><input type="checkbox" id="overlayGame" ${overlay.show_game ? 'checked' : ''}> game</label><label><input type="checkbox" id="overlayPoints" ${overlay.show_points ? 'checked' : ''}> points</label></div></div><div class="settings-row"><label>Browser source URL</label><input class="field" id="overlayUrl" readonly value="${esc(data.overlayUrl || 'Starting local overlay…')}"></div><div class="toolbar"><button class="small-button" data-action="copy-overlay">COPY SOURCE URL</button></div></section>
    </div>`;
  }

  function renderAccountSettingsSection() {
    const steam = data.accounts?.steam || {};
    const connected = Boolean(steam.connected);
    const hasKey = Boolean(steam.hasApiKey);
    const steamStatus = connected ? 'ACCOUNT CONNECTED' : 'NOT CONNECTED';
    const otherLaunchers = [
      ['GOG Galaxy', 'Direct account linking is not available yet. Game Roulette can scan for GOG game shortcuts installed on this PC.'],
      ['Epic Games', 'Account linking is not available yet. Locally installed Epic games can be imported.'],
      ['Xbox', 'Account linking is not available yet. Locally installed Xbox games can be imported.'],
      ['Ubisoft Connect', 'Account linking is not available yet. Locally installed games can be imported.'],
      ['EA app', 'Account linking is not available yet. Locally installed games can be imported.'],
    ];
    const cards = otherLaunchers.map(([name, detail]) => `<article class="account-card account-card-limited"><div class="account-card-top"><span class="account-icon">${name === 'GOG Galaxy' ? 'G' : name === 'Epic Games' ? 'E' : name === 'Xbox' ? 'X' : name === 'EA app' ? 'EA' : 'U'}</span><span class="account-state limited">LOCAL IMPORT</span></div><h3>${esc(name)}</h3><p>${esc(detail)}</p></article>`).join('');
    return `<section id="connectedAccountsSettings" class="panel connected-accounts-settings"><div class="section-heading"><div><span class="eyebrow">ACCOUNT HUB</span><h2>Connected Accounts</h2><p>Manage Steam here and scan installed games from other launchers.</p></div><button class="small-button" data-action="import-launchers">IMPORT INSTALLED GAMES</button></div><div class="account-grid"><section class="panel account-card account-card-steam"><div class="account-card-top"><span class="account-icon steam-icon">S</span><span class="account-state ${connected ? 'connected' : 'limited'}">${steamStatus}</span></div><h3>Steam</h3><p>Connect securely in your browser, then sync games that Steam allows your account to share.</p>${connected ? `<div class="linked-account-row"><span>Steam ID</span><strong>${esc(steam.steamId)}</strong></div>` : ''}<div class="account-step"><b>${connected ? 'ACCOUNT LINK' : '1 · LINK YOUR ACCOUNT'}</b><button class="primary-button" data-action="steam-connect">${connected ? 'RECONNECT STEAM' : 'CONNECT STEAM'}</button></div><div class="account-step"><b>${hasKey ? '2 · API KEY SAVED ON THIS PC' : '2 · ADD YOUR STEAM API KEY'}</b><p class="muted">Steam requires a Web API key for library sync. It is encrypted on this PC.</p><div class="toolbar account-key-row"><input class="field" id="steamApiKey" type="password" autocomplete="off" maxlength="64" placeholder="Paste your 32-character key"><button class="small-button" data-action="steam-save-key">SAVE KEY</button></div><button class="text-link" data-action="steam-open-key-page">OPEN STEAM KEY PAGE ↗</button></div><div class="account-actions"><button class="primary-button" data-action="steam-sync" ${connected && hasKey ? '' : 'disabled'}>SYNC STEAM LIBRARY</button>${connected ? '<button class="small-button danger-button" data-action="steam-disconnect">DISCONNECT</button>' : ''}</div><small class="account-footnote">${fmt(steam.importedGames || 0)} Steam account game${Number(steam.importedGames || 0) === 1 ? '' : 's'} imported. Previously imported games stay in your library if you disconnect.</small></section><section class="panel account-card account-card-more"><div class="account-card-top"><span class="account-icon">＋</span><span class="account-state limited">MORE PLATFORMS</span></div><h3>Other launchers</h3><p>These platforms do not yet have a direct account connection in Game Roulette. You can still scan this PC for their installed games.</p><button class="small-button" data-action="import-launchers">SCAN INSTALLED LAUNCHERS</button></section></div><div class="account-grid account-grid-more">${cards}</div><div class="notice account-notice">Steam library sync requires a valid Steam Web API key and public game details. Steam controls what the app can read. You can also use <b>Import Installed Games</b> to scan local launcher files without linking any account.</div></section>`;
  }

  function renderPage() {
    if (!data) return;
    setTheme();
    document.querySelectorAll('.nav-link').forEach((buttonEl) => buttonEl.classList.toggle('active', buttonEl.dataset.page === currentPage || (currentPage === 'big-picture' && buttonEl.dataset.action === 'big-picture')));
    if (currentPage === 'dashboard') renderDashboard();
    else if (currentPage === 'library') renderLibrary();
    else if (currentPage === 'roulette') renderRoulette();
    else if (currentPage === 'backlog') renderBacklog();
    else if (currentPage === 'collections') renderCollections();
    else if (currentPage === 'achievements') renderAchievements();
    else if (currentPage === 'settings') renderSettings();
    else if (currentPage === 'big-picture') {
      renderBigPicture();
      const key = bigPictureFocusedKey || bigPictureSelectedKey;
      requestAnimationFrame(() => {
        const card = [...pageEl.querySelectorAll('.bp-game-card')].find((item) => item.dataset.key === key);
        (card || pageEl.querySelector('.bp-exit'))?.focus({ preventScroll: true });
      });
    }
  }

  function navigate(page, options = {}) {
    if (page === 'accounts') {
      currentPage = 'settings';
      renderPage();
      requestAnimationFrame(() => document.getElementById('connectedAccountsSettings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (!['dashboard','library','accounts','roulette','backlog','collections','achievements','settings'].includes(page)) return;
    if (page === 'library') {
      libraryStatusFilter = options.status ?? (currentPage === 'library' ? libraryStatusFilter : 'All statuses');
      activeCollection = options.collection ?? (currentPage === 'library' ? activeCollection : '');
    }
    currentPage = page; renderPage(); pageEl.scrollTop = 0;
  }

  function openGameEditor(game) {
    if (!game) return;
    const emulatorField = game.isRom ? `<label><span class="field-label">LAUNCH WITH</span><select class="select-field" name="emulator_id"><option value="" ${game.emulator_id ? '' : 'selected'}>No emulator selected</option>${(data.settings.emulators || []).map((item) => `<option value="${esc(item.id)}" ${game.emulator_id === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><small class="muted">${game.emulator_assignment === 'folder' ? 'Set automatically from this ROM folder. You can override it here.' : 'Choose the emulator that runs this game.'}</small>` : '';
    dialog.innerHTML = `<form method="dialog" class="modal-content" id="gameForm"><h2>${esc(game.title)}</h2><div class="modal-form"><input type="hidden" name="key" value="${esc(game.key)}"><label><span class="field-label">STATUS</span><select class="select-field" name="status">${data.statuses.map((item) => `<option ${item === game.status ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label><label><span class="field-label">RATING / 10</span><input class="field" type="number" name="rating" min="0" max="10" value="${esc(game.rating || 0)}"></label>${emulatorField}<label><span class="field-label">COLLECTIONS · SEPARATE WITH COMMAS</span><input class="field" name="collections" value="${esc(game.collections.join(', '))}" placeholder="Favorites, Co-op, PS2"></label><label><span class="field-label">COMPLETED DATE</span><input class="field" name="completed_date" type="date" value="${esc(game.completed_date || '')}"></label><label><span class="field-label">NOTES</span><textarea class="text-area" name="notes" rows="3">${esc(game.notes || '')}</textarea></label><label><span class="field-label">RETROACHIEVEMENTS GAME ID</span><input class="field" name="ra_game_id" type="number" min="1" value="${esc(game.ra_game_id || '')}" placeholder="Optional game set ID"></label><small class="muted">Removing a game only removes it from this library. The game file stays on your PC.</small></div><div class="modal-actions"><button type="button" class="small-button danger-button" data-action="remove-game" data-key="${esc(game.key)}">REMOVE FROM LIBRARY</button><button type="button" class="small-button" data-action="launch" data-key="${esc(game.key)}">▶ LAUNCH</button><button type="button" class="small-button" data-action="cancel-dialog">CANCEL</button><button class="primary-button" value="save">SAVE GAME</button></div></form>`;
    dialog.showModal();
  }

  function showCustomEmulatorDialog(name = '', args = '{rom}') {
    dialog.innerHTML = `<form method="dialog" class="modal-content" id="customEmulatorForm"><h2>Add another emulator</h2><p class="muted emulator-dialog-note">Game Roulette can start another Windows emulator too. It will pass the selected game file to the app you choose.</p><div class="modal-form"><label><span class="field-label">EMULATOR NAME</span><input class="field" name="name" maxlength="48" required value="${esc(name)}" placeholder="e.g. RetroArch or PPSSPP"></label><div class="settings-row custom-exe-row"><label>Emulator application</label><button type="button" class="small-button" data-action="choose-custom-emulator">${customEmulatorPath ? `CHOSEN · ${esc(customEmulatorPath.split(/[\\/]/).pop())}` : 'CHOOSE .EXE'}</button></div><label><span class="field-label">LAUNCH OPTIONS</span><input class="field" name="args" maxlength="240" value="${esc(args)}" placeholder="{rom}"></label><small class="muted">Use <code>{rom}</code> where the game file should go. If you leave it out, Game Roulette adds the game file at the end.</small></div><div class="modal-actions"><button type="button" class="small-button" data-action="cancel-dialog">CANCEL</button><button class="primary-button" value="add">SAVE EMULATOR</button></div></form>`;
    dialog.showModal();
  }

  function showSet(payload) {
    currentAchievementSet = payload;
    achievementFilter = 'all';
    renderAchievementSet();
  }

  function renderAchievementSet() {
    const target = document.getElementById('raSetResults'); if (!target || !currentAchievementSet) return;
    const payload = currentAchievementSet;
    const rawList = payload.Achievements || payload.achievements || [];
    const list = (Array.isArray(rawList) ? rawList : Object.values(rawList)).map((item) => {
      const earnedDate = item.DateEarnedHardcore || item.DateEarned || item.DateEarnedSoftcore || item.dateEarned || '';
      return { ...item, _earnedDate: earnedDate, _earned: Boolean(earnedDate || item.IsEarned || item.isEarned) };
    }).sort((a, b) => Number(b._earned) - Number(a._earned) || Number(a.DisplayOrder || 0) - Number(b.DisplayOrder || 0));
    const earnedCount = list.filter((item) => item._earned).length;
    const filtered = list.filter((item) => achievementFilter === 'all' || (achievementFilter === 'earned' ? item._earned : !item._earned));
    const rows = filtered.map((item) => {
      const badge = item.BadgeName || item.badgeName || '';
      const title = item.Title || item.title || 'Achievement';
      const description = item.Description || item.description || '';
      return `<article class="achievement-card ${item._earned ? 'earned' : 'locked'}">${badge ? `<img src="https://media.retroachievements.org/Badge/${esc(badge)}.png" alt="" onerror="this.style.opacity=.15">` : '<span class="achievement-badge-placeholder">✦</span>'}<span><b>${esc(title)}</b><small>${esc(description)}${description ? ' · ' : ''}${fmt(item.Points || item.points || 0)} points · ${item._earned ? `EARNED${item._earnedDate ? ` · ${esc(item._earnedDate)}` : ''}` : 'NOT YET EARNED'}</small></span></article>`;
    }).join('');
    target.innerHTML = `<section class="panel data-panel set-detail"><div class="section-heading"><div><h3 style="margin:0">${esc(payload.Title || payload.title || 'Achievement set')}</h3><p>${fmt(earnedCount)} of ${fmt(list.length)} achievements earned</p></div><label class="set-filter-label">SHOW <select class="select-field" id="achievementFilter"><option value="all" ${achievementFilter === 'all' ? 'selected' : ''}>All</option><option value="earned" ${achievementFilter === 'earned' ? 'selected' : ''}>Earned</option><option value="locked" ${achievementFilter === 'locked' ? 'selected' : ''}>Not earned</option></select></label></div><div class="achievements-grid">${rows || empty('No achievements match this filter.')}</div></section>`;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function runAction(action, key, el) {
    try {
      if (action === 'minimize') api.minimize();
      else if (action === 'maximize') api.toggleMaximize();
      else if (action === 'close') api.close();
      else if (action === 'big-picture') await enterBigPicture();
      else if (action === 'exit-big-picture') await exitBigPicture();
      else if (action === 'bp-filter') { bigPictureStatusFilter = el.dataset.filter || 'All statuses'; const filtered = (data.games || []).filter((game) => bigPictureStatusFilter === 'All statuses' || game.status === bigPictureStatusFilter); if (!filtered.some((game) => game.key === bigPictureSelectedKey)) bigPictureSelectedKey = filtered[0]?.key || ''; bigPictureFocusedKey = bigPictureSelectedKey; renderPage(); }
      else if (action === 'bp-random') { const games = (data.games || []).filter((game) => bigPictureStatusFilter === 'All statuses' || game.status === bigPictureStatusFilter); const choice = games[Math.floor(Math.random() * games.length)]; if (choice) { bigPictureSelectedKey = choice.key; bigPictureFocusedKey = choice.key; renderPage(); toast(`Roulette picked ${choice.title}.`); } }
      else if (action === 'open-accounts-settings') { navigate('settings'); requestAnimationFrame(() => document.getElementById('connectedAccountsSettings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
      else if (action === 'filter-collection-platform') { collectionPlatformFilter = el.dataset.filter || 'All games'; renderCollections(); }
      else if (action === 'edit-profile') navigate('settings');
      else if (action === 'launch') { const result = await api.launchGame(key); status('Game launched.'); toast(result.emulator ? `Launched in ${result.emulator}.` : 'Game launched.'); }
      else if (action === 'edit-game') openGameEditor(gameByKey(key));
      else if (action === 'remove-game') { const game = gameByKey(key); if (game && confirm(`Remove ${game.title} from your Game Roulette library? The game file on your PC will not be deleted.`)) { const removed = await api.removeGame(key); dialog.close(); toast(`${removed.title} removed from your library.`); renderPage(); } }
      else if (action === 'clear-rom-library') { const romCount = (data.games || []).filter((game) => game.isRom).length; if (!romCount) { toast('There are no ROM entries to clear.'); return; } if (confirm(`Clear all ${romCount} ROM entries and their saved progress, ratings, and notes? Your game files, cover artwork, ROM folders, emulator setup, and launcher games will stay untouched.`)) { const result = await api.clearRomGames(); toast(`${result.removed} ROM entr${result.removed === 1 ? 'y' : 'ies'} cleared. Scan your library when you are ready to add them again.`); renderPage(); } }
      else if (action === 'add-folder') { const result = await api.chooseFolder(); toast(`${result.folders.length} ROM folder${result.folders.length === 1 ? '' : 's'} selected.`); if (currentPage === 'settings') renderPage(); }
      else if (action === 'choose-covers') { const result = await api.chooseCoverFolder(); toast(`${result.folders.length} cover folder${result.folders.length === 1 ? '' : 's'} selected.`); if (currentPage === 'settings') renderPage(); }
      else if (action === 'choose-pcsx2-cache') { const result = await api.choosePcsx2Cache(); if (!result.canceled) toast(`PCSX2 cache linked: ${String(result.path).split(/[\\/]/).pop()}`); if (currentPage === 'settings') renderPage(); }
      else if (action === 'auto-pcsx2-cache') { await api.autoPcsx2Cache(); toast('Automatic PCSX2 cache search restored.'); if (currentPage === 'settings') renderPage(); }
      else if (action === 'download-covers') { busy = true; toast('Checking saved covers, PS2 serials, and online art…'); const result = await api.downloadCovers(); busy = false; toast(`Cover art found for ${result.downloaded} of ${result.checked} missing games.`); if (currentPage === 'settings') renderPage(); }
      else if (action === 'scan') { busy = true; renderPage(); const result = await api.scanFolders(); busy = false; status(`Scan complete · ${result.added} new games found.`); toast(`${result.added} new game${result.added === 1 ? '' : 's'} added.`); renderPage(); }
      else if (action === 'import-launchers') showLauncherDialog();
      else if (action === 'configure-emulator') { const result = await api.setupEmulatorPreset(el.dataset.emulatorId); if (result.configured) toast(`${result.name} is ready.`); renderPage(); }
      else if (action === 'remove-emulator') { const profile = (data.settings.emulators || []).find((item) => item.id === el.dataset.emulatorId); if (profile && confirm(`Remove ${profile.name} from Game Roulette? Its games will stay in your library.`)) { await api.removeEmulator(profile.id); toast(`${profile.name} removed.`); renderPage(); } }
      else if (action === 'add-custom-emulator') { customEmulatorPath = ''; showCustomEmulatorDialog(); }
      else if (action === 'choose-custom-emulator') { const name = document.querySelector('#customEmulatorForm [name="name"]')?.value || ''; const args = document.querySelector('#customEmulatorForm [name="args"]')?.value || '{rom}'; const chosen = await api.chooseEmulatorExecutable(); if (chosen) customEmulatorPath = chosen; showCustomEmulatorDialog(name, args); }
      else if (action === 'steam-connect') { busy = true; status('Opening Steam sign-in in your browser…'); await api.connectSteam(); busy = false; toast('Steam account connected.'); renderPage(); }
      else if (action === 'steam-save-key') { const field = document.getElementById('steamApiKey'); const key = field?.value || ''; await api.saveSteamApiKey(key); toast('Steam key saved securely on this PC.'); renderPage(); }
      else if (action === 'steam-sync') { busy = true; status('Syncing your Steam library…'); const result = await api.syncSteamLibrary(); busy = false; toast(`${result.added} new game${result.added === 1 ? '' : 's'} added from Steam. Missing Steam covers are downloading in the background.`); renderPage(); }
      else if (action === 'steam-disconnect') { if (confirm('Disconnect Steam from Game Roulette? Games already imported will stay in your library.')) { await api.disconnectSteam(); toast('Steam disconnected.'); renderPage(); } }
      else if (action === 'steam-open-key-page') { await api.openSteamApiKeyPage(); }
      else if (action === 'view-steam-achievements') {
        const request = ++steamAchievementRequest;
        steamAchievementKey = key || '';
        steamAchievementSet = null;
        steamAchievementError = '';
        steamAchievementLoading = true;
        renderPage();
        try {
          const result = await api.getSteamAchievements(steamAchievementKey);
          if (request !== steamAchievementRequest) return;
          steamAchievementSet = { ...result, gameKey: steamAchievementKey };
          steamAchievementFilter = 'all';
        } catch (error) {
          if (request !== steamAchievementRequest) return;
          steamAchievementError = error.message;
        } finally {
          if (request === steamAchievementRequest) { steamAchievementLoading = false; renderPage(); }
        }
      }
      else if (action === 'filter-steam-achievements') { steamAchievementFilter = el.dataset.filter || 'all'; renderPage(); }
      else if (action === 'export') { const result = await api.exportBackup(); if (!result.canceled) toast(`Backup exported · ${result.exported} games.`); }
      else if (action === 'import-backup') { const result = await api.importBackup(); if (!result.canceled) toast(`${result.added} new games restored.`); }
      else if (action === 'new-collection') { const name = prompt('Name this collection:'); if (name?.trim()) { activeCollection = name.trim(); navigate('library'); toast('Open a game and add it to your new collection.'); } }
      else if (action === 'open-collection') { navigate('library', { collection: el.dataset.name || '' }); }
      else if (action === 'choose-avatar') { await api.chooseAvatar(); toast('Profile picture saved.'); }
      else if (action === 'save-profile') { await api.saveProfile(document.getElementById('profileName').value); toast('Player profile saved.'); }
      else if (action === 'wallpaper') { await api.chooseWallpaper(); toast('Wallpaper updated.'); }
      else if (action === 'save-custom-theme') { const name = document.getElementById('customThemeName')?.value || ''; const saved = await api.saveCustomTheme({ name }); toast(`${saved} saved and applied.`); }
      else if (action === 'delete-custom-theme') { if (data.customTheme && confirm(`Delete ${data.theme}?`)) { await api.deleteCustomTheme(); toast('Custom theme deleted.'); } }
      else if (action === 'export-theme') { const result = await api.exportTheme(data.theme); if (!result.canceled) toast('Theme file exported.'); }
      else if (action === 'import-theme') { const result = await api.importTheme(); if (result.imported) toast(`${result.imported} imported and applied.`); }
      else if (action === 'reveal-data') { await api.revealDataFolder(); }
      else if (action === 'refresh-ra') { const result = await api.refreshRetroAchievements(); toast(`Refreshed · ${result.count} recent achievements.`); }
      else if (action === 'disconnect-ra') { await api.disconnectRetroAchievements(); toast('RetroAchievements disconnected.'); }
      else if (action === 'view-game-set') { const set = await api.getAchievementSet(el.dataset.id); showSet(set); }
      else if (action === 'view-played-game-set') { navigate('achievements'); const set = await api.getAchievementSet(el.dataset.id); showSet(set); }
      else if (action === 'link-achievement-game') { navigate('achievements'); openGameEditor(gameByKey(key)); setTimeout(() => dialog.querySelector('[name="ra_game_id"]')?.focus(), 0); }
      else if (action === 'copy-overlay') { const input = document.getElementById('overlayUrl'); input.select(); await navigator.clipboard.writeText(input.value); toast('OBS source URL copied.'); }
      else if (action === 'cancel-dialog') dialog.close();
    } catch (error) { busy = false; status(error.message); toast(error.message); renderPage(); }
  }

  function showLauncherDialog() {
    dialog.innerHTML = `<form method="dialog" class="modal-content" id="launcherForm"><h2>Import installed games</h2><p class="muted" style="font-size:10px">Choose launchers to scan on this PC. This finds installed games; it does not connect any account.</p><div class="modal-form"><label><input type="checkbox" name="source" value="Steam" checked> Steam</label><label><input type="checkbox" name="source" value="Epic Games" checked> Epic Games</label><label><input type="checkbox" name="source" value="GOG Galaxy"> GOG Galaxy</label><label><input type="checkbox" name="source" value="Ubisoft Connect"> Ubisoft Connect</label><label><input type="checkbox" name="source" value="EA app"> EA app</label><label><input type="checkbox" name="source" value="Xbox app"> Xbox app</label></div><div class="modal-actions"><button type="button" class="small-button" data-action="cancel-dialog">CANCEL</button><button class="primary-button" value="import">IMPORT SELECTED</button></div></form>`;
    dialog.showModal();
  }

  pageEl.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-page]'); if (nav) { navigate(nav.dataset.page, { status: nav.dataset.status }); return; }
    const actionEl = event.target.closest('[data-action]'); if (actionEl) runAction(actionEl.dataset.action, actionEl.dataset.key, actionEl);
  });
  document.getElementById('navigation').addEventListener('click', (event) => { const target = event.target.closest('[data-page], [data-action]'); if (!target) return; if (target.dataset.page) navigate(target.dataset.page); else if (target.dataset.action) runAction(target.dataset.action, target.dataset.key, target); });
  document.querySelector('.topbar').addEventListener('click', (event) => { const target = event.target.closest('[data-page]'); if (target) navigate(target.dataset.page); const actionEl = event.target.closest('[data-action]'); if (actionEl) runAction(actionEl.dataset.action); });
  document.querySelector('.titlebar').addEventListener('click', (event) => { const target = event.target.closest('[data-action]'); if (target) runAction(target.dataset.action); });

  pageEl.addEventListener('change', async (event) => {
    const id = event.target.id;
    try {
      if (event.target.matches('.folder-emulator-select')) { await api.setRomFolderEmulator(event.target.dataset.folder, event.target.value); toast(event.target.value ? 'Folder emulator saved. Scan this folder to apply it to its games.' : 'Folder emulator cleared.'); }
      if (id === 'statusFilter' || id === 'collectionFilter') { if (id === 'statusFilter') libraryStatusFilter = event.target.value; if (id === 'collectionFilter') activeCollection = event.target.value === 'All collections' ? '' : event.target.value; renderLibrary(); }
      if (id === 'themeSelect') { await api.setTheme(event.target.value); toast('Theme changed.'); }
      if (id === 'achievementFilter') { achievementFilter = event.target.value; renderAchievementSet(); }
      if (['accent','glow','opacity','dim','reactiveTheme','overlayEnabled','overlayHeight','overlayOpacity','overlayIcon','overlayGame','overlayPoints'].includes(id)) {
        const overlay = { enabled: document.getElementById('overlayEnabled')?.checked, height: Number(document.getElementById('overlayHeight')?.value), opacity: Number(document.getElementById('overlayOpacity')?.value), show_icon: document.getElementById('overlayIcon')?.checked, show_game: document.getElementById('overlayGame')?.checked, show_points: document.getElementById('overlayPoints')?.checked };
        await api.updateAppearance({ accent: document.getElementById('accent')?.value, glow_strength: Number(document.getElementById('glow')?.value), panel_opacity: Number(document.getElementById('opacity')?.value), wallpaper_dim: Number(document.getElementById('dim')?.value), reactive_theme: document.getElementById('reactiveTheme')?.checked, overlay });
      }
    } catch (error) { toast(error.message); }
  });
  dialog.addEventListener('submit', async (event) => {
    if (event.target.id === 'gameForm') {
      event.preventDefault(); const form = new FormData(event.target); const key = String(form.get('key'));
      const patch = { status: form.get('status'), rating: Number(form.get('rating')), collections: String(form.get('collections') || '').split(',').map((x) => x.trim()).filter(Boolean), completed_date: form.get('completed_date'), notes: form.get('notes'), ra_game_id: String(form.get('ra_game_id') || '') };
      if (event.target.querySelector('[name="emulator_id"]')) { patch.emulator_id = String(form.get('emulator_id') || ''); patch.emulator_assignment = 'manual'; }
      try { await api.updateGame(key, patch); dialog.close(); toast('Game details saved.'); } catch (error) { toast(error.message); }
    } else if (event.target.id === 'customEmulatorForm') {
      event.preventDefault(); const form = new FormData(event.target);
      try {
        if (!customEmulatorPath) throw new Error('Choose the emulator’s .exe file first.');
        const result = await api.addCustomEmulator({ name: form.get('name'), executablePath: customEmulatorPath, args: form.get('args') });
        dialog.close(); customEmulatorPath = ''; toast(`${result.name} is ready.`); renderPage();
      } catch (error) { toast(error.message); }
    } else if (event.target.id === 'raConnectForm') {
      event.preventDefault(); const form = new FormData(event.target);
      try { await api.connectRetroAchievements({ username: form.get('username'), apiKey: form.get('apiKey') }); toast('RetroAchievements connected.'); } catch (error) { toast(error.message); }
    } else if (event.target.id === 'raSetForm') {
      event.preventDefault(); const id = new FormData(event.target).get('gameId');
      try { showSet(await api.getAchievementSet(id)); } catch (error) { toast(error.message); }
    } else if (event.target.id === 'launcherForm') {
      event.preventDefault(); const sources = [...event.target.querySelectorAll('input[name=source]:checked')].map((input) => input.value);
      try { const result = await api.importLaunchers(sources); dialog.close(); toast(`Imported ${result.added} installed game${result.added === 1 ? '' : 's'}.`); } catch (error) { toast(error.message); }
    }
  });
  dialog.addEventListener('click', (event) => { const actionEl = event.target.closest('[data-action]'); if (actionEl) { event.preventDefault(); runAction(actionEl.dataset.action, actionEl.dataset.key, actionEl); } else if (event.target === dialog) dialog.close(); });
  document.getElementById('globalSearch').addEventListener('input', (event) => { searchTerm = event.target.value; if (currentPage !== 'library') navigate('library'); else renderLibrary(); });
  document.addEventListener('pointermove', (event) => {
    if (!document.body.classList.contains('reactive-theme')) return;
    const panel = event.target.closest?.('.panel'); if (!panel) return;
    const rect = panel.getBoundingClientRect();
    panel.style.setProperty('--spot-x', `${Math.max(0, Math.min(rect.width, event.clientX - rect.left))}px`);
    panel.style.setProperty('--spot-y', `${Math.max(0, Math.min(rect.height, event.clientY - rect.top))}px`);
  }, { passive: true });
  pageEl.addEventListener('focusin', (event) => {
    const card = event.target.closest?.('.bp-game-card');
    if (bigPictureActive && card) { bigPictureFocusedKey = card.dataset.key || ''; selectBigPictureGame(bigPictureFocusedKey); }
  });
  document.addEventListener('keydown', (event) => {
    if (bigPictureActive) {
      if (event.key === 'Escape' || event.key === 'Backspace') { event.preventDefault(); void exitBigPicture(); return; }
      if (event.key === 'F11') { event.preventDefault(); void exitBigPicture(); return; }
      const directions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      if (directions[event.key]) { event.preventDefault(); moveBigPictureFocus(directions[event.key]); return; }
      if (event.key === 'Enter') { const card = document.activeElement?.closest?.('.bp-game-card'); if (card) { event.preventDefault(); card.click(); } }
      return;
    }
    if (event.key === 'F11') { event.preventDefault(); void enterBigPicture(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('globalSearch').focus(); }
  });
  document.addEventListener('click', async (event) => {
    if (event.target.id === 'spinButton') {
      if (busy) return;
      busy = true; const wheel = document.getElementById('wheel'); wheel.classList.remove('spinning'); void wheel.offsetWidth; wheel.classList.add('spinning'); event.target.disabled = true; event.target.textContent = 'CHOOSING…';
      try { rouletteWinner = await api.spin({ status: document.getElementById('rouletteStatus').value, collection: document.getElementById('rouletteCollection').value, excludeCompleted: document.getElementById('excludeCompleted').checked }); }
      catch (error) { toast(error.message); }
      setTimeout(() => { busy = false; renderPage(); if (rouletteWinner) toast(`Roulette picked ${rouletteWinner.title}.`); }, 2200);
    }
  });

  api.onChanged((next) => { data = next; renderPage(); });
  api.getSnapshot().then((next) => { data = next; renderPage(); }).catch((error) => toast(error.message));
})();
