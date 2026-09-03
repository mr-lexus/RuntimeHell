import type { PerformanceStartRequest } from '@rh/protocol';

/**
 * A renderer can be reloaded before Electron's main process has restarted in
 * development. In that window the old main handler rejects fields introduced
 * by a newer Performance contract. Keep the retry narrowly scoped to that
 * contract mismatch; execution errors must still reach the renderer.
 */
export function isLegacyPerformanceContractError(error: unknown): boolean {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    try {
      message = JSON.stringify(error);
    } catch {
      message = String(error);
    }
  }

  return message.includes('unrecognized_keys') && /(?:^|\W)(?:mode|gcMode|setupSourceLabel|sourceMode|target|profileIds|fileId)(?:$|\W)/i.test(message);
}

/** Remove fields unknown to the pre-Performance-UX main process. */
export function toLegacyPerformanceStartRequest(request: PerformanceStartRequest): Record<string, unknown> {
  const legacyRequest = { ...request } as Record<string, unknown>;
  delete legacyRequest.setupSourceLabel;

  legacyRequest.cases = request.cases.map((item) => {
    const legacyCase = { ...item } as Record<string, unknown>;
    delete legacyCase.mode;
    delete legacyCase.sourceMode;
    delete legacyCase.target;
    delete legacyCase.profileIds;
    if (legacyCase.sourceRef && typeof legacyCase.sourceRef === 'object') {
      legacyCase.sourceRef = { ...(legacyCase.sourceRef as Record<string, unknown>) };
      delete (legacyCase.sourceRef as Record<string, unknown>).fileId;
    }
    return legacyCase;
  });

  const legacyMeasurement = { ...request.measurement } as Record<string, unknown>;
  delete legacyMeasurement.gcMode;
  legacyRequest.measurement = legacyMeasurement;

  return legacyRequest;
}
