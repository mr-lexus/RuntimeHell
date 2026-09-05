import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron';
import { IPC } from '@rh/protocol';
import { registerBinariesHandlers, registerExecutionHandlers, registerIpcHandlers, registerPackageHandlers, registerAnalysisHandlers, registerPersistenceHandlers, registerPerformanceHandlers } from './ipc/router.js';
import { appendHistory } from './workspace/history.js';
import { ExecutionManager } from './execution/execution-manager.js';
import { BinariesController } from './binaries/binaries-controller.js';
import { PackageService } from './packages/package-service.js';
import { EngineRegistry } from './engines/registry.js';
import { AnalysisManager } from './engines/analysis-manager.js';
import { EnginesController } from './engines/engines-controller.js';
import { V8EngineAdapterV0 } from './engines/v8-adapter.js';
import { SpiderMonkeyAdapter } from './engines/spidermonkey/sm-adapter.js';
import { JavaScriptCoreAdapter } from './engines/javascriptcore/jsc-adapter.js';
import { DenoBunRuntimeAdapter, NodeRuntimeAdapter, RuntimeRegistry } from './runtimes/runtime-adapter.js';
import { PerformanceManager, RegistryPerformanceTargetResolver } from './performance/performance-manager.js';

const isDev = !app.isPackaged;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    title: 'RuntimeHell',
    icon: join(__dirname, 'assets/icon.png'),
    backgroundColor: '#0a0f14',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
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

  // The renderer owns the compact titlebar, including window actions.
  ipcMain.handle(IPC.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return { ok: true };
  });
  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target) return { maximized: false };
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
    return { maximized: target.isMaximized() };
  });
  ipcMain.handle(IPC.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return { ok: true };
  });
  ipcMain.handle(IPC.windowState, (event) => ({ maximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false }));
  registerPersistenceHandlers((channel, handler) => {
    ipcMain.handle(channel, (_event, payload: unknown) => handler(payload));
  });

  // Persistence (todo 21): settings + workspaces + history.
  const execution = new ExecutionManager({
    emit: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.runEvent, event);
      }
    },
    recordRun: (record) => {
      void appendHistory(record.workspaceId, record).catch(() => {});
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

  // Analysis drawer (todo 19/23): registry + registered V8 adapter.
  const engines = new EngineRegistry();
  engines.registerAdapter(new V8EngineAdapterV0('v8', engines));
  engines.registerAdapter(new V8EngineAdapterV0('d8-debug', engines));
  engines.registerAdapter(new SpiderMonkeyAdapter(engines));
  const jscAdapter = new JavaScriptCoreAdapter(engines);
  engines.registerAdapter(jscAdapter);
  const analysis = new AnalysisManager({
    registry: engines,
    emit: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.analysisEvent, event);
      }
    }
  });
  const enginesController = new EnginesController({ registry: engines });
  const registrar = (channel: string, handler: (payload: unknown) => Promise<unknown>): void => {
    ipcMain.handle(channel, (_event, payload: unknown) => handler(payload));
  };
  registerAnalysisHandlers(registrar, analysis);
  const runtimes = new RuntimeRegistry({ adapters: [new NodeRuntimeAdapter(), new DenoBunRuntimeAdapter('deno'), new DenoBunRuntimeAdapter('bun')] });
  const performance = new PerformanceManager({
    targetResolver: new RegistryPerformanceTargetResolver(runtimes),
    emit: (event) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.performanceEvent, event);
    }
  });
  registerPerformanceHandlers(registrar, performance);
  registrar(IPC.enginesList, async () => enginesController.list());
  registrar(IPC.engineCapabilities, async (payload) => {
    const req = (payload ?? {}) as { engineId?: string };
    return enginesController.capabilities(req.engineId ?? 'v8');
  });

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
