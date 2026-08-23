/**
 * Canonical IPC channel names.
 * Every cross-process message MUST use one of these constants.
 */
export const IPC = {
  /** Liveness round-trip used by boot smoke checks. */
  ping: 'app:ping'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
