const electron = require('electron');

// Register all custom asset schemes before app.ready so Chromium/Babylon can fetch GLBs.
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

// If Chromium's GPU process dies, the symptom is an entirely black Electron window rather
// than a Babylon-only black canvas. Recover the UI instead of leaving the user stuck there.
electron.app.on('child-process-gone', (_event, details) => {
  if (String(details?.type || '').toLowerCase() === 'gpu') {
    reloadVisibleWindows(`GPU process gone (${details?.reason || 'unknown'})`);
  }
});

electron.app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_goneEvent, details) => {
    reloadVisibleWindows(`renderer gone (${details?.reason || 'unknown'})`);
  });
});

// main.cjs contains the legacy matchframe registration. Avoid a duplicate registration.
electron.protocol.registerSchemesAsPrivileged = () => {};
require('./main.cjs');

// v4 keeps exact competitive-map selection from v3, but strips GPU-heavy map textures and
// converts material groups to lightweight colours before Babylon ever sees the GLB.
const povV4 = require('./pov-export-v3.cjs');
electron.app.whenReady().then(() => {
  povV4.installProtocol(electron.protocol);
  electron.ipcMain.removeHandler('pov:prepare');
  electron.ipcMain.handle('pov:prepare', async (_event, mapName) => povV4.prepare(mapName));
});
