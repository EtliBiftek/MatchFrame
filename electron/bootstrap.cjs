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

// main.cjs contains the legacy matchframe registration. Avoid a duplicate registration.
electron.protocol.registerSchemesAsPrivileged = () => {};
require('./main.cjs');

// v3 fixes map-variant selection. The old exporter picked the largest GLB produced by VRF,
// which can select a Wingman/alternate map resource from the same VPK instead of de_inferno.
const povV3 = require('./pov-export-v3.cjs');
electron.app.whenReady().then(() => {
  povV3.installProtocol(electron.protocol);
  electron.ipcMain.removeHandler('pov:prepare');
  electron.ipcMain.handle('pov:prepare', async (_event, mapName) => povV3.prepare(mapName));
});
