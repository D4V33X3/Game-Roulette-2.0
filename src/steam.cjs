function list(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function steamAchievementIcon(icon, appId) {
  const value = String(icon || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (!/(?:^|\.)steamstatic\.com$/i.test(url.hostname) && !/(?:^|\.)steampowered\.com$/i.test(url.hostname)) return '';
    url.protocol = 'https:';
    return url.toString();
  } catch {
    if (/^[a-z0-9_.-]+\.(?:png|jpe?g|webp)$/i.test(value) && /^\d+$/.test(String(appId || ''))) {
      return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${encodeURIComponent(value)}`;
    }
    return '';
  }
}

function mergeSteamAchievements(appId, fallbackTitle, playerPayload, schemaPayload) {
  const player = playerPayload?.playerstats || {};
  if (!playerPayload?.playerstats || player.success === false) {
    throw new Error(String(player.error || 'Steam did not return achievement data for this game.'));
  }
  const schema = schemaPayload?.game || {};
  const schemaAchievements = list(schema.availableGameStats?.achievements);
  const playerAchievements = list(player.achievements);
  const byApiName = new Map(playerAchievements.map((item) => [String(item.apiname || '').toLowerCase(), item]));
  const records = schemaAchievements.length ? schemaAchievements : playerAchievements;
  const achievements = records.map((definition) => {
    const apiName = String(definition.name || definition.apiname || '');
    const progress = byApiName.get(apiName.toLowerCase()) || definition;
    const unlocked = Number(progress.achieved || 0) === 1;
    const hidden = Number(definition.hidden || 0) === 1;
    const unlockTime = Number(progress.unlocktime || 0);
    const image = unlocked ? definition.icon : (definition.icongray || definition.icon);
    return {
      apiName,
      title: hidden && !unlocked ? 'Hidden achievement' : String(definition.displayName || definition.name || apiName || 'Achievement'),
      description: hidden && !unlocked ? 'Unlock this achievement to reveal its details.' : String(definition.description || ''),
      unlocked,
      hidden: hidden && !unlocked,
      unlockTime: unlockTime > 0 ? new Date(unlockTime * 1000).toISOString() : '',
      icon: steamAchievementIcon(image, appId),
    };
  });
  const earned = achievements.filter((item) => item.unlocked).length;
  return {
    appId: String(appId),
    title: String(schema.gameName || player.gameName || fallbackTitle || 'Steam game'),
    achievements,
    earned,
    total: achievements.length,
    percent: achievements.length ? Math.round(earned / achievements.length * 100) : 0,
  };
}

module.exports = { steamAchievementIcon, mergeSteamAchievements };
