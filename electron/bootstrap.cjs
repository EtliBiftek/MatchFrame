const electron = require('electron');

electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: 'matchframe',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  },
  {
    scheme: 'matchframe-pov',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

let lastGpuRecovery = 0;
function reloadVisibleWindows(reason) {
  const now = Date.now();
  if (now - lastGpuRecovery < 5000) return;
  lastGpuRecovery = now;
  console.error(`[MatchFrame] renderer recovery: ${reason}`);
  setTimeout(() => {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try { win.webContents.reloadIgnoringCache(); } catch (_) {}
    }
  }, 800);
}

electron.app.on('child-process-gone', (_event, details) => {
  if (String(details?.type || '').toLowerCase() === 'gpu') reloadVisibleWindows(`GPU process gone (${details?.reason || 'unknown'})`);
});

electron.app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_goneEvent, details) => reloadVisibleWindows(`renderer gone (${details?.reason || 'unknown'})`));
});

electron.protocol.registerSchemesAsPrivileged = () => {};
require('./main.cjs');

// v6 fixes the map export pipeline: Source2Viewer writes GLB files into an output directory,
// and CS2 map VPKs must keep their maps/<map>/ dependency tree during export.
const povV6 = require('./pov-export-v6.cjs');
electron.app.whenReady().then(() => {
  povV6.installProtocol(electron.protocol);
  electron.ipcMain.removeHandler('pov:prepare');
  electron.ipcMain.handle('pov:prepare', async (_event, mapName) => povV6.prepare(mapName));
});
