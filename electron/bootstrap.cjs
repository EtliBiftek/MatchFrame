const electron = require('electron');

// Electron 42+ blocks cross-origin XHR/fetch to custom schemes unless corsEnabled is explicit.
// Babylon's GLB loader uses XHR/fetch under the hood, so register MatchFrame assets as a
// standard, secure, fetchable, CORS-enabled streaming scheme before app.ready.
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
  }
]);

// main.cjs also contains the legacy registration. It must not register the scheme twice.
electron.protocol.registerSchemesAsPrivileged = () => {};
require('./main.cjs');
