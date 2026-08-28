/**
 * Canonical IPC channel names.
 * Every cross-process message MUST use one of these constants.
 * Channels are added incrementally as features land (plan: incremental todos).
 */
export const IPC = {
  // liveness
  ping: 'app:ping',

  // renderer-owned titlebar controls
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowState: 'window:state',

  // execution
  runStart: 'run:start',
  runEvent: 'run:event', // main -> renderer stream
  runCancel: 'run:cancel',

  // analysis
  analysisRequest: 'analysis:request',
  analysisResult: 'analysis:result', // main -> renderer
  analysisCancel: 'analysis:cancel',
  analysisEvent: 'analysis:event', // main -> renderer stream (todo 19)

  // binaries (runtimes + engines)
  binariesList: 'binaries:list',
  binariesInstall: 'binaries:install',
  binariesRemove: 'binaries:remove',
  binariesProgress: 'binaries:progress', // main -> renderer stream

  // engines
  enginesList: 'engines:list',
  engineCapabilities: 'engines:capabilities',

  // runtimes
  runtimesListVersions: 'runtimes:list-versions',
  runtimeCapabilities: 'runtimes:capabilities',

  // packages (todo 13)
  packagesInstall: 'packages:install',
  packagesRemove: 'packages:remove',
  packagesList: 'packages:list',
  packagesSearch: 'packages:search',
  packagesEvent: 'packages:event', // main -> renderer stream

  // workspace files (minimal early surface; WorkspaceStore expands in todo 21)
  wsSaveFile: 'ws:save-file',
  wsReadFile: 'ws:read-file',
  wsListFiles: 'ws:list-files',

  // workspace store + settings + history (todo 21)
  wsListWorkspaces: 'ws:list-workspaces',
  wsCreateWorkspace: 'ws:create-workspace',
  wsDeleteWorkspace: 'ws:delete-workspace',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  historyList: 'history:list'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
