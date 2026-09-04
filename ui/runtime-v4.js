(() => {
  function validPovState(state) {
    return Boolean(state && window.matchframePov?.isPlayerUsable?.(state));
  }

  function nearestUsablePlayerState(tick, player) {
    const frames = demo?.frames || [];
    if (!frames.length || !player) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Number(frames[mid].tick || 0) < tick) lo = mid + 1;
      else hi = mid;
    }
    for (let radius = 0; radius < Math.min(frames.length, 96); radius++) {
      for (const index of radius ? [lo - radius, lo + radius] : [lo]) {
        if (index < 0 || index >= frames.length) continue;
        const state = playerInFrame(frames[index], player);
        if (validPovState(state)) return state;
      }
    }
    return null;
  }

  updatePovCamera = function() {
    if (viewMode !== 'pov' || !window.matchframePov?.isReady()) return;
    const exact = window.matchframeExactState?.(selectedPlayer, currentTick) || null;
    let player = validPovState(exact) ? exact : null;
    if (!player) {
      const sampled = nearestFrame(currentTick);
      const sampledPlayer = playerInFrame(sampled, selectedPlayer);
      if (validPovState(sampledPlayer)) player = sampledPlayer;
    }
    if (!player) player = nearestUsablePlayerState(currentTick, selectedPlayer);
    if (player) window.matchframePov.setPlayer(player);
    updateSelectedHud(nearestFrame(currentTick));
  };
})();
