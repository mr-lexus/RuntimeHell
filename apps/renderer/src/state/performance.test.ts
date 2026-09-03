import { beforeEach, describe, expect, it } from 'vitest';
import { usePerformance } from './performance';

const requestId = 'perf-progress-1234';

describe('performance progress state', () => {
  beforeEach(() => {
    usePerformance.setState({
      requestId,
      running: true,
      progress: 'starting',
      progressCompleted: 0,
      progressTotal: 0,
      progressPhase: 'resolving',
      activeGroupId: null,
      completedGroups: 0,
      totalGroups: 2,
      errors: {}
    });
  });

  it('retains numeric progress instead of only replacing the status message', () => {
    usePerformance.getState().handleEvent({
      type: 'progress', requestId, groupId: 'node:natural', phase: 'measurement',
      completed: 7, total: 20, message: 'Case A · sample 3/5'
    });
    expect(usePerformance.getState()).toMatchObject({
      progress: 'Case A · sample 3/5',
      progressCompleted: 7,
      progressTotal: 20,
      progressPhase: 'measurement',
      activeGroupId: 'node:natural'
    });
  });

  it('ignores events from an older experiment and finalizes non-cancelled progress', () => {
    usePerformance.getState().handleEvent({ type: 'progress', requestId: 'stale-request', phase: 'warmup', completed: 9, total: 10, message: 'stale' });
    expect(usePerformance.getState().progress).toBe('starting');
    usePerformance.setState({ progressCompleted: 12, progressTotal: 20 });
    usePerformance.getState().handleEvent({ type: 'done', requestId, status: 'partial', completedGroups: 1, totalGroups: 2 });
    expect(usePerformance.getState()).toMatchObject({ running: false, requestId: null, progress: 'partial', progressCompleted: 20, progressTotal: 20, completedGroups: 1 });
  });
});
