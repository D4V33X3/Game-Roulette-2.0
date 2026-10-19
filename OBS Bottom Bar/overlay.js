(() => {
  const bar = document.getElementById('achievementBar');
  const icon = document.getElementById('achievementIcon');
  const title = document.getElementById('achievementTitle');
  const game = document.getElementById('gameTitle');
  const points = document.getElementById('achievementPoints');

  function applyState(state) {
    document.documentElement.style.setProperty('--accent', state.accent || '#a855f7');
    document.documentElement.style.setProperty('--bar-height', `${Math.max(72, Math.min(240, Number(state.height) || 112))}px`);
    document.documentElement.style.setProperty('--bar-opacity', String(Math.max(.2, Math.min(1, (Number(state.opacity) || 92) / 100))));
    icon.hidden = !state.show_icon;
    const event = state.event;
    if (!state.enabled || !event || Number(event.visible_until) * 1000 <= Date.now()) {
      bar.classList.remove('visible');
      return;
    }
    title.textContent = event.title || 'Achievement unlocked';
    game.textContent = state.show_game ? (event.game || 'RetroAchievements') : '';
    points.textContent = state.show_points && event.points ? `+${event.points} points` : '';
    bar.classList.add('visible');
  }

  async function refresh() {
    try {
      const response = await fetch('./state.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Overlay status unavailable');
      applyState(await response.json());
    } catch (_error) {
      bar.classList.remove('visible');
    }
  }

  refresh();
  window.setInterval(refresh, 700);
})();
