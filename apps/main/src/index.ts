import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron';
import { IPC } from '@rh/protocol';
import { registerBinariesHandlers, registerExecutionHandlers, registerIpcHandlers, registerPackageHandlers } from './ipc/router.js';
import { ExecutionManager } from './execution/execution-manager.js';
import { BinariesController } from './binaries/binaries-controller.js';
import { PackageService } from './packages/package-service.js';

const isDev = !app.isPackaged;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'RuntimeHell',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.on('did-finish-load', () => {
    // Boot marker asserted by QA evidence (todo 1).
    console.log('[boot] renderer loaded');
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadURL(pathToFileURL(join(__dirname, '../renderer/index.html')).toString());
  }

  return win;
}

function main(): void {
  // Single instance lock (full hardening lands in todo 31).
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  registerIpcHandlers((channel, handler) => {
    ipcMain.handle(channel, (_event, payload: unknown) => handler(payload));
  });

  // Execution events stream main → renderer over the run:event channel.
  const execution = new ExecutionManager({
    emit: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.runEvent, event);
      }
    }
  });
  registerExecutionHandlers((channel, handler) => {
    ipcMain.handle(channel, (_event, payload: unknown) => handler(payload));
  }, execution);

  // Runtimes panel (todo 12): list/install/remove with streamed progress.
  const binaries = new BinariesController({
    emitProgress: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.binariesProgress, event);
      }
    }
  });
  registerBinariesHandlers((channel, handler) => {
    ipcMain.handle(channel, (_event, payload: unknown) => handler(payload));
  }, binaries);

  // Packages panel (todo 13): npm ops scoped to the workspace.
  const packages = new PackageService({
    emit: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.packagesEvent, event);
      }
    }
  });
  registerPackageHandlers((channel, handler) => {
    ipcMain.handle(channel, (_event, payload: unknown) => handler(payload));
  }, packages);

  app.whenReady().then(() => {
    console.log('[boot] electron ready');
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

main();
