/** Isolated Chromium host for website QA; no privileged preload or app data. */
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: !process.argv.includes('--no-js') } });
  window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
