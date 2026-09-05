/*
 * Replay ekranı — mevcut replay akışını sarmalar.
 *
 * Bu dosya eski replay kodunu değiştirmez; yalnızca view konteynerine bağlar,
 * gizlendiğinde oynatmayı duraklatır ve yeniden gösterildiğinde yeniden çizer.
 */
(function (root) {
  'use strict';
  const ns = (root.MF = root.MF || {});

  let container = null;

  function bridge() {
    return root.MatchFrameBridge || null;
  }

  const replayView = {
    id: 'replay',
    label: 'Replay',
    mounted: false,

    mount(node) {
      container = node;
    },

    activate() {
      const api = bridge();
      if (!api) return;
      // Gizliyken canvas ölçüleri sıfırlanmış olabilir; görünür olunca yeniden çiz.
      api.redraw?.();
      api.resizePov?.();
    },

    deactivate() {
      // POV (Babylon) motoru analiz ekranlarında gereksiz yere çalışmasın.
      bridge()?.pause?.();
    },

    /*
     * Olaydan replay'e atlama: oyuncuyu seç, replay ekranına geç, tick'e git.
     */
    jumpTo(tick, options = {}) {
      const api = bridge();
      if (!api) return false;
      if (options.steamId) api.selectSteamId?.(options.steamId);
      if (ns.navigation.current() !== 'replay') ns.navigation.go('replay');
      api.seek?.(tick);
      api.redraw?.();
      api.log?.(`Replay: tick ${Math.round(Number(tick) || 0)}`, 'system');
      return true;
    }
  };

  ns.views.register(replayView);
  ns.replay = {
    jumpTo: replayView.jumpTo,
    getContainer: () => container
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
